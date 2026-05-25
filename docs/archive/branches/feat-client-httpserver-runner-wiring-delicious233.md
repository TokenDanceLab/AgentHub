# feat/client-httpserver-runner-wiring-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 用自动化测试证明 Edge HTTP server 能把 `Config.ProcessExecutor` 装配进 API Handler，并让 `POST /v1/runs` 走 `ProcessExecutor`。

## 写入范围

- `edge-server/internal/httpserver/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/archive/branches/feat-client-httpserver-runner-wiring-delicious233.md`

## 已完成

- [x] 提取 `newHandlerFromConfig`，让 `Run` 和测试复用同一条 Handler 构造路径。
- [x] 增加默认配置测试，确认未配置进程 executor 时仍保持 Handler 默认 mock 延迟装配。
- [x] 增加进程 executor 装配测试，确认配置后 Handler 使用 `*lifecycle.ProcessExecutor`，且 `POST /v1/runs` 可产生 `run.started` 和 `run.finished`。
- [x] 未修改公共 REST / WebSocket 契约。

## 下一步

- [ ] 后续真实 Runner adapter 接入时，继续复用 HTTP server wiring 测试保护启动参数到 Handler 的装配路径。

## 验收

- [x] `cd edge-server; go test -count=1 ./internal/httpserver`
- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
