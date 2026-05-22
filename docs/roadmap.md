# AgentHub 路线图

最后更新：2026-05-23

## 当前总目标

推进 M2 Edge 本地数据层，让前端、后端、客户端三条线能围绕稳定的 Project / Thread / Run / Item / Event 模型并行开发。当前客户端 PR #30 已提供内存态最小实现，`feat/client-thread-messages-delicious233` 已补 message/item 写入链路，`feat/client-run-lifecycle-delicious233` 已抽出 Runner lifecycle 边界，`feat/client-store-boundary-delicious233` 已抽象 Edge store 接口边界，`feat/client-store-persistence-delicious233` 已提供轻量 JSON 文件持久化实现，下一步重点是真实 Runner adapter。

## 路线图分层

- 总路线图：`docs/roadmap.md`
- 前端路线图：`docs/roadmaps/frontend.md`
- 后端路线图：`docs/roadmaps/backend.md`
- 客户端路线图：`docs/roadmaps/client.md`
- 分支路线图：`docs/roadmaps/branches/<branch-name>.md`

## 基本原则

- Go 优先：Hub Server、Edge Server、Runner 使用 Go。
- 协议简单：REST JSON API + WebSocket typed events 是当前主线。
- 中文优先：README、AGENTS、issue、PR 和项目文档中文为主；代码标识保持英文。
- 隐私安全：本机状态、密钥、真实服务器信息和个人路径不进仓库。
- 渐进式加载：先读 `AGENTS.md` 和任务相关主文档，不全文扫描调研资料。

## 里程碑

- [x] M1 客户端本地链路：Desktop Shell + Local Edge + Mock Runner + smoke test。
- [ ] M2 Edge 本地数据层：Project / Thread / Run / Item / EventStore。最小内存实现已在 PR #30，message/item 写入链路、Runner lifecycle 边界、store 接口边界和轻量 JSON 文件持久化实现已补齐，SQLite 仍是后续可选评估项。
- [ ] M3 真实 Runner：CLI Agent 进程、取消、日志、错误映射。
- [ ] M4 Workspace 能力：worktree、diff、preview、artifact、approval。
- [ ] M5 Hub 协作链路：Edge-Hub sync、远程查看、远程审批。

## 当前活跃方向

- 前端：从 Mock 数据过渡到真实 REST / WebSocket client，承接 UI 同学设计。
- 后端：实现 Hub Server、Edge-Hub 通信、账号/群聊/同步/中继能力。
- 客户端：PR #30 推进 Edge 本地数据层，`feat/client-thread-messages-delicious233` 补齐 message/item 写入链路，`feat/client-run-lifecycle-delicious233` 和 `feat/client-store-boundary-delicious233` 分别补齐 lifecycle/store 可替换边界，`feat/client-store-persistence-delicious233` 增加轻量 JSON 文件持久化 store，后续继续做真实 Runner adapter。

## 验收门槛

- [ ] 当前分支路线图已更新。
- [ ] 相关方向路线图已更新。
- [ ] 测试或确定性检查已运行。
- [ ] API 或事件变化已同步 `api/`。
- [ ] `git status --short --branch` 已检查。

## 待办池

- [x] 抽象 Edge store 可替换接口边界。
- [x] 增加 Edge store 轻量 JSON 文件持久化实现；SQLite 依赖获取问题保留为后续可选评估。
- [x] 在客户端 M2 基础上补 `POST /v1/threads/{threadId}/messages` 到 Item / event 的写入链路。
- [ ] 将 Runner 真正接入 Edge Run lifecycle，替换 handler 内置 mock flow。
- [ ] M2 完成后归档或更新 `docs/client-roadmap.md`，避免路线图重复。
- [ ] 为 Runner 真实 CLI adapter 规划最小测试夹具。
