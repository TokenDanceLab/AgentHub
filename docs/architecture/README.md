# Architecture Sub-Documents

> 本目录包含 AgentHub 架构文档的详细子模块。
>
> 主索引：[architecture.md](../architecture.md)

## 文件清单

| 文件 | 内容 | 行数范围 |
|---|---|---|
| [01-hub-server.md](01-hub-server.md) | Hub 路由、handler、WebSocket、Chat Actions、安全边界 | 179 |
| [02-edge-server.md](02-edge-server.md) | Edge adapter registry、process lifecycle、EventStore | ~93 |
| [03-runtime-adapters.md](03-runtime-adapters.md) | 全部 6 个 adapter 注册 ID（3 CLI + 2 SDK + Orchestrator）、事件映射合同、PreflightAdapter、权限桥接 | ~109 |
| [04-frontend-data-flow.md](04-frontend-data-flow.md) | Platform adapter pattern、React Query hooks、WebSocket events、Settings 三层回退、Agent Profile 合并 | 165 |
| [05-deployment.md](05-deployment.md) | 生产部署、Docker Compose、Nginx、SSL、环境变量、开发环境 | ~83 |
| [06-auth-identity.md](06-auth-identity.md) | OIDC PKCE flow、JWT 签发、TokenDance ID 集成、设备注册 | ~90 |

## 约定

- 每个文件可独立阅读，开头标注主索引链接。
- 文件间通过相对链接交叉引用。
- 主 `architecture.md` 保留核心概览并链接到所有子文档。
