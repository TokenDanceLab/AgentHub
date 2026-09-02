# Contributing to AgentHub

最后更新：2026-08-17

本文件是唯一贡献入口。旧详细贡献指南见 [docs/history.md](docs/history.md)。

## Start

1. Read [AGENTS.md](AGENTS.md) first. It is the project rule SSOT.
2. Read [docs/developer-quickstart.md](docs/developer-quickstart.md) for local setup.
3. Start from the latest `master`: create a `feat/<topic>` (or `docs/<topic>`) branch, or use a `.worktrees/` worktree. `master` 禁直接 push，全部通过 PR squash merge（分支、worktree 与 squash 规则以 [AGENTS.md](AGENTS.md) 为 SSOT）。

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

## Build / Test / Lint

完整命令速查见 [docs/developer-quickstart.md](docs/developer-quickstart.md) §测试速查（SSOT）。
每个 `make` 目标实际跑什么以根 `Makefile` 为准，本文件只列目标名不复述其内容（防漂移）。常用入口：

```bash
make test          # L0 后端单元（Makefile `test` 目标闭包，不含前端）
make fe-test       # L0 前端单元（Makefile `fe-test` 目标）
cd hub-server && go test ./... -short -count=1   # Hub 单元
cd edge-server && go test ./... -short -count=1  # Edge 单元
make test-hub-integration                         # L1 集成（先 scripts/dev/dev-up.sh 起 PG/Redis）
python scripts/verify/verify-doc-ssot.py          # 文档/规则一致性门禁
```

改动文件对应的最窄 gate 优先；宣称 merge-ready 前跑对应完整 gate（测试分层与 CI job 映射见 [AGENTS.md](AGENTS.md) 的“测试分层（L0-L4）”）。

## Pull Requests

- Keep PRs scoped to one issue or one coherent change.
- State evidence honestly: fixture, Playwright UI, Visual QA, stubbed Hub, observed-local, approved-real, backend/API, performance/leak, or packaged-release.
- Do not claim real login, real model/API spend, packaged Desktop, signing, installer, release upload, or production deploy unless the matching approved gate ran.
- Run the focused checks named by the touched files and include command evidence in the PR body.
- Before requesting merge, run `git diff --check`, confirm `git status --short --branch` is understood, generated artifacts are ignored, and no unrelated WIP is included.
- 行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；发现安全漏洞请按 [SECURITY.md](SECURITY.md) 的私密渠道报告，不要公开 issue。

## License

Apache-2.0. By contributing, you agree to license your work under the same terms.
