# AgentHub Threat Model

最后更新：2026-06-27

本文件是活跃威胁模型摘要。旧长版快照见 [../history.md](../history.md)。当前风险队列和发布门禁以 [security-risk-register.md](security-risk-register.md) 为准。

## 资产

| 资产 | 风险 |
|---|---|
| 用户身份和 Hub session | token 泄露、错误 audience/issuer、session owner 混淆 |
| 本地 workspace | Web/remote 误触本机文件、allowlist 失效、路径穿越 |
| Agent runtime 执行 | 未授权命令、越权 target、日志泄露 prompt/config |
| Hub/Edge 投递 | callback 丢失、重复、错设备、离线 replay 分歧 |
| 附件和产物 | 跨 session 读取、恶意 MIME、公开预览误报 |
| 公开 Web/UI | mock/demo 路径冒充生产、XSS 读取 sessionStorage |

## 信任边界

```text
Browser/Web
  -> Hub Server
  -> Edge routing / relay
  -> Desktop / Local Edge
  -> Runtime adapter process
  -> Workspace filesystem
```

边界规则：

- TokenDance ID 只证明身份；Hub Server 决定 AgentHub 内部权限。
- Web 不直连 Local Edge，不持有 TokenDance API key，不访问本机文件。
- Desktop renderer 只能通过 typed Tauri host API 访问 native 能力。
- Local Edge 默认 loopback；remote/cloud Edge 必须有显式认证、target/workspace 授权和投递可靠性设计。
- Stub/demo/fixture 不能冒充真实执行、真实登录、真实模型/API 或 packaged Desktop。

## 主要威胁和控制

| 威胁 | 当前控制 | 剩余风险 |
|---|---|---|
| TokenDance bearer 被误用为 Hub session | Hub REST/WS 以 Hub-issued session 为产品会话边界 | 部署和客户端真实登录证据仍需补齐 |
| Web session 被 XSS 读取 | Web 使用 sessionStorage 并清理旧 localStorage key | AH-SR-037：公开 Web 需要 BFF/HttpOnly 或 accepted alternative |
| Remote Edge read/run 越权 | Local Edge loopback 默认、Hub JWT 校验 issuer/audience/device/purpose | AH-SR-045/046：缺 route/target/workspace/per-run capability |
| Hub-Edge 状态分歧 | 回调绑定 user/device/run，部分 offline replay 已落地 | AH-SR-049：缺 outbox/journal、sequence、idempotent ack、reconciliation |
| Runtime 日志泄露 prompt/config | 启动日志脱敏、敏感 env 过滤 | AH-SR-048：需真实 adapter debug log smoke |
| Mock/demo 污染生产体验 | 真实 E2E 合同和 data mode 轴已定义 | AH-SR-043：Web mock/preview 和生产 mutation 仍需进一步隔离 |

## 发布阻断

公开发布前至少关闭或 accepted：

- AH-SR-037：Web server-owned session posture。
- AH-SR-045 / AH-SR-046：Remote Edge route/target/workspace/per-run 授权。
- AH-SR-049：Hub-Edge durable delivery contract。
- AH-SR-035 / AH-SR-036 / AH-SR-048：真实登录、Desktop 登录闭环和 runtime log 无密证据。

## 维护规则

- 新发现进入 [security-risk-register.md](security-risk-register.md)，不要在本文件复制长表。
- 形成稳定架构决策时更新 [../decisions.md](../decisions.md) 或对应架构 owner 文档，并在本文件只保留一行摘要。
- 生产证据只放私有运维文档；本仓库不保存 endpoint、token、secret、callback code、session 或日志原文。
