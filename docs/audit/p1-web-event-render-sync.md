# P1 Web Event Render Sync

Branch: `codex/p1-web-event-render-sync`
Base: `origin/codex/p1-critical-evidence-integration @ 020d6876`

## Scope

This slice keeps Web Hub-only and improves TeamRun event replay rendering in `app/web/src/views/TeamRunConsole.tsx`.

## Changes

- Merges Hub TeamRun event endpoint rows with `TeamRunState.run_events` so an empty `/events` response no longer hides runtime replay evidence returned by `/state`.
- Unwraps Hub `agent.stream` payloads into their runtime `event_type`, `event_seq`, and nested payload.
- Adds human-readable timeline summaries for current CLI/SDK fixture shapes:
  - `run.agent.tool_call`
  - `run.agent.tool_result`
  - `run.agent.route_decision`
  - `run.agent.permission_requested`
  - `run.agent.task_dispatch_failed`
  - `run.agent.sub_agent_status`
  - `run.agent.result`
  - `artifact.created`
  - `run.agent.file_change`
- Preserves useful IDs in the timeline detail text: Hub task, Edge run, and selected/embedded target ID.

## Verification

- `pnpm --filter agenthub-web test -- src/views/TeamRunConsole.test.tsx`

## Non-Goals

- No backend API, Hub router, Edge runtime, Desktop, Tauri, or mobile changes.
- No direct Web calls to Local Edge, Tauri, localhost runtime, or `/v1/events`.
- No live CLI/model execution and no real remote-control dispatch smoke.
- No roadmap edit.

## Remaining UI Gaps Before Live Demo

- The timeline still uses the existing compact row component, so runtime events are readable text rather than rich tool/result cards.
- TeamRun events are pull/replay based in this view; live WebSocket message sync for selected TeamRun still needs a separate Hub realtime slice.
- Target names are not resolved from execution target inventory inside historical replay; the console shows target IDs when Hub events do not include labels.
- Approval callbacks can be listed and decided, but a full blocking permission round-trip still needs live Desktop/Edge evidence.
