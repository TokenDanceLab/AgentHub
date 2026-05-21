# AgentHub Project Management

Date: 2026-05-21

This file records how GitHub issues should be organized.

## Milestones

| Milestone | Meaning |
|---|---|
| M0 architecture contracts | Freeze the contracts that implementation will depend on: protocol, Go layout, authority, data plane, approval/workspace safety, frontend realtime model and research traceability. |
| M1 desktop command center | Build the local Desktop -> Edge -> Runner working loop with project, thread, AgentRun, worktree, logs, diff, approval and preview. |
| M2 multi-agent collaboration | Add `@Agent`, Orchestrator, reviewer flows and multiple agents working around the same artifact. |
| M3 edge-hub sync and remote control | Add Edge registration, sync replay, Web/Mobile status view and remote approval. |
| M4 relay and cloud execution | Add Hub relay, Cloud Edge, Cloud Runner, artifact/preview proxy and audit. |
| M5 team IM and ecosystem | Add complete user/contact/group/team-space features, team memory and extension ecosystem. |

Current GitHub milestone:

- `M0 architecture contracts`

## Labels

Use labels as independent dimensions.

| Prefix | Meaning | Examples |
|---|---|---|
| `kind:` | What type of work this is | `kind:contract`, `kind:docs` |
| `area:` | Which part of the system is touched | `area:protocol`, `area:go-services`, `area:sync`, `area:ui` |
| `priority:` | How much it blocks architecture or implementation | `priority:critical`, `priority:high`, `priority:medium` |
| `risk:` | What can go wrong if ignored | `risk:protocol-drift`, `risk:sync-conflict`, `risk:security` |

Each issue should have:

- one milestone
- one `kind:` label
- one or more `area:` labels
- one `priority:` label
- optional `risk:` labels

## Issue Grouping Rules

Keep issues aggregated around architecture contracts, not tiny file edits.

Good issue shape:

- one contract boundary
- clear owner area
- acceptance criteria
- links to relevant docs
- no unrelated implementation tasks mixed in

Avoid:

- one issue per markdown typo
- one issue per future feature idea
- duplicate issues for Hub, Edge and Runner when the problem is one shared protocol contract
- labels without acceptance criteria

## Branch Workflow

The branch workflow is intentionally small because the team has three people.

| Branch | Rule |
|---|---|
| `master` | Protected stable mainline. Keep it readable, demoable and easy to continue from. |
| short working branches | Use for code, protocol, service layout, UI and risky docs changes. |
| long-lived personal branches | Do not use. They hide integration problems. |

Branch naming:

```text
<type>/<short-topic>
```

Allowed types:

- `feat/`
- `fix/`
- `docs/`
- `chore/`
- `refactor/`
- `spike/`
- `codex/`

Merge policy:

- use PRs for code, protocol and service layout changes
- link the relevant issue
- squash merge short branches
- delete branches after merge
- direct `master` commits are only for maintainers/admins doing small low-risk docs/process cleanup

Current GitHub protection on `master`:

- pull request path required
- required approving reviews: `0`
- required status checks: none
- admins can bypass for emergencies
- force pushes disabled
- branch deletion disabled

## Current M0 Issues

| # | Issue | Purpose |
|---|---|---|
| 1 | Freeze single protocol source, event taxonomy, and typed envelopes | Stop protocol drift between Go services and TypeScript UI. |
| 2 | Align Go service layout, module strategy, and package ownership | Make `services/` and `packages/` compile and import cleanly. |
| 3 | Lock authority, sync-ready EventStore, and data-plane contracts | Separate who owns messages, runs, artifacts and large data paths. |
| 4 | Define approval policy loop and workspace isolation contract | Make risky commands, path guards, worktrees and apply/discard safe. |
| 5 | Align frontend realtime store model with backend protocol | Make WebSocket events, stores and generated event types match. |
| 6 | Refresh research index, competitive coverage, and ByteDance traceability | Keep research, competition material and Multica/Ruflo/Paperclip positioning current. |

## Wording Rule

Use plain terms in issue titles and docs:

- "single protocol source" instead of unexplained abbreviations
- "event history" or "EventStore" depending on context
- "relay" only when Hub forwards traffic between UI and Edge
- "data plane" only when discussing logs, files, diffs, previews or artifact downloads
