# Agent protocols and SDK strategy

最后更新：2026-10-18（合并 SDK 策略与 Agent Protocol 兼容性）

本文是 AgentHub 对外部 Agent SDK 和 Agent Protocol 兼容层的轻量策略摘要。

## 1. SDK 策略

AgentHub 必须拥有自己的产品层 Agent 模型。Claude SDK、OpenAI Agents SDK、Codex、OpenCode 和未来 SDK 都只能作为 Edge runtime adapter 或 provider experiment，不能替代 Hub/Web/Desktop 暴露给用户的 Agent Profile、TeamRun、Execution Target、approval、memory 或 evidence 模型。

```text
AgentHubAgentSpec / Agent Profile / TeamRun
  -> Edge runtime adapter contract
    -> CLI or SDK implementation detail
```

| 层 | Owns | Must not own |
|---|---|---|
| Hub | Agent Profile identity、TeamRun、approval、audit、marketplace intent | provider SDK objects、raw SDK sessions |
| Edge | runtime adapters、event normalization、tool/MCP execution boundary | Hub orchestration authority、product Agent identity |
| Web/Desktop | AgentHub-owned fields、approval UX、evidence display | SDK classes、provider credentials、raw SDK objects |
| Tauri host | Desktop bridge、Local Edge lifecycle | direct SDK execution bypassing Edge |

**AgentHubAgentSpec 状态**：目前只有 fixture 与 OpenAPI component-only draft，不是已实现的 endpoint request/response。Product-owned fields 包括 identity/display/role、runtime preference（不是 runtime ownership）、execution target preference 与 workspace policy、tools/MCP/approval/memory/evidence/handoff；`sdkOptions` 只是 adapter experiment metadata。

**实验边界**：SDK mapper 与 golden tests 不依赖 live 执行；显式启用的 live SDK adapter 属于 Edge runtime 路径，任何 live model/API 执行必须走 `scripts/verify/verify-real-e2e-contract.py` 的 approved-real 边界；Web/Desktop/Tauri 不直接 import SDK、不保存 provider credential、不展示 provider-native session object。

## 2. Agent Protocol 兼容性

AgentHub 不是 Agent Protocol 的 drop-in implementation。两者概念层相近，但 AgentHub 使用 Hub/Edge 双层 API、TokenDance ID OIDC + Hub session、本地/远程 Execution Target、IM 会话和 TeamRun 编排。

如果要做 Agent Protocol 兼容网关，应在网关层完成 API key / Agent Protocol schema 到 AgentHub Hub session / Edge token / AgentHub schema 的转换；不要把 Agent Protocol 直接变成 AgentHub 内部产品模型。

| Agent Protocol | AgentHub Edge | AgentHub Hub | Notes |
|---|---|---|---|
| Runs | `/v1/runs` | `/web/agent-tasks`, `/web/agent-teams/:id/runs` | Edge 最接近本地 run；Hub 负责任务和 TeamRun 协作 |
| Threads | `/v1/threads` | `/client/sessions`, `/web/projects/:id/threads` | Hub session 还包含 IM 私聊/群聊语义 |
| Store | none | `/web/documents`, `/client/settings` | AgentHub Store 是文档/设置，不是低延迟 runtime KV |
| Wait/stream | `/v1/events` WebSocket | Hub WebSocket / event endpoints | AgentHub 偏 typed event stream，不是 HTTP wait |
| Auth | Edge local token / Edge bearer | TokenDance ID OIDC → Hub-issued session | Agent Protocol API key 不可直接复用 |

行为差异：cancel run 使用 action endpoint，不是 `DELETE`；Hub session/thread 含 IM membership、pin/archive/mute、群聊信息和审计；Web 不直连 Local Edge；Hub session、Edge token 和 TokenDance API key 语义不同，不能混用。

**Implementation rule**：任何兼容层必须作为 adapter/gateway 明确标注，不能改写 AgentHub 内部 API SSOT：REST SSOT `api/openapi.yaml`，WebSocket SSOT `api/events.md`，架构入口 `docs/architecture.md`，安全/授权约定见 `docs/architecture/06-auth-identity.md`，漏洞报告见 `SECURITY.md`。

## 3. Review checklist

- 是否保持 Agent Runtime / Agent Profile / Agent Configuration / Execution Target 术语分离？
- SDK 对象是否被限制在 Edge adapter 以下？
- Tool/MCP/approval/memory/evidence 是否仍由 AgentHub policy 和合同拥有？
- 测试是否默认 fixture-only，除非有明确 approved-real？
- 文档和 PR 是否没有宣称真实模型/API、真实 MCP 或 production 能力？
