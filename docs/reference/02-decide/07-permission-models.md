# Agent 权限模型：跨仓库深入对比

> 来源：`01-learn/deep-dive/04-claude-code-tool-security.md`（23 项检查 + 5 层管道）、
> `01-learn/repos/06-opencode.md`（默认允许 + 层级合并）、
> `01-learn/repos/08-openhands.md`（SecurityAnalyzer + Docker sandbox）、
> `03-build/backend/08-error-handling.md`（审批状态机）、
> `03-build/frontend/13-plugin-marketplace.md`（5x20 插件权限类别）
> 日期：2026-05-21

---

## 1. 概述

四个参考实现覆盖了从**默认允许 + 管道门控**（Claude Code）到**容器边界默认拒绝**（OpenHands Docker sandbox）的全谱系。AgentHub 的目标领域——多 agent 编排、插件可扩展性和课程作业自动化——需要一种**默认拒绝 + 分层授权**模型，没有任何单一参考实现能独立提供。本文分析各方案的权衡并推荐一个综合设计。

---

## 2. 权限模型谱系

### 2.1 默认允许端

**Claude Code** 采用信任但验证模型：

| 操作 | 默认 | 门控 |
|-----------|---------|------|
| 只读工具（Glob、Grep、Read） | 自动允许 | 无 |
| 写入工具（Write、Edit） | 自动允许 | `acceptEdits` 模式开关 |
| Bash 命令 | 询问用户 | 23 项 validator 安全管道 |
| Misparsing 模式 | 阻断（不可覆盖） | 管道门控 |
| Non-misparsing 模式 | 询问（可纳入 allowlist） | 标准权限流程 |

关键特征：agent 被信任可以请求工具；安全是**命令内容过滤器**，而非默认拒绝的权限体系。`bypassPermissions` 模式完全禁用写入工具的审批提示。

**OpenCode** 是 agent 类型相关的：

| Agent | 立场 | 写入工具 | 特殊控制 |
|-------|--------|-------------|-----------------|
| `build`（primary） | 默认允许 | 允许 | question/plan_enter=allow |
| `plan`（primary） | 对写入默认拒绝 | 阻断 | plan_exit=allow，只读 |
| `general`（subagent） | 默认允许 | 允许 | todowrite=deny |
| `explore`（subagent） | 显式 allowlist | 仅 grep/glob/read/bash/webfetch | 最小集 |
| `scout`（实验性） | 显式 allowlist | 仅 repo_clone/repo_overview | 实验性 |

关键特征：权限**与 agent 身份耦合**，而非通用策略引擎。`permission.ask` hook 允许插件拦截和覆盖决策。

### 2.2 默认拒绝端

**OpenHands** 通过 OS 级隔离实现最强模型：

| 边界 | 机制 | 默认 |
|----------|-----------|---------|
| 文件系统 | Docker 卷挂载 | 仅显式挂载的路径可见 |
| 网络 | Docker 桥接/主机网络 | 仅暴露的端口可达 |
| 进程 | 容器 cgroup/namespace | 无主机进程可见性 |
| 环境变量 | 显式环境变量注入 | 仅 `OH_*` 和 `LLM_*` 变量转发 |
| 认证 | Session API Key（32 字节随机） | agent-server 通信需要 Bearer token |

关键特征：安全是**空间性**的（容器内/外），而非行为性的。在 sandbox 内部，agent 拥有完全自由。sandbox 墙是唯一的权限检查。

### 2.3 谱系可视化

```
默认允许 ◄────────────────────────────────────────► 默认拒绝

OpenCode           Claude Code          AgentHub 插件        OpenHands
(build agent:      (管道门控：          (交集：              (容器墙：
 大多数工具 OK，    23 项检查过滤       manifest ∩ user ∩    除非显式挂载/
 plan agent:        bash 内容，          policy；需要显式     暴露，否则无
 拒绝写入)          写入=ask)           授权)                东西可跨越)
```

AgentHub 的综合定位：**Claude Code 右侧、OpenHands 左侧**——对插件/sandbox 边界采用默认拒绝，对 sandbox 内操作采用安全管道门控。

---

## 3. 权限粒度对比

### 3.1 四级粒度

