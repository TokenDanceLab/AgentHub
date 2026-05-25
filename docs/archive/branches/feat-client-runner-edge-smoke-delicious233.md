# feat/client-runner-edge-smoke-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 用自动化测试证明 Edge `ProcessExecutor` 能启动仓库自带 Runner mock CLI，并在 Run 事件流中看到真实 Run / Project / Thread 上下文。

## 写入范围

- `edge-server/internal/lifecycle/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/archive/branches/feat-client-runner-edge-smoke-delicious233.md`

## 已完成

- [x] 在 `process_executor_test.go` 增加真实 Runner mock CLI 集成测试，通过当前 Go 工具链执行 `go run ./cmd/agenthub-runner --mock`。
- [x] 测试断言 `run.started`、stdout `run.output.batch`、stdout 中的 `run=<id>` / `project=<id>` / `thread=<id>` 和最终 `run.finished`。
- [x] 未修改公共 REST / WebSocket 契约。

## 下一步

- [ ] 后续真实 Runner adapter 接入 Edge Run lifecycle 时，复用本测试作为仓库 mock CLI 的回归保护。

## 验收

- [x] `cd edge-server; go test -count=1 ./internal/lifecycle -run TestProcessExecutorRunsRepositoryMockRunnerWithInjectedContext -v`
- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
