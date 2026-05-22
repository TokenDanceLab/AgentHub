# AgentHub 路线图

最后更新：2026-05-23

## 当前总目标

推进 M2 Edge 本地数据层，让前端、后端、客户端三条线能围绕稳定的 Project / Thread / Run / Item / Event 模型并行开发。

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
- [ ] M2 Edge 本地数据层：Project / Thread / Run / Item / EventStore。
- [ ] M3 真实 Runner：CLI Agent 进程、取消、日志、错误映射。
- [ ] M4 Workspace 能力：worktree、diff、preview、artifact、approval。
- [ ] M5 Hub 协作链路：Edge-Hub sync、远程查看、远程审批。

## 当前活跃方向

- 前端：从 Mock 数据过渡到真实 REST / WebSocket client，承接 UI 同学设计。
- 后端：实现 Hub Server、Edge-Hub 通信、账号/群聊/同步/中继能力。
- 客户端：推进 Desktop、Runner、Edge 本地调度和本地数据层。

## 验收门槛

- [ ] 当前分支路线图已更新。
- [ ] 相关方向路线图已更新。
- [ ] 测试或确定性检查已运行。
- [ ] API 或事件变化已同步 `api/`。
- [ ] `git status --short --branch` 已检查。

## 待办池

- [ ] 评估 Edge store 的 SQLite 依赖获取问题和可替代方案。
- [ ] M2 完成后归档或更新 `docs/client-roadmap.md`，避免路线图重复。
- [ ] 为 Runner 真实 CLI adapter 规划最小测试夹具。
