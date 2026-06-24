# ADR-017: Edge 双 Token 模型 —— 身份 + 能力令牌

## Status

Accepted

## Context

**关联审计项：AH-SR-046**

Edge Server 当前使用 **单一 API Token** 进行 Hub-Edge 通信认证与授权。该模式存在以下问题：

1. **粒度过粗**：一个 API Token 授予 Edge Server 全部操作权限（启动 Run、取消 Run、读取状态、管理配置），无法区分不同操作的风险等级。
2. **令牌泄漏影响面大**：API Token 一旦泄漏，攻击者可完全控制 Edge Server 的所有 Agent 运行能力。
3. **无法支持 per-run 授权**：当 Hub 希望某次 Run 只能访问特定资源（如特定项目目录、限时凭证）时，API Token 是全局凭证，无法表达细粒度约束。
4. **审计不可区分**：所有操作使用同一 Token，日志中无法区分是系统级操作还是某个特定 Run 的生命周期操作。

SUPER 审计标记 AH-SR-046 为 **授权架构缺陷**，要求实现 per-run 粒度的能力控制。

## Decision

采用 **双 Token 模型**：JWT 身份令牌 + per-run 能力令牌（Capability Token）。

### 双 Token 定义

#### 1. 身份令牌（Identity Token）

- **类型**：JWT（RS256 签名，Hub 签发，Edge 持有公钥验签）。
- **用途**：认证 Edge Server 身份，建立 WebSocket 连接，执行系统级操作。
- **生命周期**：长有效期（如 30 天），可轮换。
- **携带信息**：`{ sub: "edge:<edge_id>", iat, exp, scope: "edge:connect edge:config:read" }`

#### 2. 能力令牌（Capability Token）

- **类型**：短生命周期的不透明令牌（Hub 生成，存储在 Edge 内存/DB 中）。
- **用途**：授权特定的 Agent Run，限定该 Run 可访问的资源和操作。
- **生命周期**：与 Run 同生命周期（Run 结束即失效），最长不超过 Run 超时时间。
- **携带信息**：
  ```json
  {
    "run_id": "run_abc123",
    "agent_id": "agent_xyz",
    "project_id": "proj_456",
    "permissions": ["process:start", "fs:read:/workspace/proj_456"],
    "expires_at": "2026-06-19T12:00:00Z",
    "max_duration_seconds": 300
  }
  ```

### 流程

```
Hub                                    Edge
 │                                      │
 │── WebSocket Connect ────────────────→│  使用身份令牌认证
 │   (Authorization: Bearer <JWT>)      │
 │←── Connected ────────────────────── │
 │                                      │
 │── run_start ────────────────────────→│  消息体包含能力令牌
 │   { run_id, capability_token, ... }  │
 │                                      │
 │   Edge 收到后：                      │
 │   1. 存储 capability_token 绑定 run │
 │   2. 启动 Agent 进程，注入 token     │
 │   3. Agent 进程内所有受限操作        │
 │      需携带 capability_token         │
 │                                      │
 │── run_cancel ───────────────────────→│  携带 capability_token
 │                                      │
 │←── run_complete ──────────────────── │  能力令牌即刻失效
```

### 安全约束

- **能力令牌不通过 WebSocket 以外通道传输**（不在 HTTP header、URL query、环境变量中传递，仅通过 WebSocket 消息体）。
- **能力令牌绑定 Run ID**：Edge 验证每个操作携带的 capability_token 是否匹配对应的 Run。
- **令牌撤销**：Hub 可通过 WebSocket 发送 `revoke_token` 消息主动撤销能力令牌（如管理员强制取消 Run）。
- **Token 不落地磁盘**：能力令牌仅存储在 Edge Server 内存中（map[runID]*CapToken），重启后需 Hub 重新下发。

### Edge Agent 进程权限控制

Agent 进程（由 Edge 启动的子进程）需通过 `AGENTHUB_CAPABILITY_TOKEN` 环境变量获取令牌（唯一例外），但该变量仅在进程启动时设置，进程结束后环境空间即消失。Agent 进程内调用 Edge 本地 API 时必须在请求体中携带 `capability_token` 字段。

## Alternatives

### 方案 A：OAuth2 Scope Token

实现完整的 OAuth2 Authorization Code / Client Credentials 流程，通过 scope 控制权限粒度。

- **优点**：行业标准，成熟的库和最佳实践。
- **缺点**：OAuth2 的 token introspection、refresh token、consent 页面等对于 Hub-Edge 内部服务间通信过于复杂；OAuth2 scope 是静态定义（如 `run:start`），无法表达 per-run 级别的动态权限（如 `fs:read:/workspace/proj_456`）。
- **结论**：拒绝。OAuth2 的抽象层次高于我们的需求，使用它需要大量无价值的胶水代码。

### 方案 B：签名指令（Signed Commands）

每个 Hub→Edge 指令都附带一个 HMAC 签名，Edge 验证签名后执行。不维护 token 状态。

- **优点**：无状态，不需要令牌存储和生命周期管理。
- **缺点**：每个指令独立签名，无法建立"一系列操作属于同一个 Run"的会话概念；撤销困难（需要吊销签名密钥，影响所有 Run）；攻击者窃取一个签名后可在有效期内重放（需要额外 nonce 机制）。
- **结论**：拒绝。缺少会话语义，不适合需要 per-run 上下文的场景。

### 方案 C：维持单一 API Token，增加 ACL 配置

继续使用 API Token，但在 Edge 侧维护 ACL 配置文件限制每个 Token 的权限范围。

- **优点**：改动最小。
- **缺点**：ACL 是静态配置，无法实现 per-run 动态授权；新增 Run 需要修改 ACL 配置文件并重启/reload Edge；无法表达细粒度的文件系统路径权限。
- **结论**：拒绝。不满足 per-run 粒度的核心需求。

## Consequences

**正面：**

- 每个 Run 拥有独立的能力令牌，权限最小化原则得到落实。
- 身份令牌泄漏时攻击者只能建立 WebSocket 连接，无法直接启动 Run（需要 Hub 主动下发）。
- 能力令牌泄漏时，影响范围仅限于该 Run（且 Run 结束后令牌自动失效）。
- 审计日志可按 run_id 精确追踪每个操作归属，满足 AH-SR-046 的审计可区分要求。
- 令牌撤销可精确到单个 Run，无需影响其他运行中的任务。

**负面：**

- 每个 `run_start` 消息需要额外生成和管理能力令牌，增加 Hub 的 CPU 开销（可忽略，令牌生成为本地 HMAC/随机数）。
- Edge 内存中维护 `run_id → CapToken` 映射，大量并发 Run 时内存占用增加（预估 1000 并发 Run 仅增加 ~100KB）。
- Agent 子进程需要通过环境变量获取令牌，存在被同一主机上其他进程读取的风险（Linux 下 `/proc/<pid>/environ` 仅同 UID 可读，风险可控）。
- Debug 时需要额外步骤查看当前 Run 的能力令牌（可提供 Edge debug API）。