| 级别 | Claude Code | OpenCode | OpenHands | AgentHub 插件 |
|-------|-------------|----------|-----------|-----------------|
| **工具级** | tool_name + isReadOnly 布尔值 | 逐 agent 的 Permission.Ruleset | 不适用（sandbox 内） | 6 种 slot 类型 x 权限类别 |
| **文件级** | policy rules 中的路径模式 | GLOB：逐路径 `read/edit/write`，`external_directory` | 卷挂载（目录级） | `fs.read/write/delete` + 项目范围强制 |
| **命令级** | 23 项 validator 作用于 bash 内容 | 不适用 | 不适用 | `fs.exec`、`system.process.spawn` |
| **网络级** | 不适用（无网络门控） | 不适用 | 仅暴露的端口 | `network.http/websocket/listen` |

### 3.2 详细粒度矩阵

**Claude Code -- Policy Rule 匹配字段：**

```
ToolPattern: "bash" | "write" | "edit" | glob
ToolInputKey: "command" | "file_path" | "content"
PathPattern: 作用于 file_path 的 glob
RiskLevel: low | medium | high | critical
```

单条 policy rule 可以匹配工具名、输入键/值正则、文件路径 glob 和声明的风险级别的任意组合。这是**粗粒度**（工具 + 路径）但**灵活**（任意输入字段可匹配）。

**OpenCode -- Agent Permission Ruleset：**

```ts
permission: {
  "*": "allow" | "deny" | "ask",           // 全局默认
  external_directory: { "**": "ask" },      // 工作区外的路径
  read: { "*.md": "allow" },                // 文件级读取
  edit: { "**/*.ts": "allow" },             // 文件级编辑
  write: { "package.json": "ask" },         // 文件级写入
  doom_loop: "ask",                         // 特殊控制
  question: "allow",                        // 特殊控制
}
```

这是**中等粒度**：文件级 GLOB 配合三种操作类型（read/edit/write），加上命名特殊控制。无命令内容级检查。

**AgentHub 插件 -- 5 类别 x 20 子权限：**

```
fs:      read | write | delete | exec
network: http | websocket | listen
agent:   prompt | messages.read | tool.intercept | tool.define | subagent.spawn
system:  env.read | process.spawn | clipboard | notification
ui:      inject | theme | shortcut
user:    identity | secrets
```

这是对比集中**最细粒度的模型**：5 个类别下 20 个子权限，运行时通过交集（manifest ∩ user config ∩ policy）强制执行。

### 3.3 对 AgentHub 的粒度建议

AgentHub 应同时在**全部四个级别**运作，分层执行：

```
第 1 层（粗）：  Sandbox 边界 -- 工作区隔离（OpenHands 模式）
第 2 层（中）：  工具级 + 文件 GLOB -- 哪些工具在哪些路径上（OpenCode 模式）
第 3 层（细）：  命令内容 -- 作用于 bash/powershell 的安全管道（Claude Code 模式）
第 4 层（最细）： 插件权限 -- 5x20 子权限门控（Plugin Marketplace 模式）
```

---

## 4. 权限持久化与作用域

### 4.1 持久化层级

| 作用域 | Claude Code | OpenCode | OpenHands | AgentHub（目标） |
|-------|-------------|----------|-----------|-------------------|
| **Turn 级** | 逐工具调用"批准一次" | `permission.ask` hook 动态决策 | 不适用（无逐 turn 门控） | Thread 作用域决策缓存 |
| **Session 级** | "本次会话始终允许" | 内存中配置直到重启 | Session API key 生命周期 | Session 作用域决策缓存 |
| **Project 级** | `.claude/settings.json` allowlist 规则 | `opencode.toml` agent 配置 | SandboxSpec 模板 | 项目作用域 policy rules |
| **User/Global 级** | `~/.claude/settings.json` | `~/.config/opencode/` | 不适用 | `~/.agenthub/settings.json` |
| **Team/Org 级** | 不适用（无多用户） | Enterprise：身份提供商 | 组织配置 | Team/Enterprise policy 优先级 |
| **System/Default 级** | 9 源优先级，最低 = 默认 | 内置 agent 默认值 | Docker daemon 配置 | 保留优先级带 |

### 4.2 Claude Code 的 9 源优先级体系

