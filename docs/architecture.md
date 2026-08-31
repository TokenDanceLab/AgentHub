# AgentHub 架构概览

最后更新：2026-08-29

本文档是架构入口，只保留当前结构、边界和 owner 链接。旧长版架构说明见 [history.md](history.md)。

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
  -> Hub Server
  -> Agent Runtime adapter
  -> Codex / OpenCode / Claude Code / SDK adapters

Web shared workbench
  -> Web platform adapter
  -> Hub Server
  -> Edge routing / relay
  -> Edge Server
  -> Agent Runtime adapter

Mobile (fixture/boundary lane, independent RN rendering)
  -> Mobile platform adapter
  -> Hub Server
  -> Edge routing / relay (via Hub)
```

| 层 | 目录 | 职责 |
|---|---|---|
| Shared UI | `app/shared/` | transcript、composer、inspector、platform contracts、design token |
| Workbench | `app/workbench/` | 端级工作台 shell（`@agenthub/workbench`，依赖方向 workbench → shared 单向，#1759） |
| Desktop | `app/desktop/` | Tauri shell、Desktop adapter、Local Edge、本机能力 |
| Web | `app/web/` | Hub session、Web adapter、远程审批和查看 |
| Mobile | `app/mobile-rn/` | RN shell、Mobile adapter、Hub viewer surface（fixture/边界验证 lane，独立渲染，非 release candidate） |
| Edge | `edge-server/` | 本地项目、Thread、Run lifecycle、Runtime adapter、Artifact index |
| Hub | `hub-server/` | TokenDance ID relying party、Hub session、IM、AgentTeam、同步、中继、审计 |
| API | `api/` | REST API 和 WebSocket event 契约 |

## 核心数据流

控制线 `Workbench -> Platform Adapter -> Edge/Hub -> Runtime adapter -> Runtime`；事件/证据/同步线的详细路径见 [02-edge-server.md](architecture/02-edge-server.md) §事件流 与 [04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)。

## 非协商边界

1. UI 不能直接启动 Agent CLI。
2. Web 不能持有 TokenDance API key、本机文件系统能力或 Local Edge 直连能力；Web 只和 Hub 通信。
3. Desktop renderer 不能获得 raw process execution 权限；危险能力必须经过 typed Tauri host API 和 allowlist。
4. Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份。
5. 所有来源必须 normalize 到统一 transcript contract 后再渲染。
6. Mock、fixture、observed、approved-real、production 必须显式区分；stub/fixture/readiness-only 不能冒充真实登录、真实模型/API、packaged Desktop 或 release。
7. Local Edge 负责本地执行、adapter 调用、runtime policy、日志和证据；Hub 负责账号、IM、同步、路由、权限、审计和远程控制面。
8. Agent Profile、Agent Configuration、Agent Runtime 和 Execution Target 必须保持术语分离。
9. 真实登录、真实模型消耗、部署、签名、公证、updater、release upload 都需要明确审批。
10. UI 改动必须有任务和验收；禁止无关重设计、调试信息污染聊天流或绕过 shared workbench 合同。
11. Hub 是控制面，不执行模型 Turn；任务拆分与路由由确定性 supervisor 承担，LLM 只能提供建议，不直接改路由、授权或审批状态机。
12. Hub/Edge 自有 REST/WS 是产品契约 SSOT；MCP/A2A/AG-UI 只做 capability mapping，不替换自有契约、不并行引入三套内部协议。
13. Hub→Edge 交付必须 at-least-once：稳定 event/delivery id + 幂等 consumer；跨业务变更的 outbox 同事务、event version 与 snapshot 策略要可审计，禁止 fire-and-forget 状态分叉。
14. 授权按最小代理权：task-scoped 凭据 + per-action 授权；secret 不进入 agent context/sandbox；所有能力流量经 typed platform contract / gateway。

## 产品模型

| 概念 | 含义 | Owner |
|---|---|---|
| Agent Runtime | 能启动和解析某类 Agent CLI/SDK 的执行适配器 | Edge adapter registry |
| Agent Profile | 用户选择的 Agent 实体 | Hub profile store / Edge local profile |
| Agent Configuration | Profile 的上下文、Skill、MCP、模型、审批策略 | Edge Context Builder + Hub store |
| Execution Target | 一次 Run 的执行位置：local、remote、cloud、relay | Edge registration + Hub routing |
| Conversation | 用户可见 IM 会话：私聊、群聊、项目会话 | Hub/Edge conversation store |
| Run Session | 一次执行生命周期和事件序列 | Edge lifecycle + EventStore |
| Artifact | Agent 产物索引、预览、应用和版本 | Edge artifact index + workspace |

## Frontend Contract

共享 UI 只消费 platform adapter，不直接调用 Tauri invoke、Hub client 或 Edge client。`AgentHubPlatform` 接口、Transcript 目标合同与消息流规则的完整定义见 [04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)（SSOT）。

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
| Dev server topology | [architecture/09-dev-server-topology.md](architecture/09-dev-server-topology.md) |
| Macro engineering baseline | [architecture/10-macro-engineering-design.md](architecture/10-macro-engineering-design.md) |
| CI/CD policy | [architecture/github-actions-ci-cd-policy.md](architecture/github-actions-ci-cd-policy.md) |
| Architecture decisions | [decisions.md](decisions.md) |

## Acceptance Gates

| 变更 | 最低验收 |
|---|---|
| API/协议 | OpenAPI YAML parse + affected handler/service tests |
| Hub/Edge 逻辑 | focused Go tests; broad changes run `go test ./... -short -count=1` in touched service |
| Backend performance/leak | 机器门禁 `scripts/verify/verify-backend-perf-leak-gates.py` 执行行为门禁与短微基准；证据等级分类见 [archives/reference/backend-performance-gates.md](archives/reference/backend-performance-gates.md)（已归档 2026-08-19） |
| Hub service 纯包边界 | 机器门禁 `scripts/verify/verify-hub-pure-packages.py`（`dispatch`/`deliveryoutbox`/`im`/`agentevent` 禁 import gorm/cache/ws/service 树，见 [architecture/01-hub-server.md](architecture/01-hub-server.md) §Service 领域子包） |
| Edge adapters 依赖方向 | 机器门禁 `scripts/verify/verify-orchestrator-deps.py` + `TestLeafDoesNotImportRootAdapters`（orchestrator 纯叶子不 import 根包，见 [architecture/02-edge-server.md](architecture/02-edge-server.md) §Adapter 家族子包） |
| Shared transcript/UI | shared unit/contract + Desktop/Web Playwright + Visual QA；merge gate 入口是 `app/{desktop,web}/scripts/visual-qa-shell.mjs`（两端 package script 均为 `visual:qa:shell`），标准审阅矩阵为 `1440x810` light+dark，并由同一 gate 补充 Web `768x900`、Desktop `800x900` 窄视口的非空白/几何合同；`app/web/scripts/visual-qa.mjs` 是可选/遗留多场景电池，不是 merge gate（旧视觉分数断言已删除，见 [architecture/07-design-system-ssot.md](architecture/07-design-system-ssot.md)） |
| Desktop packaged claim | Tauri package/sidecar/icon/installer evidence, not Vite-only |
| Real login/model/API claim | approved-real evidence with explicit approval and no silent fallback |

## 文档权威

- 当前规则：[../AGENTS.md](../AGENTS.md)
- 安全风险摘要：[../SECURITY.md](../SECURITY.md)（SSOT 在 TokenDance 私有治理文档）
