# AgentHub Threat Model

最后更新：2026-07-18

本文件是活跃威胁模型摘要。旧长版快照见 [../history.md](../history.md)。当前风险队列和发布门禁以 [security-risk-register.md](security-risk-register.md) 为准（最后审查 2026-07-17）。

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

| 威胁 | 当前控制 | 剩余风险（对齐 register） |
|---|---|---|
| TokenDance bearer 被误用为 Hub session | Hub REST/WS 以 Hub-issued session 为产品会话边界 | AH-SR-035/036：代码已缓解；缺部署/客户端真实登录证据 |
| Web session 被 XSS 读取 | Web 使用 sessionStorage 并清理旧 localStorage key | AH-SR-037：**Accepted**（#438）；BFF/HttpOnly 为可选增强，非发布关闭条件 |
| Remote Edge read/run 越权 | Local Edge loopback 默认、Hub JWT fail-closed owner 过滤、purpose/action/target/thread capability 绑定 + fixture E2E | AH-SR-045/046：**Mitigated in repo**；可选 live remote 证据与更完整 capability 模型 |
| Hub-Edge 状态分歧 | Hub outbox + retry；Edge 内存/SQLite durable journal、幂等与 offline/replay fixture | AH-SR-049：**Mitigated in repo**；自动 redelivery worker 与 live 跨服务探针另开任务 |
| Runtime 日志泄露 prompt/config | 启动日志脱敏、敏感 env 过滤 | AH-SR-048：**Mitigated in repo**；需真实 adapter debug log smoke |
| Mock/demo 污染生产体验 | Web/shared demo mutation fail-closed 与 data-mode 轴 | AH-SR-043：**Mitigated in repo**（Web）；可选 Desktop seed 去默认 |

## 发布阻断

公开发布前至少关闭、accepted 或完成对应 verification（细节只以 register 为准）：

- AH-SR-028：JWT secret **rotate required**（代码已去硬编码默认值）。
- AH-SR-035 / AH-SR-036 / AH-SR-048：真实登录、Desktop 登录闭环和 runtime log 无密证据仍 **verification required**。
- AH-SR-037：**Accepted**（补偿控制见 register）；不作为未关闭 Open 项。
- AH-SR-043 / AH-SR-045 / AH-SR-046 / AH-SR-049：仓库内 **Mitigated**；剩余为可选证据/增强，非“缺 outbox/capability 代码”叙事。

## 维护规则

- 新发现进入 [security-risk-register.md](security-risk-register.md)，不要在本文件复制长表。
- 形成稳定架构决策时更新 [../decisions.md](../decisions.md) 或对应架构 owner 文档，并在本文件只保留一行摘要。
- 生产证据只放私有运维文档；本仓库不保存 endpoint、token、secret、callback code、session 或日志原文。
