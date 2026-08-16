# SDK Agent Strategy

最后更新：2026-08-16

本文档是轻量策略摘要。旧长版调研和 PoC backlog 见 [../history.md](../history.md)。

## Decision

AgentHub 必须拥有自己的产品层 Agent 模型。Claude SDK、OpenAI Agents SDK、Codex、OpenCode 和未来 SDK 都只能作为 Edge runtime adapter 或 provider experiment，不能替代 Hub/Web/Desktop 暴露给用户的 Agent Profile、TeamRun、Execution Target、approval、memory 或 evidence 模型。

```text
AgentHubAgentSpec / Agent Profile / TeamRun
  -> Edge runtime adapter contract
    -> CLI or SDK implementation detail
```

## Boundaries

| 层 | Owns | Must not own |
|---|---|---|
| Hub | Agent Profile identity、TeamRun、approval、audit、marketplace intent | provider SDK objects、raw SDK sessions |
| Edge | runtime adapters、event normalization、tool/MCP execution boundary | Hub orchestration authority、product Agent identity |
| Web/Desktop | AgentHub-owned fields、approval UX、evidence display | SDK classes、provider credentials、raw SDK objects |
| Tauri host | Desktop bridge、Local Edge lifecycle | direct SDK execution bypassing Edge |

## AgentHubAgentSpec Draft Rule

`AgentHubAgentSpec` 可以作为 fixture 或 OpenAPI component-only draft 继续推进，但不能被描述成已实现 endpoint request/response，除非后续任务明确接入。

Product-owned fields include:

- identity / display / role
- runtime preference, not runtime ownership
- execution target preference and workspace policy
- tools, MCP, approval, memory, evidence, handoff
- `sdkOptions` only as adapter experiment metadata

## Experiment Policy

- 首轮 SDK 工作用 fixture mapper 和 golden tests，不跑 live SDK/model。
- SDK event 只能映射到 AgentHub runtime events 和 evidence refs。
- 任何 live SDK/model/API 执行必须走 `scripts/verify/verify-real-e2e-contract.py` 的 approved-real 证据边界。
- Web/Desktop/Tauri 不直接 import SDK、不保存 provider credential、不展示 provider-native session object。

## Review Checklist

- 是否保持 Agent Runtime / Agent Profile / Agent Configuration / Execution Target 术语分离？
- SDK 对象是否被限制在 Edge adapter 以下？
- Tool/MCP/approval/memory/evidence 是否仍由 AgentHub policy 和合同拥有？
- 测试是否默认 fixture-only，除非有明确 approved-real？
- 文档和 PR 是否没有宣称真实模型/API、真实 MCP 或 production 能力？
