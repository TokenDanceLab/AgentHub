# AgentHub API Reference

最后更新：2026-08-16

本文件只做 API 契约入口。旧 2041 行静态 API 参考见 [history.md](history.md)，避免它和 OpenAPI / WebSocket 契约漂移。

## 权威契约

| 内容 | 权威文件 | 验证 |
|---|---|---|
| REST 路径、schema、阶段标记 | `api/openapi.yaml` | OpenAPI YAML parse / endpoint tests |
| WebSocket envelope、frame、事件族和源码 owner | [../api/events.md](../api/events.md) | WS tests / event normalizer tests |
| 命名、分页、错误、权限、版本 | [../api/conventions.md](../api/conventions.md) | API review / handler tests |
| 架构背景和边界 | [architecture.md](architecture.md) | 架构 review |

## 使用规则

1. 新 REST 接口先改 `api/openapi.yaml`。
2. 新 WebSocket 事件先改源码 owner，再同步 `api/events.md` 的事件族和验收边界。
3. 通用命名、错误、分页、权限规则先改 `api/conventions.md`。
4. 新增鉴权、session、TokenDance ID 或权限行为时，同步 [architecture/06-auth-identity.md](architecture/06-auth-identity.md) 和 `AGENTS.md` 中的边界规则。
5. 不再在 `docs/` 里维护第二份完整 API 表。
