# 05 - AionUi 安全模型

## 权限模型

AionUi 采用**分层权限模型**，结合 RBAC（角色）和基于能力的审批：

```
权限层次:

┌──────────────────────────────────────────────┐
│  1. App-Level Access Control                  │
│     - 密码保护（本地 + WebUI 远程访问）       │
│     - Session Token（WebUI 认证）             │
│     - 登录页门控                               │
├──────────────────────────────────────────────┤
│  2. Agent Execution Policy                    │
│     - YOLO Mode: 全部自动批准                 │
│     - Auto Mode: 基于风险分级自动/审批        │
│     - Manual: 每步审批                         │
├──────────────────────────────────────────────┤
│  3. Tool-Level Permission                     │
│     - FileSystem: read/write/delete 分离      │
│     - Shell: allowed commands whitelist       │
│     - Network: allowed domains whitelist      │
│     - MCP: per-server capability negotiation  │
├──────────────────────────────────────────────┤
│  4. Extension Permissions                     │
│     - Figma-inspired 声明式权限               │
│     - per-extension 隔离存储                   │
│     - Worker Thread 沙箱执行                   │
└──────────────────────────────────────────────┘
```

### Extension 权限声明（`src/process/extensions/sandbox/permissions.ts`）

```typescript
// 扩展在 manifest 中声明所需权限
interface ExtPermissions {
  filesystem?: {
    read?: string[];    // 可读路径（glob）
    write?: string[];   // 可写路径（glob）
  };
  network?: {
    domains?: string[]; // 允许访问的域名
  };
  shell?: {
    commands?: string[];// 允许执行的命令
  };
  database?: {
    tables?: string[];  // 允许访问的表
  };
}

// 风险等级计算
type PermissionLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
```

## 沙箱隔离级别

```
隔离层次（从弱到强）:

Level 0 - Same Process
  ├── Built-in MCP services（skills/）
  └── 风险：可访问所有 Node.js API

Level 1 - Worker Thread
  ├── Extension Sandbox (SandboxHost)
  ├── 隔离：独立 V8 context，无 DOM
  └── 通信：postMessage 序列化

Level 2 - Child Process (stdio)
  ├── ACP Agents (Claude Code, Codex, etc.)
  ├── 隔离：独立进程，OS 级隔离
  └── 通信：stdio JSON-RPC / NDJSON

Level 3 - Remote
  ├── Remote Agents (HTTP/WS)
  └── 隔离：网络边界 + Token 认证
```

### Extension Sandbox 实现
- `SandboxHost` 在 Worker Thread 中运行扩展代码
- 扩展只能通过 `SandboxApiHandler` 调用宿主暴露的 API
- 文件系统、网络、Shell 操作必须通过宿主代理
- 扩展崩溃不影响主进程

## 审批门控

```
审批触发条件（`ApprovalStore`）:

自动批准:
  - YOLO Mode 下的所有操作
  - Auto Mode 下的 LOW risk 操作
  - 用户在 30s 内对同类操作已批准
  - 操作在白名单中（用户配置的 always-allow 列表）

需要审批:
  - Auto Mode 下的 MEDIUM/HIGH/CRITICAL risk
  - Manual Mode 下的所有操作
  - 首次执行的新类型工具
  - 访问白名单之外的路径/域名

审批 UI 特征:
  - 内联卡片，不弹窗阻断
  - 显示工具名、参数（敏感值 masked）、风险等级
  - 超时 120s 自动拒绝
  - 支持 "Always allow this type" 一键加入白名单
```

## 审计日志

- **会话级别**：每个 Agent 会话的完整消息记录存 SQLite
- **工具调用**：所有工具调用（含自动批准）记录到 `tool_calls` 表
- **审批事件**：`approval_events` 表记录批准/拒绝/超时
- **登录记录**：`login_attempts` 表记录 WebUI 登录尝试
- **局限性**：日志仅本地存储，无可搜索界面，无导出功能

## AgentHub 可采纳点

| 特性 | 优先级 | 说明 |
|------|--------|------|
| 分层权限模型 | P1 | AgentHub 当前只有二元审批 |
| Extension 权限声明 | P2 | 比 AgentHub 当前的完全信任模型更安全 |
| 审批白名单 | P1 | "Always allow this type" 减少审批疲劳 |
| 工具风险分级 | P1 | YOLO/Auto/Manual 比二元模式更实用 |
| Worker Thread 隔离 | M4 | Extension 沙箱是 AgentHub 的参考实现 |
