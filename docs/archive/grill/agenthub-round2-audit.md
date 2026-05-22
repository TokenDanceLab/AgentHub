# Grill: AgentHub 架构审计 · 第二轮
Date: 2026-05-21

## Intent
在完整的 Hub-Edge-Runner 远景下，从产品化、技术架构、分布式、安全、DX 五个维度做建设性审计——不做"砍 scope"，而是找最佳实现路径。

## Constraints
- 20 天，3 人，VibeCoding
- Go 全栈（Hub/Edge/Runner）+ React 前端
- 远景规划不降标准，但实现可按阶段落地
- 仍在调研阶段，不需要具体实现细节

## Key decisions
- 决策：Schema-first 选 Protobuf + Buf + connect-go（非 JSON Schema）。原因：Go 生态 protobuf 是工业标准，buf generate 一次性产出 Go+TS，connect-go 兼容 gRPC/gRPC-Web/Connect 三协议。替代方案：手写 protocol.ts + Go struct 人工对齐，短期更快但长期双写。
- 决策：11 个 Go 包分三层依赖（底层 protocol+transport → 中间层 7 个共享逻辑 → 上层 adapters），Hub/Edge/Runner 各取所需组合。替代方案：所有包平铺。
- 决策：Transport 统一 Go interface，local/SSH/hub-relay 各实现同一接口。原因：一次定义到处使用。
- 决策：Edge 多通道用 errgroup + context 取消树管理生命周期。
- 决策：Memory 用 SQLite FTS5 + 文件系统双层，modernc.org/sqlite 纯 Go 无 CGO。
- 决策：本地 127.0.0.1 必须 Bearer token 认证，Hub 中继端到端加密 Hub 不看明文。
- 决策：审批链路走 Edge 中转，60s 超时自动拒绝。

## Surfaced assumptions
- 架构文档质量扎实，但"人怎么用"这条线完全缺失——DX 审计发现没有首次启动流、配置向导、调试入口的文档
- ConversationAuthority 在 Edge 永久消失时没有自动故障转移——依赖本地 SQLite 作为单一主副本
- 8 种拓扑的用户故事每条都有真实场景，但缺乏优先级（哪些先实现、哪些保留为规划）
- 12 份文档中 4 份（topology/protocol/authority/data-plane）可后置到远程拓扑生效时

## Open questions
- Protobuf 方案 vs 手写 protocol.ts 的最终选择需要团队确认
- P0 的 Desktop Command Center "四个关键瞬间"是否要写进 product-model.md
- `agenthub` 单一二进制打包方案（Edge + Runner + UI 是否全塞一个 binary）
- Adapter 开发 checklist 文档是否要现在就写

## Out of scope（本轮明确不加的）
- 砍包删 Hub 降 scope（第一轮建议，已拒绝）
- 具体代码实现（仍在调研阶段）
- 迁移协议和 Runner 崩溃恢复状态机的详细设计（后续补）
