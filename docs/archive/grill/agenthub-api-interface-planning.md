# Grill: AgentHub API 接口规划

日期：2026-05-22

## 意图

规划 AgentHub 的完整 API 接口分工，让三个人或多个 Agent 能按模块并行推进文档和后续实现。

## 约束

- 项目采用 Agent 和文档驱动，接口规范需要放在根目录 `api/`，而不是隐藏在 `docs/` 下。
- 接口面要完整覆盖远景，不只写 MVP。
- 不能让单个 Agent 一次性写出一份大而假的规范；需要模块分工和最终一致性审查。
- 当前主协议方向是 REST JSON API + WebSocket typed events，OpenAPI 作为 REST 契约，WebSocket 事件先用文档表格定义。

## 关键决策

- 决策：`api/` 作为接口契约根目录。原因：接口是工程契约，不只是解释文档。替代方案：`docs/api/`，被拒绝因为不够直观。
- 决策：endpoint 全量规划，字段按阶段成熟度。原因：保留远景，又避免远期字段假精确。替代方案：只写 P0/P1，被拒绝因为用户明确要求长远完整规划。
- 决策：按模块分支分工。原因：Agent 和文档驱动项目更适合模块所有权。替代方案：一个 Agent 一次性全写，被拒绝因为容易边界混乱。

## 浮现假设

- REST API 负责命令和查询，WebSocket 负责流式状态和输出。
- OpenAPI 不必一开始写满所有字段，但应该完整列出模块 endpoint 和 tags。
- 事件 schema JSON 文件可以后置，先用 `api/events.md` 定义事件信封和事件表。

## 待解决问题

- 远期 Hub/团队 IM 的权限模型是否先用 role 字段占位，还是先定义完整 ACL。
- OpenAPI 是否要立即引入校验工具，还是先手写 YAML 并人工审查。

## 出界

- 不在本轮实现 Go 服务。
- 不在本轮生成 TypeScript client。
- 不在本轮引入 Connect-RPC 或 Protobuf 主线。
