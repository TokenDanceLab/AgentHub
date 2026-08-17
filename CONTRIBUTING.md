# Contributing to AgentHub

最后更新：2026-08-17

本文件是唯一贡献入口。旧详细贡献指南见 [docs/history.md](docs/history.md)。

## Start

1. Read [AGENTS.md](AGENTS.md) first. It is the project rule SSOT.
2. Read [docs/developer-quickstart.md](docs/developer-quickstart.md) for local setup.
3. Start from the latest `master`: create a `feat/<topic>` (or `docs/<topic>`) branch, or use a `.worktrees/` worktree. `master` 禁直接 push，全部通过 PR squash merge（AGENTS.md §6 是 SSOT）。

## Branch lifecycle

- One branch owns one issue or one coherent slice. Use `feat/`, `fix/`, `refactor/`, `test/`, `ci/`, `docs/`, or `chore/` plus a short topic; do not create long-lived `dev/*` integration branches.
- Before coding, refresh from `origin/master`; after each meaningful slice, run the narrowest local gate. Keep the branch rebased or fast-forwardable, but do not rewrite a shared branch.
- Open the PR as soon as the slice is reviewable. The PR title and eventual squash commit use the same Conventional Commit form; the body must state the evidence level and skipped gates honestly.
- Merge only through GitHub **Squash and merge** after the required checks pass and conversations are resolved. The protected `master` branch rejects direct pushes, force pushes, deletions, non-linear history, and unverified required checks.
- After merge, delete the remote branch and remove the matching `.worktrees/<topic>/` directory. Do not keep merged branches as a second backlog.

## Commit Format

```text
type(scope): 中文摘要
```

Allowed types (SSOT in AGENTS.md): `feat|fix|docs|refactor|chore|test|perf|ci|revert`.

Common scopes: `client|edge|api|docs|desktop|web|hub|shared|ci`.

## Pull Requests

- Keep PRs scoped to one issue or one coherent change.
- State evidence honestly: fixture, Playwright UI, Visual QA, stubbed Hub, observed-local, approved-real, backend/API, performance/leak, or packaged-release.
- Do not claim real login, real model/API spend, packaged Desktop, signing, installer, release upload, or production deploy unless the matching approved gate ran.
- Run the focused checks named by the touched files and include command evidence in the PR body.
- Before requesting merge, confirm `git status --short --branch` is understood, generated artifacts are ignored, and no unrelated WIP is included.

## License

Apache-2.0. By contributing, you agree to license your work under the same terms.
