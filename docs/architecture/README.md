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
| [09-dev-server-topology.md](09-dev-server-topology.md) | 远程 dev 服务器拓扑（L3 真实测试面）：端口矩阵、运行模型、身份链、重建步骤、证据纪律 |
| [10-macro-engineering-design.md](10-macro-engineering-design.md) | 宏观工程设计基线：双平面、协议分层、事件一致性、最小代理权、可观测与差距路线 |

## 约定

- 每个文件可独立阅读，开头标注主索引链接。
- 文件间通过相对链接交叉引用。
- 主 `architecture.md` 保留核心概览并链接到所有子文档。
