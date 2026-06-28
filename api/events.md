# WebSocket Events

最后更新：2026-06-27

本文件是 WebSocket 事件合同入口，只保留协议边界、源码 owner 和验收命令。旧长版事件说明见 [../docs/history.md](../docs/history.md)。

## Owner

| 层 | 当前 owner | 说明 |
|---|---|---|
| Edge envelope | `app/shared/src/events.ts` | 前端消费的 `EventEnvelope` 类型 |
| Edge event bus | `edge-server/internal/events/` | Edge 事件发布、订阅、背压和 gap |
| Runtime event names | `edge-server/internal/adapters/adapter.go` | `run.agent.*` adapter 事件常量 |
| Hub WS frame | `hub-server/internal/ws/frame.go` | Hub `{type, seq_id?, payload?}` 帧和 33 个事件常量 |
| Hub runtime replay | `hub-server/internal/service/agent_edge_callback.go` | `agent.stream` 和聊天消息投影 |
| Transcript normalization | `app/shared/src/transcript/` | Edge/Hub event 到聊天流的归一化 |

新增或改名事件时，先改对应源码 owner，再同步本文件的事件族摘要、`api/openapi.yaml` 的 WS schema 引用、相关 normalizer/tests。

## Edge EventEnvelope

Edge 和 shared transcript 使用统一 envelope：

```json
{
  "version": "v1",
  "id": "evt_01HX...",
  "seq": 42,
  "type": "run.agent.tool_call",
  "scope": {
    "projectId": "proj_1",
    "conversationId": "conv_1",
    "threadId": "thread_1",
    "runId": "run_1",
    "edgeId": "edge_1"
  },
  "traceId": "trace_01HX...",
  "sentAt": "2026-05-22T12:00:00Z",
  "payload": {}
}
```

规则：

- `seq` 在同一 stream 内单调递增；断线恢复用 cursor 或最后处理事件 ID。
- 服务端不能回放时发送 `system.gap` 或 `error`，客户端重新拉 REST snapshot。
- Runner stdout/stderr 应合并成 `run.output.batch`，不要逐行刷 UI。
- Provider-specific 字段停留在 adapter 边界；进入 transcript 前必须脱敏 token、authorization header、绝对路径和 provider trace body。

## Hub Frame

Hub `/client/ws` 使用扁平 frame：

```json
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_1"}}
```

规则：

- `/client/ws` 只接受 Hub-issued HS256 access token，TokenDance ID RS256 bearer 不能成为 Hub WebSocket session。
- `seq_id` 是服务端保留排序/游标字段，客户端不得写入。
- Hub frame 与 Edge `EventEnvelope` 不同；需要进入 shared transcript 时，先经 Hub runtime/message normalizer 转成 transcript blocks。

## Event Families

| 族 | 代表事件 | Owner / 测试 |
|---|---|---|
| IM / Project | `project.created`, `thread.created`, `message.created`, `item.created`, `thread.pin.created` | `app/shared/src/events.ts`, Edge store/API tests |
| Run lifecycle | `run.queued`, `run.started`, `run.output.batch`, `run.finished`, `run.failed`, `run.cancelled` | Edge lifecycle/API tests |
| Runtime adapter | `run.agent.text_delta`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.permission_requested`, `run.agent.permission_decided`, `run.agent.result` | `edge-server/internal/adapters/*`, `app/shared/src/transcript/*` tests |
| Artifact / preview | `artifact.created`, `preview.ready`, `preview.stopped` | Edge evidence store and preview tests |
| Hub IM | `auth.ok`, `message.new`, `message.edited`, `message.reaction_added`, `session.created`, `device.online` | `hub-server/internal/ws/frame.go`, Hub WS tests |
| Hub Agent/Team | `agent.dispatch`, `agent.stream`, `agent.done`, `agent.control`, `team.run.started`, `team.event` | Hub service/tests and TeamRun tests |
| Common | `error`, `system.gap` | Shared parser and reconnect tests |

Runtime adapter coverage is kept as a compact inventory because `edge-server/internal/adapters/event_contract_test.go` treats documentation coverage as part of the source contract:

- Output/session: `run.agent.text_delta`, `run.agent.text_block`, `run.agent.thinking`, `run.agent.session_init`, `run.agent.session_state_changed`, `run.agent.status_change`, `run.agent.result`.
- Tool/file/permission: `run.agent.tool_call`, `run.agent.mcp_tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.tool_use_summary`, `run.agent.tool_rejected`, `run.agent.permission_requested`, `run.agent.permission_decided`.
- Context/rate/runtime: `run.agent.route_decision`, `run.agent.compact_boundary`, `run.agent.api_retry`, `run.agent.auth_status`, `run.agent.rate_limit`, `run.agent.cli_invocation_plan`, `run.agent.session_metrics`, `run.agent.context_usage`, `run.agent.context_warning`, `run.agent.context_compaction`.
- Task/subagent/hooks: `run.agent.task_started`, `run.agent.task_dispatched`, `run.agent.task_dispatch_failed`, `run.agent.task_progress`, `run.agent.task_notification`, `run.agent.sub_agent_status`, `run.agent.sub_agents_complete`, `run.agent.hook_started`, `run.agent.hook_progress`, `run.agent.hook_response`.
- Approval/surfacing extensions: `run.agent.plan_proposed`, `run.agent.plan_approved`, `run.agent.plan_rejected`, `run.agent.plan_expired`, `run.agent.surfaced_artifact`, `run.agent.surfaced_preview`, `run.agent.surfaced_diff`, `run.agent.surfaced_deploy`.

When a new event must be visible in chat, add or update a shared transcript test before changing UI rendering. Do not put debug, mock, or mode metadata into the main transcript bubbles.

## Fixture And Real-Evidence Boundary

Adapter fixture mappings are no-spend contracts. They may prove parser shape, redaction, replay shape, or transcript normalization, but they do not prove real login, real CLI/model/API execution, production deploy, or packaged Desktop behavior.

Use `.agents/skills/real-e2e-acceptance/SKILL.md` for evidence labels. Stub/fixture/readiness reports must say `real_tested=false`; approved-real paths require explicit approval and no silent fallback.

## Verification

Minimum checks after event contract changes:

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
pwsh ./scripts/verify/verify-real-e2e-contract.ps1
```

Add focused Go, shared Vitest, Desktop/Web Playwright, Visual QA, performance/leak, or packaged-release gates based on the touched owner paths and the claim being made.
