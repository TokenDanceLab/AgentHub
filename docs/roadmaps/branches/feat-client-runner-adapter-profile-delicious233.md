# feat/client-runner-adapter-profile-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 为 Edge ProcessExecutor 增加 generic adapter profile / 命令模板最小层，支持从 Run 上下文展开 CLI args/env。

## 写入范围

- `edge-server/internal/lifecycle/`
- `edge-server/cmd/agenthub-edge/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-runner-adapter-profile-delicious233.md`

## 已完成

- [x] 新增 `RunnerProfile`、`CommandTemplate`、`RunProcessContext` 内部边界。
- [x] 支持 `{{run.id}}`、`{{run.projectId}}`、`{{run.threadId}}` 在 args/env 中展开。
- [x] 保留 `--runner-command`、`--runner-arg`、`--runner-workdir` 行为，并新增 repeatable `--runner-env KEY=VALUE`。
- [x] 构造期校验空 command、未知占位符和 env 格式错误。
- [x] 完成交叉 review 后修复环境继承、env 错误脱敏和 `ExtraEnv` 边界，系统环境原样继承，只有显式 `--runner-env` 参与模板展开。

## 下一步

- [ ] 后续分支接入 Claude Code / Codex / OpenCode 具体 adapter profile。

## 验收

- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
