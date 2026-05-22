# AgentHub API

`api/` 存放 AgentHub 对外和内部模块之间共享的 API 契约。

当前阶段采用更轻的协议形态：

```text
REST JSON API            # 命令和查询
WebSocket typed events   # 实时事件流
```

文件：

```text
api/
├── README.md
├── openapi.yaml          # REST API 契约
└── events.schema.json    # WebSocket event envelope 和 payload 契约
```

Go 服务和 TypeScript 前端都应按这里的契约实现。Protobuf / Connect-RPC 可作为未来升级选项，不作为当前 M0 的强制主协议。
