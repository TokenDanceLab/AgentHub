# Architecture Sub-Documents

> 本目录包含 AgentHub 架构文档的详细子模块。
>
> 主索引：[architecture.md](../architecture.md)

## 文件清单

| 文件 | 内容 |
|---|---|
| [01-hub-server.md](01-hub-server.md) | Hub 边界、source map、contract map、路由/WS 验收 |
| [02-edge-server.md](02-edge-server.md) | Edge adapter registry、process lifecycle、EventStore |
| [03-runtime-adapters.md](03-runtime-adapters.md) | Runtime adapter 注册、事件映射合同、PreflightAdapter、权限桥接 |
| [04-frontend-data-flow.md](04-frontend-data-flow.md) | Platform adapter contract、source owner map、Transcript/chat flow、data mode |
| [05-deployment.md](05-deployment.md) | 仓库内部署资产、开发端口、证据等级和生产边界 |
| [06-auth-identity.md](06-auth-identity.md) | OIDC PKCE flow、JWT 签发、TokenDance ID 集成、设备注册 |
| [07-design-system-ssot.md](07-design-system-ssot.md) | Design tokens / theme runtime / surface CSS ownership map |
| [08-outbound-http.md](08-outbound-http.md) | 出站 HTTP policy 合同、client inventory、机器门禁（#1540/#1549/#1564） |

## 约定

- 每个文件可独立阅读，开头标注主索引链接。
- 文件间通过相对链接交叉引用。
- 主 `architecture.md` 保留核心概览并链接到所有子文档。
