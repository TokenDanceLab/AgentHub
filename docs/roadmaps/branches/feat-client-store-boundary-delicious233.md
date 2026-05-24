# feat/client-store-boundary-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 完成客户端 M2 Edge store 可替换边界，让 handler 和 lifecycle 依赖稳定接口，同时保留默认内存实现。

## 写入范围

- `edge-server/internal/store/`
- `edge-server/internal/api/`
- `edge-server/internal/lifecycle/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-store-boundary-delicious233.md`

## 已完成

- [x] 在 `edge-server/internal/store` 定义 `Reader`、`Writer`、`Repository` 和 `RunLifecycleStore` 接口。
- [x] 保留 `Store` 作为内存实现，`store.New()` 继续返回默认内存 store。
- [x] `api.Handler.Store` 改为依赖 `store.Repository`，默认 store 初始化和 REST 行为保持不变。
- [x] `lifecycle.MockExecutor` 改为依赖 `store.RunLifecycleStore`，只要求 run 查询和状态更新能力。
- [x] 补充编译期接口断言、handler 注入 repository 测试和 lifecycle 最小 fake store 测试。

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

- [ ] 评估 SQLite 与文件持久化方案，选择 Edge store 的首个持久化实现。
- [ ] 在 M3 真实 Runner 中实现 `RunExecutor` adapter，接入 CLI Agent 进程、日志、取消和错误映射。
