# feat/client-runner-context-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 让仓库自带 `agenthub-runner --mock` 读取 Edge ProcessExecutor 注入的 Run 上下文环境变量。

## 写入范围

- `runner/cmd/agenthub-runner/`
- `runner/internal/run/`
- `runner/README.md`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-runner-context-delicious233.md`

## 已完成

- [x] 新增 `RunContext` / `ContextFromEnv` 读取边界，读取 `AGENTHUB_RUN_ID`、`AGENTHUB_PROJECT_ID`、`AGENTHUB_THREAD_ID`。
- [x] `AGENTHUB_RUN_ID` 为空时保留 `mock-run-1` 默认值。
- [x] mock mode 使用 env run ID 创建 `MockRun`，stdout 稳定输出 `run=`、`project=`、`thread=` 三行上下文。
- [x] 同步 Runner README、总路线图和客户端路线图。

## 下一步

- [ ] 继续规划真实 Runner adapter，但不在本分支接 Claude Code / Codex / OpenCode。

## 验收

- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd runner; go test -count=1 ./...`
- [x] `cd edge-server; go test -count=1 ./...`
