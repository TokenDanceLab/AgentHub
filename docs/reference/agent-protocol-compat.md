# Agent Protocol Compatibility Reference

最后更新：2026-06-27

本文档是轻量兼容性摘要。旧长版端点示例见 [../history.md](../history.md)。

## Compatibility Statement

AgentHub 不是 Agent Protocol 的 drop-in implementation。两者概念层相近，但 AgentHub 使用 Hub/Edge 双层 API、TokenDance ID OIDC + Hub session、本地/远程 Execution Target、IM 会话和 TeamRun 编排。

如果要做 Agent Protocol 兼容网关，应该在网关层完成 API key / Agent Protocol schema 到 AgentHub Hub session / Edge token / AgentHub schema 的转换；不要把 Agent Protocol 直接变成 AgentHub 内部产品模型。

## Concept Mapping

| Agent Protocol | AgentHub Edge | AgentHub Hub | Notes |
|---|---|---|---|
| Runs | `/v1/runs` | `/web/agent-tasks`, `/web/agent-teams/:id/runs` | Edge 最接近本地 run；Hub 负责任务和 TeamRun 协作 |
| Threads | `/v1/threads` | `/client/sessions`, `/web/projects/:id/threads` | Hub session 还包含 IM 私聊/群聊语义 |
| Store | none | `/web/documents`, `/client/settings` | AgentHub Store 是文档/设置，不是低延迟 runtime KV |
| Wait/stream | `/v1/events` WebSocket | Hub WebSocket / event endpoints | AgentHub 偏 typed event stream，不是 HTTP wait |
| Auth | Edge local token / Edge bearer | TokenDance ID OIDC -> Hub-issued session | Agent Protocol API key 不可直接复用 |

## Behavioral Differences

- AgentHub cancel run 使用 action endpoint；不是简单 HTTP `DELETE`。
- Hub session/thread 语义包含 IM membership、pin/archive/mute、群聊信息和审计。
- Web 不直连 Local Edge；远程执行必须通过 Hub routing/relay 和 Execution Target。
- Hub 和 Edge 的 token 语义不同，不能把 TokenDance ID token、Hub session、Edge token、TokenDance API key 混用。

## Implementation Rule

任何兼容层必须作为 adapter/gateway 明确标注，不能改写 AgentHub 内部 API SSOT：

- REST SSOT：`api/openapi.yaml`
- WebSocket SSOT：`api/events.md`
- 架构入口：`docs/architecture.md`
- 安全/授权风险：`SECURITY.md`（SSOT 在 TokenDance 私有治理文档）
