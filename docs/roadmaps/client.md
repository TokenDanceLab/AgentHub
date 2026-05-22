# 客户端路线图

最后更新：2026-05-23

## 负责范围

- Desktop
- Runner
- Edge 本地调度
- Agent CLI 进程
- workspace / worktree / diff / preview / approval

## 当前目标

推进 M2 Edge 本地数据层，把 M1 的内存事件流升级为可持久化的 Project / Thread / Run / Item / Event 模型。

## 近期任务

- [ ] 设计 Edge 本地 store 接口。
- [ ] 实现 Project / Thread / Run / Item 基础模型。
- [ ] 让 EventStore 负责分配 `seq` 并支持按 cursor 重放。
- [ ] 将 `POST /v1/runs` 绑定到 `projectId` / `threadId`。
- [ ] 补齐 Project / Thread / Item 查询接口。
- [ ] 同步 `api/openapi.yaml` 和 `api/events.md`。

## 依赖

- `docs/client-handoff.md`
- `api/openapi.yaml`
- `api/events.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

## 验收

- [ ] `go test ./...`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `.\scripts\client-smoke.ps1`
