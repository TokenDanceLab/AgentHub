# feat/client-runner-profile-preset-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 为 Edge 启动入口增加可测试的 `agenthub-runner-mock` Runner profile preset。

## 写入范围

- `edge-server/cmd/agenthub-edge/`
- `runner/README.md`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/archive/branches/feat-client-runner-profile-preset-delicious233.md`

## 已完成

- [x] 新增 `--runner-profile` CLI 参数，默认空值保持原有内置 MockExecutor 行为。
- [x] 支持 `agenthub-runner-mock` preset，默认生成 `agenthub-runner --mock`。
- [x] 支持 `--runner-command` 覆盖 command，同时保留 preset 默认参数。
- [x] 保留用户追加的 `--runner-arg`、`--runner-env` 和 `--runner-workdir`。
- [x] 对未知 profile 返回清晰配置错误。
- [x] 修复 review 反馈：明确 `--runner-command` 只接受单个可执行入口，并补 profile + env 未知占位符回归测试。

## 下一步

- [ ] 后续分支继续接入真实 Runner adapter，不在本分支接 Claude Code / Codex / OpenCode。

## 验收

- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
