# 客户端路线图

最后更新：2026-05-23

## 负责范围

- Desktop
- Runner
- Edge 本地调度
- Agent CLI 进程
- workspace / worktree / diff / preview / approval

## 当前目标

推进 M2 Edge 本地数据层，把 M1 的内存事件流升级为 Project / Thread / Run / Item / Event 模型。当前 PR #30 已完成内存态最小模型，`feat/client-thread-messages-delicious233` 已补 message/item 写入链路，`feat/client-run-lifecycle-delicious233` 已抽出 Edge Run lifecycle executor 边界，后续继续补持久化和真实 Runner adapter。

## 近期任务

- [x] 设计 Edge 本地 store 的最小边界。
- [x] 实现 Project / Thread / Run / Item 基础模型。
- [x] 让 EventStore 负责分配 `seq` 并支持按 cursor 重放。
- [x] 将 `POST /v1/runs` 绑定到 `projectId` / `threadId`，并保留 M1 空 body 兼容路径。
- [x] 补齐 Project / Thread / Item 查询接口。
- [x] 同步 `api/openapi.yaml`。
- [ ] 抽象可替换 store 接口并评估 SQLite / 文件持久化。
- [x] 补齐 `POST /v1/threads/{threadId}/messages` 到 Item / event 的写入链路。
- [x] 抽出 Edge Run lifecycle executor 边界，替换 handler 内置 mock flow。
- [ ] 将真实 Runner adapter 接入 Edge Run lifecycle。
- [ ] 细化 Project / Thread / Item 的 OpenAPI 响应 schema。

## 依赖

- `docs/client-handoff.md`
- `api/openapi.yaml`
- `api/events.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

## 验收

- [x] `cd edge-server; go test ./...`
- [x] `cd runner; go test ./...`
- [x] `cd app/desktop; pnpm test`
- [x] `cd app/desktop; pnpm build`
- [ ] `pnpm test:e2e`
- [ ] `.\scripts\client-smoke.ps1`
