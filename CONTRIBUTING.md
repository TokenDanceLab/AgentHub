# Contributing to AgentHub

最后更新：2026-10-19

本文件是唯一贡献入口。

## Start

1. Read [AGENTS.md](AGENTS.md) first. It is the project rule SSOT.
2. Read [docs/developer-quickstart.md](docs/developer-quickstart.md) for local setup.
3. Start from the latest `master`: create a `feat/<topic>` (or `docs/<topic>`) branch, or use a `.worktrees/` worktree. `master` 禁直接 push，全部通过 PR squash merge（分支、worktree 与 squash 规则以 [AGENTS.md](AGENTS.md) 为 SSOT）。

## Branch lifecycle

- One branch owns one issue or one coherent slice. Use `feat/`, `fix/`, `refactor/`, `test/`, `ci/`, `docs/`, or `chore/` plus a short topic; do not create long-lived `dev/*` integration branches.
- Branch, worktree, rebase, and merge rules live in [AGENTS.md](AGENTS.md) §「Git 和 worktree」. Open the PR once the slice is reviewable; the PR title and eventual squash commit use the same Conventional Commit form.

## Commit Format

```text
type(scope): 中文摘要
```

Allowed types (SSOT: `scripts/verify/verify-commit-messages.sh`): `init|feat|fix|docs|refactor|chore|test|perf|ci|revert`.

Common scopes: `client|edge|api|docs|desktop|web|hub|shared|ci`.

## Build / Test / Lint

命令速查见 [docs/developer-quickstart.md](docs/developer-quickstart.md) §测试速查；目标语义以根 `Makefile` 为准。改动文件对应的最窄 gate 优先；宣称 merge-ready 前跑对应完整 gate（分层与 CI 映射见 [AGENTS.md](AGENTS.md) 的“测试分层（L0-L4）”）。

## Pull Requests

- Keep PRs scoped to one issue or one coherent change.
- State evidence honestly: fixture, Playwright UI, Visual QA, stubbed Hub, observed-local, approved-real, backend/API, performance/leak, or packaged-release.
- Do not claim real login, real model/API spend, packaged Desktop, signing, installer, release upload, or production deploy unless the matching approved gate ran.
- Run the focused checks named by the touched files and include command evidence in the PR body.
- Before requesting merge, run `git diff --check`, confirm `git status --short --branch` is understood, generated artifacts are ignored, and no unrelated WIP is included.
- 行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；发现安全漏洞请按 [SECURITY.md](SECURITY.md) 的私密渠道报告，不要公开 issue。

## License

Apache-2.0. By contributing, you agree to license your work under the same terms.
