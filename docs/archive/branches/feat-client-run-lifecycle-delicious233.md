# feat/client-run-lifecycle-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 完成客户端 M2 Run lifecycle 解耦，把 Edge HTTP handler 内置 mock flow 抽成可替换 `RunExecutor` 边界。

## 写入范围

- `edge-server/internal/api/`
- `edge-server/internal/lifecycle/`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-run-lifecycle-delicious233.md`

## 已完成

- [x] 新增 Edge 侧 `lifecycle.RunExecutor` 接口和默认 `MockExecutor`。
- [x] `PostRuns` 只负责创建 run、发布 `run.queued`、写入初始 run item，并调用 executor。
- [x] `run.started`、`run.output.batch`、`run.finished`、`run.failed`、`run.cancelled` 由 executor 管理。
- [x] `PostCancelRun` 优先调用 executor 取消运行中 run；executor 找不到时保持兼容响应，返回已有 run 状态或 `cancelling`。
- [x] 新增 handler fake executor 测试和 lifecycle mock executor 状态/事件测试。

## 验收

- [x] 基线 `git diff --check` 通过。
- [x] 基线 `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 通过。
- [x] 基线 `cd edge-server; go test ./...` 通过。
- [x] 基线 `cd runner; go test ./...` 通过。
- [x] 收口 `git diff --check` 通过。
- [x] 收口 `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 通过。
- [x] 收口 `cd edge-server; go test ./...` 通过。
- [x] 收口 `cd runner; go test ./...` 通过。

## 下一步

- [ ] 在 M3 真实 Runner 中实现新的 `RunExecutor` adapter，接入 CLI Agent 进程、日志、取消和错误映射。