```
优先级  0: CLI flags       (--dangerously-skip-permissions)
优先级  1: Session rules   ("本次会话始终允许")
优先级  2: User settings   (~/.claude/settings.json)
优先级  3: Project local   (.claude/settings.json)
优先级  4: Agent config    (逐 agent 配置)
优先级  5: Team policy     (企业管理)
优先级  6: Enterprise      (组织级)
优先级  7: System default  (内置高风险模式)
优先级  8: Catch-all       (默认 allow/deny)
```

数字越小 = 优先级越高 = 先检查。首个匹配即胜出，评估停止。这是对比集中最成熟的优先级体系，AgentHub 应直接采纳。

### 4.3 OpenCode 的层级合并（不同方式）

OpenCode 不使用优先级排序；它使用**层级合并**：

```
defaults -> agent built-in -> user config -> effective
```

每层覆盖前一层。没有"优先级"——最后定义的值胜出。这更简单，但多租户/团队场景下灵活性较差。AgentHub 应优先选择优先级模型，因为其冲突解决更清晰。

### 4.4 持久化建议

AgentHub 应采纳 Claude Code 的 9 源优先级，扩展以包含插件级规则：

```
优先级  0: CLI flags           (--approve-bash, --dangerously-skip-permissions)
优先级  1: Runtime decisions    (session 作用域 "始终允许")
优先级  2: User settings        (~/.agenthub/settings.json)
优先级  3: Project local        (.agenthub/rules.json)
优先级  4: Plugin permissions   (manifest.yaml 声明 ∩ 用户批准)
优先级  5: Agent configuration  (per-agent.yaml)
优先级  6: Team policy          (来自 Hub API 的团队级)
优先级  7: Enterprise policy    (组织级)
优先级  8: System defaults      (内置高风险模式)
优先级  9: Catch-all            (默认 deny 或 ask)
```

---

## 5. 执行机制深入

### 5.1 Claude Code：内容感知管道

23 项 validator 管道是对比集中最深入的执行机制。其关键架构洞见是 **misparsing 与 non-misparsing** 的区分：

- **Misparsing（21 个 validator）**：安全解析器自身无法可靠解释的模式。结果带有 `isBashSecurityCheckForMisparsing: true`。这些**绕过所有 allowlist 规则**——没有用户可配置的规则可以自动批准 misparsing 问题。用户必须显式批准每个实例。

- **Non-misparsing（2 个 validator）**：`validateNewlines` 和 `validateRedirections`。被 shell-quote 和 bash 正确解析。这些走标准权限流程：allowlist 规则可以自动批准。

- **延迟 non-misparsing**：如果 non-misparsing validator 先触发，其结果被延迟。管道继续检查 misparsing validator。只有没有 misparsing validator 触发时，才使用延迟结果。这防止了低严重度 non-misparsing 匹配掩盖高严重度 misparsing 问题。

**管道阻断的 6 个已记录攻击向量**（来自 HackerOne 披露）：

1. 花括号展开混淆（validator 21）
2. 反斜杠转义操作符双重解析（validator 18）
3. 回车解析器差异（validator 11）
4. 注释引号不同步（validator 9）
5. 引号内换行隐藏参数（validator 10）
6. 词中井号解析器差异（validator 20）

### 5.2 OpenCode：基于 Hook 的拦截

执行分布在三个机制上：

1. **Agent permission ruleset**：逐 agent 声明允许/拒绝的工具和路径的静态配置
2. **`permission.ask` hook**：插件可以动态阻断、允许或升级任何权限请求
3. **`tool.execute.before` hook**：可以在执行前修改工具参数或设置 `block=true`

无 bash 命令的内容级检查。hooks 提供了可扩展性，但缺少 Claude Code 管道的深度命令解析。

### 5.3 OpenHands：空间性执行

执行是结构性的，而非行为性的：

- **Docker 卷挂载**：仅显式声明的主机路径在 sandbox 内可见
- **桥接网络**：除非 `AGENT_SERVER_USE_HOST_NETWORK=true`，否则无主机网络访问
- **环境变量过滤**：除非通过 `OH_AGENT_SERVER_ENV` 覆盖，否则仅转发 `LLM_*` 和 `LMNR_*` 前缀的变量
- **Session API Key**：所有 agent-server 通信需要 32 字节随机 bearer token

