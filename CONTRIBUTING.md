# Contributing to AgentHub

欢迎贡献！所有开发规范、环境搭建、PR 流程和代码规范请阅读 [docs/contributing.md](docs/contributing.md)。

快速上手看 [docs/developer-quickstart.md](docs/developer-quickstart.md)。

## Getting Started

1. 克隆并切换开发分支：
   ```bash
   git clone https://github.com/TokenDanceLab/AgentHub.git
   cd AgentHub
   git checkout dev/delicious223
   ```

2. 启用 git hooks：
   ```bash
   # Windows
   .\scripts\setup.ps1
   # macOS / Linux
   ./scripts/setup.sh
   ```

3. 阅读 `AGENTS.md` 了解项目规范和约束。

## Commit Format

```
type(scope): 中文摘要
```

type: `init|feat|fix|docs|refactor|chore|test|perf|ci|revert`
scope: `client|edge|api|docs|desktop|web`

## License

Apache-2.0. By contributing, you agree to license your work under the same terms.
