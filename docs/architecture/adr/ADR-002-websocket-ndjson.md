# ADR-002: WebSocket + NDJSON 事件协议

**日期**: 2026-05-24
**状态**: 已采纳
**决策者**: Delicious233, Johnny, Trump

## 背景

Agent CLI（Claude Code、Codex、OpenCode）的输出是流式增量 JSON——每一行是一个完整的事件对象。这些事件需要实时推送到 Desktop UI，同时支持中断重连后的历史回放。通信层需要双向能力（UI 可以发送取消、审批等控制指令），且解析逻辑应足够简单以降低维护成本。

## 决策

采用 **WebSocket + NDJSON**（Newline-Delimited JSON）作为主事件协议：

- 每个 WebSocket 帧承载若干完整 JSON 行，每行一个事件。
- 所有事件使用统一信封 `EventEnvelope`（version / id / seq / type / scope / traceId / sentAt / payload）。
- `seq` 在同一事件流内单调递增，客户端保存最后处理的 cursor 用于重连回放。
- 不承载普通查询和 RPC 调用——查询走 REST，WebSocket 只负责事件投递。
- Agent CLI 的原生 NDJSON/JSONL/JSON 输出由对应的 `Parser`（如 `NDJSONStreamParser`）逐行解析后发射为 typed bus event，再通过 WebSocket 推送给订阅者。

## 后果

- 需要自建 cursor 重连机制：客户端断线后携带 `?cursor=...` 重连，服务端 replay `seq > cursor` 的事件。如果 cursor 过期，客户端需拉 REST snapshot 重建状态。
- NDJSON 无原生 HTTP/2 多路复用，但在桌面本地通信场景下影响可忽略。
- 双向通信能力带来控制协议复杂度（如通过 stdin 发送 `interrupt` 消息取消 Agent 运行），需要在 WebSocket 事件类型中增加 `approval` 和 `control` 类事件。
- 各 CLI 的原生输出格式不完全一致（NDJSON vs JSONL vs JSON），需要为每种 CLI 编写独立的 Parser adapter。

## 备选方案

- **SSE（Server-Sent Events）**：单向推送，无法承载 UI 侧的控制指令（取消、审批等）。需要额外 HTTP 端点配合，增加状态同步复杂性。被否决。
- **gRPC Stream**：强类型、双向流，但需要 protobuf 编译步骤，且 Desktop 端的 JavaScript gRPC 客户端较重。被否决。
- **MessagePack**：二进制格式压缩率好，但不可读，调试困难，且前端生态不如 JSON 成熟。被否决。