这是最强的隔离，但是最粗的粒度。无法细粒度控制 agent 在 sandbox 内的行为。

### 5.4 AgentHub 插件：三层交集

```
Effective = Manifest ∩ User Config ∩ Policy

Manifest:    插件开发者声明需要的权限
User Config: 安装用户允许的权限
Policy:      组织强制的允许/拒绝列表（管理员控制）
```

危险权限（`system.process.spawn`、`fs.exec`、`network.listen`）不能通过 `--yes` 或配置默认值授予——它们在安装时需要显式的交互式用户确认。

---

## 6. 审批状态机对比

### 6.1 Claude Code：Security Pipeline -> Policy Rules -> User Prompt

```
Bash command
  -> Control char check（预处理）
  -> Heredoc stripping
  -> Quote extraction -> CheckContext
  -> Early validators（empty、incomplete、safe heredoc、git commit）
  -> Main validators（先 misparsing，再 delayed non-misparsing）
  -> PolicyEngine rule evaluation（按优先级排序，首个匹配胜出）
  -> Default behavior（工具风险级别）
  -> User prompt（如果是 ask）
```

**决策缓存**：结果按 per-session（`session:tool_name`）和 per-thread（`thread:tool_name`）缓存。

### 6.2 AgentHub：SecurityPipeline -> PolicyEngine -> ToolExecutor

```
ToolCall 到达
  -> SecurityPipeline.Evaluate(command)
      -> ControlCharRe? -> DENY（SeverityBlock）
      -> Misparsing? -> 强制 ask（SeverityHigh）
      -> Non-misparsing? -> 可 allowlist 检查（SeverityLow/Medium）
  -> PolicyEngine.Evaluate(toolCall, evalCtx)
      -> bypassPermissions? -> 自动允许
      -> plan mode + write? -> DENY
      -> Rule match（allow）-> 自动允许
      -> Rule match（deny）-> DENY
      -> 无匹配 -> 默认（ToolDescriptor.riskLevel）
  -> ToolExecutor.runWithTimeout()
```

**安全违规作为一等错误**：Severity 直接映射到 `AgentHubError.Severity` 和 `ErrorCode`。安全问题的错误类型没有单独分离——UI 将安全阻断视为 `Origin=AgentInternal, Severity=Block, Retryable=false` 的错误。

### 6.3 关键差异

| 方面 | Claude Code | AgentHub（目标） |
|--------|-------------|-------------------|
| 管道作用于 | 仅 Bash 命令 | 所有工具调用（bash 走安全管道，其他走策略） |
| Misparsing 门控 | 在管道自身内阻断 | 返回 SecurityViolation，PolicyEngine 转换为 decision |
| 决策类型 | ask/passthrough/allow | Accept/Decline 带 DecidedBy 追踪 |
| 缓存粒度 | session + thread | session + thread +（未来：插件作用域） |
| 管理员策略 | 仅 Enterprise（闭源） | Team + Enterprise（开放架构） |

---

## 7. 插件/扩展权限模型

### 7.1 OpenCode 插件 Hooks

插件通过 `permission.ask` hook 与权限交互：

```ts
hook("permission.ask", (input: Permission, output: { status: string }) => {
  // input: { tool, session, details }
  // output.status = "allow" | "deny" | "ask"
})
```

这是唯一的权限 hook。插件不能声明自己的权限——它们以 agent 的权限级别运行。这适用于单用户桌面工具，但不足以应对多租户 hub。

### 7.2 AgentHub 插件权限（三层）

**安装时**：用户看到声明的权限并显式批准每个类别。

**运行时**：每个权限敏感的操作都按 `manifest ∩ user_config ∩ policy` 检查。违规以 `[plugin:<name>]` 前缀记录并显示在权限审计视图中。

**危险权限门控**：`system.process.spawn`、`fs.exec`、`network.listen` 需要显式交互确认——不能通过 `--yes` 或配置默认值授予。

这是对比集中唯一给**插件自身权限身份**、与 agent 分离的模型。Claude Code 没有插件概念。OpenCode 的插件继承 agent 的权限。AgentHub 的插件是独立的安全主体。

### 7.3 按插件类型的 Sandbox 级别

