# 前端路线图

> **状态：已过时 (superseded)**。本文内容已合并到 `docs/roadmap.md`（全局路线图唯一事实源）。
> 前端当前状态见 `docs/roadmaps/client.md` 和 `docs/handoff/STATE.md`。

最后更新：2026-05-23

## 负责范围

- Web 工作台
- IM 交互
- Diff / Preview / Approval 面板
- 前端状态管理和 API client

## 当前目标

等待 UI 设计稿收敛，同时准备从 Mock 数据接入真实 Edge REST / WebSocket 接口。

## 下一阶段任务

- [ ] 梳理前端状态模型：Project / Conversation / Thread / Run / Item。
- [ ] 定义 API client 边界，避免组件直接拼 REST URL。
- [ ] 为 WebSocket event reducer 写单元测试。
- [ ] 接入客户端 M2 暴露的 Project / Thread / Run / Item 接口。

## 依赖

- `api/openapi.yaml`
- `api/events.md`
- `docs/product-requirements.md`
- `docs/system-architecture.md`

## 验收

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 关键状态转换有测试覆盖。
