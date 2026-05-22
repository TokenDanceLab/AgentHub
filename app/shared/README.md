# AgentHub Shared

`app/shared/` 是前端和桌面的共享目录。

计划放入：

- 共享 TypeScript 类型定义（从 `api/` 自动生成或手动维护）
- 共享 API client（REST 和 WebSocket event stream）
- 共享 React 组件（状态指示器、Diff 卡片、审批面板等）
- 共享状态管理 hooks 和 context

当前 Desktop Shell 阶段，共享内容尚未抽取；Desktop 和未来的 Web 端各自保有独立副本。两端的 API client 稳定后统一迁移到本目录。
