# 分支路线图：feat/backend-foundation-delicious233

最后更新：2026-05-23

## 分支目标

在 `feat/backend-foundation` 基础上补齐 Hub Server 最小可测试骨架，重点推进 sync upload / list / ack / state 入口，并保持后续 device registry、sync、relay 的服务边界清晰。

## 写入范围

- `hub-server/`
- `internal/`
- `packages/protocol/`
- `docs/roadmaps/branches/feat-backend-foundation-delicious233.md`

本轮未修改 `api/` 契约；实现对齐现有 `api/openapi.yaml` 和 `api/events.md`。

## 已完成

- [x] 确认当前分支为 `feat/backend-foundation-delicious233`，worktree 为 `.worktrees/backend-foundation-delicious233`。
- [x] 在 Hub Server 内新增 `SyncStore` 边界和内存态实现，覆盖 sync event upload / list / ack / state。
- [x] 复用 `packages/protocol.EventEnvelope` 校验上传事件，避免 handler 自行定义第二套事件结构。
- [x] 扩展 handler 层测试，覆盖 sync 上传、拉取、ack、state 和非法 envelope 失败路径。
- [x] 更新 `hub-server/README.md`，记录当前可运行命令和 handler 范围。

## 下一步

- [ ] 将 `EdgeRegistry` / `SyncStore` 替换为 PostgreSQL 持久化实现。
- [ ] 为 device registry 增补 `/v1/devices` 最小 handler 与 service 边界。
- [ ] 明确 sync cursor 找不到时的 API 行为，是返回空列表、全量回放还是 `400 bad_request`。
- [ ] 后续 relay workstream 开始前，先审查 `api/events.md` 的 relay command payload 字段。

## 验收记录

- 2026-05-23：基线 `go test ./...` 通过。
- 2026-05-23：实现后 `git diff --check` 通过。
- 2026-05-23：实现后 `go test ./...` 通过。
- 2026-05-23：实现后 `git status --short --branch` 已检查。
