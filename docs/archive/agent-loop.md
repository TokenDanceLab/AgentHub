> 📦 已归档

# AgentHub Agent Loop

日期：2026-05-21

## 运行时选型

Hub Server、Edge Server 和 Runner 使用 **Go** 实现。

TypeScript 只用于 UI 和生成的客户端类型。AgentHub 可以引用 Codex App 的产品思路，但后端运行时从 P0 起就是 Go。

## 本地 P0 循环

```text
Desktop UI
  -> Edge Server
  -> Runner
  -> Claude Code / Codex / OpenCode
```

流程：

1. 用户创建 Thread。
2. Edge 创建 Turn 和 AgentRun。
3. Edge 从项目 memory、最近的 Item 和当前请求构造上下文。
4. Runner 为本次 run 创建 worktree。
5. Runner 启动选定的 CLI Agent。
6. Runner 以 Item 形式流式输出 stdout/stderr 和结构化事件。
7. Runner 检测文件变更并生成 diff artifact。
8. Edge 索引 artifact 并向 UI 发送 ServerEvent。
9. 用户审查 diff 和审批。
10. Edge 通知 Runner apply 或 discard patch/worktree。

## REST 命令 + WebSocket 事件流

AgentHub 主链路使用 REST JSON API 处理命令和查询，使用 WebSocket typed events 推送实时状态。

```text
UI <-> Edge      REST JSON API + WebSocket EventStream
UI <-> Hub       REST JSON API + WebSocket EventStream
Edge <-> Hub     REST sync API + reverse WebSocket relay
Edge <-> Runner  local REST API + typed event stream
```

P0 可以先实现 Edge 本地 REST + WebSocket。Runner 侧可以用本地 HTTP 或进程内调用起步，但对外暴露给 Edge 的事件必须转换为标准 typed events。

## 关键接口

```text
GET    /v1/projects
POST   /v1/projects
GET    /v1/threads
POST   /v1/threads
GET    /v1/threads/{threadId}
POST   /v1/runs
POST   /v1/runs/{runId}:cancel
POST   /v1/approvals/{approvalId}:decide
GET    /v1/artifacts/{artifactId}
GET    /v1/events
```

AgentRun 的典型链路：

```text
UI POST /v1/runs -> Edge 创建 AgentRun
UI 订阅 /v1/events -> Edge 推送 run.started / run.output / artifact.created
Edge 调用 Runner 本地 run API -> Runner 启动 CLI Agent
Runner event stream -> Edge 持久化并转发给 UI
```

## Go 服务边界

Edge 拥有：

- Project / Thread / Turn 元数据。
- 上下文构造。
- 审批策略决策。
- Runner 选择。
- Artifact 索引。

Runner 拥有：

- CLI 进程生命周期。
- Worktree 生命周期。
- 原始日志。
- Diff 生成。
- Preview 进程生命周期。

Hub 拥有：

- 远程投递。
- 同步。
- 中继。
- Cloud/Web 会话权威。