| Slot 类型 | Sandbox | 理由 |
|-----------|---------|-----------|
| `tab` / `panel` / `toolbar` | iframe 带 `sandbox="allow-scripts"` | 阻止对主应用的 DOM 访问；通过 postMessage 桥接受控 API |
| `tool` | Worker 线程（Node.js）或 WASM（浏览器） | 默认无 fs/network；fs.* 权限门控访问 |
| `skill` | 仅 Prompt（无代码执行） | 指令以文本注入；无可执行表面 |
| `theme` | 仅 CSS（解析和净化后） | 无外部资源的 `url()`；无 JS 执行 |
| Server sidecar | 进程隔离 + localhost-only 网络 | `127.0.0.1` 绑定、最小环境、两阶段 SIGTERM->SIGKILL |

---

## 8. AgentHub 建议：默认拒绝 + 分层授权

### 8.1 核心原则

**除非显式授权，否则一切不允许。** 这适用于每个边界：

```
                ┌─────────────────────────────────────────┐
                │           AgentHub 默认拒绝               │
                │                                           │
  External ─────┤  Sandbox 墙（OpenHands 模式）              │
  (network,     │    - 显式卷挂载                           │
   host fs)     │    - 显式端口暴露                         │
                │    - 显式环境变量注入                      │
                │                                           │
  Agent ────────┤  Policy Engine（Claude Code 模式）         │
  (tool calls)  │    - 9 源优先级规则                       │
                │    - 23 项 validator bash 安全管道         │
                │    - 路径作用域文件访问                     │
                │    - 基于风险级别的默认值                   │
                │                                           │
  Plugin ───────┤  三层交集（Plugin 模式）                   │
  (extension)   │    - manifest 声明权限                    │
                │    - 用户批准的门控                        │
                │    - 组织策略                              │
                │    - 危险权限显式提示                       │
                │                                           │
  User ─────────┤  Session Auth + RBAC                      │
  (identity)    │    - session API key                      │
                │    - team/org 角色绑定                     │
                │    - 逐主体的审计日志                       │
                └─────────────────────────────────────────┘
```

### 8.2 分层授权模型

```
第 0 层：Sandbox 边界（始终拒绝跨边界操作）
        -> 工作区外的工具访问 -> DENY
        -> 未暴露端口的网络访问 -> DENY
        -> 主机环境变量访问 -> DENY
        -> 用户不可覆盖

第 1 层：内容安全管道（misparsing = 强制 ask）
        -> 23 个 bash validator（从 Claude Code 采纳）
        -> Misparsing 问题：无 allowlist 覆盖
        -> SeverityBlock 模式：系统拒绝（不提示用户）
        -> 用户必须改写命令，不可覆盖

第 2 层：Policy Rules（可 allowlist，按优先级排序）
        -> 9 源优先级体系
        -> 首个匹配即胜出
        -> Allow/Deny/Escalate 决策

第 3 层：Plugin Permissions（显式授权，交集运算）
        -> Manifest ∩ User Config ∩ Policy
        -> 危险权限：仅交互式
        -> 逐 slot sandbox（iframe/worker/process）

第 4 层：Session Auth（bearer token，时间限制）
        -> 32 字节随机 session API key
        -> 作用域为 session 生命周期
        -> 可撤销
```

### 8.3 决策流程

```
Tool call 到达 Runner
  │
  ├── 第 0 层：Sandbox 边界检查
  │     path outside workspace? -> DENY（不可覆盖）
  │     target not in exposed ports? -> DENY（不可覆盖）
  │
  ├── 第 1 层：内容安全管道（bash/powershell）
  │     23 validators -> SeverityBlock? -> DENY
  │                   -> Misparsing? -> MANDATORY_ASK
  │                   -> Non-misparsing? -> 延迟到第 2 层
  │
  ├── 第 2 层：Policy rule 评估
  │     按优先级排序的 rule match -> Allow/Deny/Escalate
  │
  ├── 第 3 层：插件权限门控（如果是插件发起的）
  │     manifest ∩ user_config ∩ policy -> Allow/Deny
  │
  └── 第 4 层：默认行为
        默认拒绝：返回 ASK_USER
```

### 8.4 为什么不是任何单一模型

