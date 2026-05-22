# AgentHub Hub Server

Hub Server 是 AgentHub 的中心控制面和协作层。

Runtime: Go.

## 职责

- 账号、登录和用户身份。
- 好友、联系人、群聊和云端 Conversation。
- 多端同步和消息投递。
- Edge 设备注册和心跳。
- Web/Mobile 远程控制和 NAT 穿透场景下的 Hub Relay。
- 权限检查、审计记录和远程命令路由。
- 可选的云端 Artifact 缓存和 Memory 索引。

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 语言 | Go 1.24 | |
| HTTP 框架 | chi | 轻量路由，stdlib 增强路由补充 |
| 数据库 | **PostgreSQL 16** | 中心权威数据源，JSONB + 全文搜索 + 事务 DDL |
| 缓存/状态 | Redis | Token 黑名单、在线状态、未读数 |
| 消息队列 | RabbitMQ | Agent 任务异步投递 |
| WebSocket | coder/websocket | 纯 Go、并发写、内置 Ping/Pong |
| ORM | Gorm | 迁移 + 查询 |

### 为什么用 PostgreSQL

- **消息内容存 JSONB**：消息 content、Agent capabilities、任务 input/result 均为 JSON，PostgreSQL JSONB 支持 GIN 索引和路径查询，MySQL JSON 本质是文本存储
- **消息全文搜索**：PG 内置 tsvector + GIN 索引，中文可挂 pg_jieba 扩展
- **事务 DDL**：新项目 migration 多，PG 改 schema 失败自动回滚，MySQL 隐式提交会导致半截变更

> EdgeServer 使用 SQLite（modernc.org/sqlite + FTS5），Hub ↔ Edge 数据一致性通过 cursor-based 增量同步保证，详见 `docs/reference/03-build/backend/02-go-services.md`

## 不负责什么

- 不直接运行 Claude Code、Codex 或 OpenCode。
- 不直接读写用户 workspace 文件。
- 默认不拥有本地项目 `.agenthub/` Memory。
- 不替代 Desktop 离线模式下的 Edge Server。

## 协议面

- UI <-> Hub：REST JSON API + WebSocket events，处理 Web/Mobile Conversation、设备状态、远程控制。
- Edge <-> Hub：REST sync API + reverse WebSocket relay，处理注册、同步、中继和命令投递。
- Hub -> Edge：`message.deliver`、`run.start`、`run.stop`、`preview.request`。

## 需求文档

- [Hub Server 需求文档](../../docs/reference/03-build/backend/16-hub-server-requirements.md)

## 依赖

- `api/` 契约：REST endpoint、WebSocket event、错误格式。
- `docs/system-architecture.md`：Hub-Edge-Runner 架构和职责边界。
- `docs/implementation-guide.md`：当前实现顺序和三部分分工。
- Go package 按实际代码需要创建，不提前铺空目录。
