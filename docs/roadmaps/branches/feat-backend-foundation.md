# 分支路线图：feat/backend-foundation

最后更新：2026-05-23

## 分支目标

搭建 AgentHub 后端基础架构，让 Hub Server、共享 Go 包和协议模型具备可测试的最小运行骨架。

## 写入范围

- `go.mod`
- `hub-server/`
- `internal/`
- `packages/`
- `docs/roadmaps/backend.md`
- `docs/roadmaps/branches/feat-backend-foundation.md`

`edge-server/` 已由客户端 M1 作为独立 Go module 维护；本分支不再写入旧的 `edge-server/internal/edgeserver`。

## 已完成

- [x] 建立根 Go module。
- [x] 添加共享 REST JSON / error response helper。
- [x] 添加共享 service config loader。
- [x] 添加 Hub Server 可执行入口。
- [x] 添加 Hub `/v1/health`。
- [x] 添加 Hub Edge register / list / get / heartbeat 基础实现。
- [x] 添加共享 WebSocket event envelope model。
- [x] 合并最新 `master` 的仓库级 `set-goal`、路线图和客户端 M1 本地链路进度。
- [x] 删除后端分支旧的根级 `ROADMAP.md`，迁移到 `docs/roadmaps/branches/`。
- [x] 按最新 `master` 模块边界移除旧的 `edge-server/internal/edgeserver`。

## 下一步

- [ ] 添加 Hub sync upload / list / ack 基础接口。
- [ ] 更新 `hub-server/README.md`，写清当前命令和接口。
- [ ] 审查 `api/openapi.yaml` 是否覆盖当前 Hub Edge registry 接口。
- [ ] 为后端分支创建或更新 PR。

## 验收记录

- 2026-05-23 00:46 +08:00：`go test ./...` 曾在后端 worktree 通过。
- 2026-05-23 00:50 +08:00：`go test ./internal/httpapi ./hub-server/internal/hubserver ./edge-server/internal/edgeserver` 曾在旧模块结构下通过。
- 2026-05-23：合并最新 `master` 后，`go test ./...` 通过。
- 2026-05-23：合并最新 `master` 后，`go test ./...` in `edge-server/` 通过。
- 2026-05-23：合并最新 `master` 后，`go test ./...` in `runner/` 通过。
- 2026-05-23：`python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 通过。
