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

## JSON-RPC 方向

AgentHub 协议是 proto-first，但运行时通信在合适位置使用 JSON-RPC 风格的 request/response/notification 信封。

```text
UI <-> Edge      JSON-RPC over WebSocket
Edge <-> Runner  JSON-RPC over local HTTP/WebSocket/stdio
Edge <-> Hub     JSON-RPC over reverse WSS
Hub <-> Web      JSON-RPC over WebSocket + REST 处理简单读操作
```

P0 可以在 Edge 和 Runner 之间使用本地 WebSocket/HTTP，但方法名应与长期 JSON-RPC surface 保持一致。

## 关键方法

```text
project/list
project/open

thread/create
thread/list
thread/read

turn/start
turn/interrupt
turn/resume

item/subscribe
item/created
item/updated

approval/decide

artifact/list
artifact/read
artifact/apply
artifact/discard

runner/list
runner/status

hub/connect
hub/sync
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
