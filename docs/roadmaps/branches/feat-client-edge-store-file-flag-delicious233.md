# feat/client-edge-store-file-flag-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 让 Edge Server 启动入口支持可选文件持久化 store。

## 写入范围

- `edge-server/cmd/agenthub-edge/`
- `edge-server/internal/httpserver/`
- `edge-server/internal/store/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-edge-store-file-flag-delicious233.md`

## 已完成

- [x] 新增启动参数 `--store-file <path>`，传入后使用 `store.NewFile(path)`。
- [x] 未传 `--store-file` 时继续使用内存 store，保持默认启动行为。
- [x] 将 `httpserver.Config` 扩展为可注入 `store.Repository`，不改变 REST API 或 WebSocket event。
- [x] 为启动参数解析和 store 构造逻辑补充单元测试，覆盖默认内存 store、文件 store 和坏 JSON 启动失败错误。
- [x] 修复交叉 review 发现的启动期可写性缺口：`store.NewFile(path)` 加载 snapshot 后立即保存一次当前 snapshot，确保父目录可创建、目标文件可写、JSON 可编码。
- [x] 补充父路径被普通文件占用的启动失败测试，避免 Windows 权限位差异导致用例不稳定。

## 验收

- [x] 局部 `cd edge-server; go test -count=1 ./internal/store ./cmd/agenthub-edge` 通过。
- [x] 收口 `git diff --check` 通过。
- [x] 收口 `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 通过。
- [x] 收口 `cd edge-server; go test -count=1 ./...` 通过。
- [x] 收口 `cd runner; go test -count=1 ./...` 通过。

## 下一步

- [ ] 将真实 Runner adapter 接入 Edge Run lifecycle。
- [ ] 后续按需要评估 SQLite 持久化方案。
