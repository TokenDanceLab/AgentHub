# AgentHub 架构概览

最后更新：2026-10-23

本文档是架构入口，只保留当前结构、边界和 owner 链接。

## 产品定位

AgentHub 是 IM 形态的多 Agent 协作工作台。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview、产物和部署结果，而不是 runtime 下拉框。

```text
AgentHub = shared IM workbench + local/remote Agent execution + Hub collaboration network
```

## 结构分层

```text
Desktop shared workbench
  -> Desktop platform adapter
  -> Local Edge Server
  -> Agent Runtime adapter
  -> Codex / OpenCode / Claude Code / SDK adapters
  (Hub Server: session, IM, sync, remote approval; not in the model-turn path)

Web shared workbench
  -> Web platform adapter
  -> Hub Server
  -> Edge routing / relay
  -> Edge Server
  -> Agent Runtime adapter

Mobile (fixture-only by default; independent RN rendering)
  -> Mobile platform adapter
  -> Hub Server
  -> Edge routing / relay (via Hub)
```

| 层 | 目录 | 职责 |
|---|---|---|
| Shared UI | `app/shared/` | transcript、composer、inspector、platform contracts、design token |
| Workbench | `app/workbench/` | 端级工作台 shell（`@agenthub/workbench`，依赖方向 workbench → shared 单向） |
| Desktop | `app/desktop/` | Tauri shell、Desktop adapter、Local Edge、本机能力 |
| Web | `app/web/` | Hub session、Web adapter、远程审批和查看 |
| Mobile | `app/mobile-rn/` | RN shell、Mobile adapter、Hub viewer surface（默认 fixture-only；真实 Account 登录需显式开关，非 release candidate） |
| Edge | `edge-server/` | 本地项目、Thread、Run lifecycle、Runtime adapter、Artifact index |
| Hub | `hub-server/` | TokenDance Account OIDC relying party、Hub session、IM、AgentTeam、同步、中继、审计 |
| API | `api/` | REST API、WebSocket event 与 Hub→Edge dispatch 契约 |

## 核心数据流

本地执行线 `Desktop Workbench -> Platform Adapter -> Local Edge -> Runtime adapter -> Runtime`；Web/Mobile 只走 `Web/Mobile -> Hub -> relayed Edge -> Runtime`，不直连 Local Edge。Hub 负责 session、IM、同步和远程审批，不进入模型 Turn 路径。事件/证据/同步线的详细路径见 [02-edge-server.md](architecture/02-edge-server.md) §事件流 与 [04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)。

## 非协商边界

1. UI 不能直接启动 Agent CLI；Web 只和 Hub 通信；Desktop renderer 不获得 raw process 权限，危险能力走 typed Tauri host API + allowlist。
2. 所有来源必须 normalize 到统一 transcript contract 后再渲染。
3. Mock、fixture、observed、approved-real、production 必须显式区分；stub/fixture/readiness-only 不能冒充真实登录、真实模型/API、packaged Desktop 或 release。
4. Hub 是控制面、不执行模型 Turn；Edge 是数据面；任务拆分、路由、审批、重试由确定性状态机承担。
5. Hub/Edge 自有 REST/WS 是产品契约 SSOT；MCP/A2A/AG-UI 只做 capability mapping。
6. 授权按最小代理权：task-scoped 凭据 + per-action 授权；secret 不进入 agent context/sandbox。
7. Hub 只消费 Account 公开 OIDC endpoint，不持有或调用 Account 内部管理 API/DB；Account `issuer + subject` 是外部身份键。
8. Account token 只停留在 Hub OIDC service；Hub REST/WS 只接受 Hub HS256 session token。Web 当前使用 tab-scoped `sessionStorage`，不是 HttpOnly cookie session。
9. Mobile 默认是 fixture-only lane；真实 Account 登录必须显式开启，不能把 mock、fixture 或 stubbed Hub 结果记为真实 L3。

## 产品模型

四个核心概念的唯一定义（字段映射由 `api/README.md` 与 shared 类型各自维护）：

| 概念 | 含义 |
|---|---|
| Agent Runtime | 执行器 adapter（如 `claude-acp`、`codex-acp`），负责把 run 变成 CLI 进程；不是用户管理的 Agent |
| Agent Profile | 用户可管理的 Agent 实体，绑定 Runtime 与默认配置 |
| Agent Configuration | 单次 run 的模型、推理强度、权限模式、Skill、MCP 等参数 |
| Execution Target | 运行位置：`local_edge`、`remote_ssh`、`tailscale`、`cloud_edge`、`hub_relay` |

架构侧新增概念：

| 概念 | 含义 | Owner |
|---|---|---|
| Conversation | 用户可见 IM 会话：私聊、群聊、项目会话 | Hub/Edge conversation store |
| Run Session | 一次执行生命周期和事件序列 | Edge lifecycle + EventStore |
| Artifact | Agent 产物索引、预览、应用和版本 | Edge artifact index + workspace |

## Frontend Contract

共享 UI 只消费 platform adapter，不直接调用 Tauri invoke、Hub client 或 Edge client。`AgentHubPlatform` 接口以 [app/shared/src/platform/types.ts](../app/shared/src/platform/types.ts) 为准；Transcript 合同与消息流规则见 [04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)。

## Module Owners

| 主题 | 文档 |
|---|---|
| Hub Server | [architecture/01-hub-server.md](architecture/01-hub-server.md) |
| Edge Server | [architecture/02-edge-server.md](architecture/02-edge-server.md) |
| Runtime adapters | [architecture/03-runtime-adapters.md](architecture/03-runtime-adapters.md) |
| Frontend data flow | [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md) |
| Deployment | [architecture/05-deployment.md](architecture/05-deployment.md) |
| Auth and identity | [architecture/06-auth-identity.md](architecture/06-auth-identity.md) |
| Design system SSOT | [architecture/07-design-system-ssot.md](architecture/07-design-system-ssot.md) |
| Outbound HTTP | [architecture/08-outbound-http.md](architecture/08-outbound-http.md) |
| Macro engineering + protocol mapping | [architecture/10-macro-engineering-design.md](architecture/10-macro-engineering-design.md) |
| CI/CD policy | [architecture/github-actions-ci-cd-policy.md](architecture/github-actions-ci-cd-policy.md) |
| Architecture decisions | [decisions.md](decisions.md) |

## Acceptance Gates

验收矩阵见 [governance/verifier-map.md](governance/verifier-map.md)；测试分层与证据纪律见 [../AGENTS.md](../AGENTS.md) 的「验证与证据」。可见 UI 变化的标准审阅视口为 1440x810 light+dark，矩阵与补充窄视口见 [architecture/07-design-system-ssot.md](architecture/07-design-system-ssot.md) §7。
