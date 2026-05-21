# AGENTS.md — AgentHub Project Rules

## 0. Priority
1. Administrator direct instructions
2. This file
3. `.agenthub/` project memory
4. `docs/reference/` research documents

## 1. Platform Support

| Platform | UI | Agent Execution | Notes |
|----------|:--:|:---------------:|-------|
| Windows | Web + Tauri | Yes (WSL/native) | Primary desktop target |
| macOS | Web + Tauri | Yes | Full CLI toolchain support |
| Linux | Web | Yes | Primary Runner/Server target |
| iOS | PWA | No | Control console only |
| Android | PWA | No | Control console only |
| Web | Browser | No (needs Edge node) | Remote control console |

> Mobile and Web are **control consoles** — they connect to an Edge node for Agent execution. Only Desktop platforms run the full stack locally.

## 2. Git — Conventional Commits

```
type(scope): English description
```

| type | usage |
|------|-------|
| `init` | project initialization |
| `feat` | new feature |
| `fix` | bug fix |
| `docs` | documentation only |
| `refactor` | code restructuring |
| `chore` | build, deps, tooling |
| `test` | testing |
| `perf` | performance improvement |
| `ci` | CI/CD changes |
| `revert` | revert previous commit |

- Scope optional, lowercase `[a-z0-9._-]+`
- Description lowercase English, no trailing period, max 72 chars
- Hook enforces at `.githooks/commit-msg`
- Template at `.githooks/prepare-commit-msg`

## 3. Repository Structure

```
AgentHub/
├── apps/           # TS frontends (web, desktop, mobile)
├── services/       # Go backends (hub-server, edge-server, runner)
├── packages/       # shared Go + TS packages
├── proto/          # Protobuf schema, the single protocol source
├── docs/           # product + architecture + reference
├── scripts/        # build, migration, codegen
├── .githooks/      # commit-msg + prepare-commit-msg
└── .agenthub/      # project memory and rules
```

## 4. Documentation

- `docs/architecture.md` — Hub-Edge-Runner topology (authority)
- `docs/reference/README.md` — research index (Agent navigation guide)
- `docs/reference/01-learn/` — external repo deep-dives + source extraction
- `docs/reference/02-decide/` — cross-repo comparison and trade-off analysis
- `docs/reference/03-build/` — engineering specifications (backend + frontend)
- `docs/reference/04-plan/` — roadmap and impact analysis

## 5. Agent Collaboration Rules

- Before writing any code, read relevant `docs/reference/` documents
- Adapter design: follow `03-build/backend/04-adapter-sdk.md`
- Protocol changes: update `proto/agenthub/v1` first, regenerate Go+TS, then implement
- New research findings: add to appropriate `01-learn/` or `02-decide/` path
- Commit messages in English, Conventional Commits format
