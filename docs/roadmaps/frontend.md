# 前端路线图

最后更新：2026-05-25

## 负责范围

- Web 工作台
- IM 交互
- Diff / Preview / Approval 面板
- 前端状态管理和 API client

## 当前状态

前端工作台基础接入已完成：共享状态 reducer、EventClient、Workbench Edge REST / `/v1/events` 接入和 Approval 真实决策链路已经落地。后续迭代重点不要再按“仍在 Mock 接口准备期”推进，应把 Hub IM、消息会话、Custom Agents 和 Web 触发 Hub agent task 视为后端/客户端闭环依赖。

## 已完成

- [x] 梳理前端状态模型：Project / Thread / Run / Item，并保留 Thread 的 `conversationId` 关联。
- [x] 定义 API client 边界，避免组件直接拼 REST URL。
- [x] 为 WebSocket event reducer 写单元测试。
- [x] 接入 Workbench 的 Edge REST 与 `/v1/events`。
- [x] Approval 面板调用真实 `decideApproval`。
- [x] Project / Group Workspace 使用 `workbenchReducer` 和 data/source helpers 做状态投影与来源标识。
- [x] ChatInput / 页面 composer 支持 Enter 发送、Shift+Enter 换行、输入法 composing 防误发。

## 待后端/客户端依赖

- [ ] Hub IM `/client/ws` 真服务闭环。
- [ ] message / session REST 真服务闭环。
- [ ] `/web/custom-agents` 真服务闭环。
- [ ] Web 触发 Hub agent task 的 Hub / 客户端端到端闭环。
- [ ] Private Chats / Agent Square 当前仍是 local mock / Hub pending，不标记为前端完成。

## 下一步前端可做

- [ ] 围绕已接入链路补齐异常态、空态和 loading 态。
- [ ] 在 Hub / 客户端接口稳定后，把 Private Chats、Agent Square 和 Hub agent task 从 mock 切到真实服务。
- [ ] 继续补关键 UI 流程测试：新建 Thread、启动 Run、查看 Diff、Approval、Preview。

## 依赖

- `api/openapi.yaml`
- `api/events.md`
- `docs/product-requirements.md`
- `docs/system-architecture.md`

## 验收

- [ ] `pnpm test`
- [ ] `pnpm build`
- [x] 关键状态转换有测试覆盖。
