# Contributing to AgentHub

最后更新：2026-07-18

本文件是唯一贡献入口。旧详细贡献指南见 [docs/history.md](docs/history.md)。

## Start

1. Read [AGENTS.md](AGENTS.md) first. It is the project rule SSOT.
2. Read [docs/developer-quickstart.md](docs/developer-quickstart.md) for local setup.
3. Start work from `dev/delicious233`; use a feature branch or `.worktrees/` worktree.

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

## License

Apache-2.0. By contributing, you agree to license your work under the same terms.
