# AgentHub Protocol v1

This directory is the single protocol source for AgentHub.

Planned schema groups:

- `common.proto` — ids, timestamps, actor, authority and shared envelopes.
- `im.proto` — conversation, thread, turn, item and message contracts.
- `agent.proto` — agent profile, capability, runtime status and AgentRun lifecycle.
- `runner.proto` — RunnerCommand, RunnerEvent, logs, diff and preview events.
- `artifact.proto` — artifact metadata, locations, diff references and preview routes.
- `sync.proto` — EdgeEvent, Hub sync ack, replay cursors and outbox status.
- `relay.proto` — Edge registration, heartbeat and Hub-to-Edge relay commands.

Generated outputs belong in:

```text
packages/protocol/go/
packages/protocol/ts/
```

Do not hand-maintain separate Go and TypeScript protocol shapes.