| 如果仅采纳…… | 我们会失去…… |
|----------------------|-----------------|
| Claude Code 的模型 | 无 sandbox 边界（容器级隔离），无插件权限身份，无工具注册级的默认拒绝 |
| OpenCode 的模型 | 无内容级 bash 安全管道，无 9 源管理员可见优先级，无插件隔离 |
| OpenHands 的模型 | 无 sandbox 内细粒度工具/文件/命令权限，内部一切隐式信任 |
| 仅 Plugin Marketplace | 非插件工具的 bash 安全缺失，无 session 级 policy rules，无 sandbox 边界 |

### 8.5 AgentHub 超越参考实现的新增内容

1. **统一决策类型**（`ApprovalDecision`），跨全部四层携带 `DecidedBy` 追踪
2. **安全违规作为一等错误**，纳入统一的 `AgentHubError` 分类——无独立安全子系统
3. **插件作为独立安全主体**——插件有自己的权限身份，不继承 agent 的
4. **Sandbox + Pipeline 组合**——空间隔离 AND 行为检查，而非二选一
5. **管理员可见优先级带**——Team 和 Enterprise policy 与用户偏好处于同一优先级体系中

---

## 9. 实施路线图

### 阶段 1：基础（P0）

- [x] `SecurityPipeline` 含 23 个 validator（从 Claude Code 采纳，移植到 Go）
- [x] `PolicyEngine` 含 9 源优先级和 `ApprovalDecision` 类型
- [x] `AgentHubError` 统一错误分类，集成 `SecurityViolation`
- [ ] 决策缓存：session 作用域 + thread 作用域键
- [ ] ToolDescriptor `RiskLevel` 和 `RequiresApproval` 字段
- [ ] ToolRegistry 注册时的默认拒绝

### 阶段 2：插件权限（P1）

- [ ] Manifest `permissions` 字段校验（5 类别 x 20 子权限）
- [ ] 安装时权限提示 UI
- [ ] 运行时三层交集执行
- [ ] 危险权限仅交互式门控
- [ ] 插件审计日志带 `[plugin:<name>]` 前缀

### 阶段 3：Sandbox 边界（P2）

- [ ] `WorkspaceService` ABC（采纳 OpenHands `SandboxService` 模式）
- [ ] `DockerWorkspaceService` 实现
- [ ] `WorktreeWorkspaceService` 实现（用于轻量级课程作业场景）
- [ ] PolicyEngine 第 0 层 sandbox 边界执行
- [ ] Session API Key 生成和验证

### 阶段 4：管理与审计（P2）

- [ ] PolicyEngine 中 Team/Enterprise policy 优先级带
- [ ] 权限审计仪表盘
- [ ] 安全违规聚合和告警
- [ ] Policy rule CRUD API 带管理员 RBAC

---

## A. 参考交叉索引

| 概念 | Claude Code | OpenCode | OpenHands | AgentHub Plugin | 本文档 |
|---------|-------------|----------|-----------|-----------------|---------------|
| 默认立场 | 允许 + 管道门控 | Agent 相关 | 容器默认拒绝 | 显式授权 | **全部层默认拒绝** |
| Bash 安全 | 23 个 validator，misparsing 门控 | 无 | 无（容器墙） | 不适用 | **采纳：23 个 validator** |
| 文件 GLOB 权限 | policy rules 中的 PathPattern | `read/edit/write` + `external_directory` | 卷挂载 | `fs.{read,write,delete}` | **全部三者：路径 + 操作 + 挂载** |
| 优先级体系 | 9 源，首个匹配胜出 | 层级合并（最后胜出） | 不适用 | 交集（全部通过） | **采纳：9 源优先级** |
| 插件身份 | 不适用（无插件） | 继承 agent 权限 | 不适用 | 独立安全主体 | **采纳：独立** |
| 决策缓存 | session + thread | 内存中 per session | session API key | 不适用 | **采纳：session + thread** |
| Sandbox 隔离 | 无（同一进程） | TUI/server 分离 | Docker cgroup/namespace | iframe/worker/process | **第 0 层边界** |
| 安全作为错误 | 独立子系统 | 基于 hook | 不适用 | Manifest 校验 | **统一 AgentHubError** |

---

*分析完成。2026-05-21。*
