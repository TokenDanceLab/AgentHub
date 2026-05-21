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
- Hook files live in `.githooks/`, but they are optional local helpers.
- Enable local hooks with `git config core.hooksPath .githooks` if wanted.
- GitHub branch protection is the actual shared guard.

## 3. Branch Management

AgentHub uses a lightweight trunk-based workflow. Do not use GitFlow.

### Main Branch

- `master` is the protected stable branch and should always be readable, demoable and easy to continue from.
- Code, protocol and service layout changes should land through a pull request.
- Direct `master` commits are only for maintainers/admins doing small docs/process cleanup with low risk. Prefer a PR when unsure.

### Branch Names

Use lowercase kebab-case:

```text
<type>/<short-topic>
```

Allowed branch types:

| type | usage |
|------|-------|
| `feat/` | product or architecture feature work |
| `fix/` | bug or broken-doc fix |
| `docs/` | documentation-only work |
| `chore/` | repo process, labels, scripts, tooling |
| `refactor/` | restructuring without behavior change |
| `spike/` | time-boxed research or experiment; must not become long-lived |
| `codex/` | Codex-created working branch when the app creates one automatically |

Examples:

```text
docs/branch-workflow
chore/github-labels
feat/runner-command-protocol
spike/multica-runtime-model
```

### Pull Requests

- Keep PRs small enough for one teammate to review in one sitting.
- Link the relevant GitHub issue when one exists.
- For code PRs, include the verification command or explain why it cannot run yet.
- For protocol PRs, update `proto/agenthub/v1` first, then generated Go/TypeScript outputs once generation exists.
- For docs-only PRs, a concise summary is enough.
- Current GitHub protection requires a PR path but does not require CI or an approving review yet.

### Merge Rules

- Prefer squash merge for short feature branches.
- Delete merged branches.
- Do not keep personal long-lived branches.
- Rebase or merge `master` before merging if the branch touches protocol, service layout or shared package ownership.
- `master` protection blocks force-pushes and branch deletion.

### Team Size Rule

This is a three-person project. If a rule creates more coordination work than it prevents, simplify the rule and update this file.

## 4. Repository Structure

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

## 5. Documentation

- `docs/architecture.md` — Hub-Edge-Runner topology (authority)
- `docs/reference/README.md` — research index (Agent navigation guide)
- `docs/reference/01-learn/` — external repo deep-dives + source extraction
- `docs/reference/02-decide/` — cross-repo comparison and trade-off analysis
- `docs/reference/03-build/` — engineering specifications (backend + frontend)
- `docs/reference/04-plan/` — roadmap and impact analysis

## 6. Agent Collaboration Rules

- Before writing any code, read relevant `docs/reference/` documents
- Adapter design: follow `03-build/backend/04-adapter-sdk.md`
- Protocol changes: update `proto/agenthub/v1` first, regenerate Go+TS, then implement
- New research findings: add to appropriate `01-learn/` or `02-decide/` path
- Commit messages in English, Conventional Commits format
