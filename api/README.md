# AgentHub API

`api/` 是 AgentHub 的接口契约目录，面向实现者、前端、后端服务和 Agent。

当前主协议采用更轻的形态：

```text
REST JSON API          # 命令和查询
WebSocket typed events # 实时状态、日志、消息 delta、审批和产物通知
```

## 文件职责

```text
api/
├── README.md          # API 总入口
├── conventions.md     # 通用规则：命名、分页、错误、权限、版本
├── openapi.yaml       # REST API 路径总表和基础契约
└── events.md          # WebSocket event envelope 和事件总表
```

`openapi.yaml` 只描述 REST API。WebSocket 的事件格式、序号、游标和事件表写在 `events.md`。

## 模块边界

| 模块 | 负责内容 | 主要归属 |
|---|---|---|
| IM / Project | Project、Conversation、Thread、Message、Item、Memory | Edge / Hub |
| Execution / Runtime | AgentRun、Approval、Artifact、Preview、Workspace、AgentAdapter | Edge |
| Hub / Sync / Relay | Auth、User、Contact、Group、Device、Edge、Sync、Relay、Cloud | Hub / Edge |

## 阶段标记

接口会标注阶段，不代表后期接口现在就要实现。

| 阶段 | 含义 |
|---|---|
| P0 | 本地 Desktop -> Edge -> AgentAdapter 必需 |
| P1 | 多 Agent Thread 和本地协作增强 |
| P2 | Edge-Hub 同步、Web/Mobile 远程查看和审批 |
| P3 | Hub relay、Cloud Edge、远程执行 |
| P4 | 完整联系人、群聊、团队空间和生态 |

## 使用规则

1. 新接口先改 `api/openapi.yaml`。
2. 新事件先改 `api/events.md`。
3. 通用命名、错误、分页、权限规则先改 `api/conventions.md`。
4. 业务解释和架构背景写入 `docs/`，不要塞进 OpenAPI。
5. Protobuf / Connect-RPC / JSON-RPC 不作为当前主协议。以后如需升级，必须保持 REST/WebSocket 语义兼容。
