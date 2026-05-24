# feat/client-runner-workdir-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 为 Edge 本地进程 executor 增加工作目录配置边界，为后续真实 Claude Code / Codex / OpenCode adapter 在指定 workspace 中运行做准备。

## 写入范围

- `edge-server/internal/lifecycle/`
- `edge-server/cmd/agenthub-edge/`
- `edge-server/internal/httpserver/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-runner-workdir-delicious233.md`

## 已完成

- [x] `ProcessExecutorConfig` 增加 `WorkDir`，非空时构造期验证必须存在且是目录。
- [x] `ProcessExecutor` 启动子进程时设置 `cmd.Dir`。
- [x] `agenthub-edge` 增加 `--runner-workdir`，并拒绝没有 `--runner-command` 的无效组合。
- [x] 使用 Go 自进程 helper 覆盖子进程实际工作目录，不依赖 shell 或真实 Agent CLI。
- [x] 路线图标明本分支只完成本地进程工作目录边界，不是完整真实 Runner adapter。

## 下一步

- [ ] 在后续真实 Runner adapter 分支中接入具体 Claude Code / Codex / OpenCode 命令和 workspace 选择策略。

## 验收

- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
