# AgentHub 架构概览

最后更新：2026-06-27

本文档是架构入口，只保留当前结构、边界和 owner 链接。旧长版架构说明已归档到 [archive/architecture/architecture-overview-2026-06-27.md](archive/architecture/architecture-overview-2026-06-27.md)。

## 产品定位

AgentHub 是 IM 形态的多 Agent 协作工作台。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview、产物和部署结果，而不是 runtime 下拉框。

```text
AgentHub = shared IM workbench + local/remote Agent execution + Hub collaboration network
```

## 五层结构

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
```

| 层 | 目录 | 职责 |
|---|---|---|
| Shared UI | `app/shared/` | workbench、transcript、composer、inspector、platform contracts |
| Desktop | `app/desktop/` | Tauri shell、Desktop adapter、Local Edge、本机能力 |
| Web | `app/web/` | Hub session、Web adapter、远程审批和查看 |
| Edge | `edge-server/` | 本地项目、Thread、Run lifecycle、Runtime adapter、Artifact index |
| Hub | `hub-server/` | TokenDance ID relying party、Hub session、IM、AgentTeam、同步、中继、审计 |
| API | `api/` | REST API 和 WebSocket event 契约 |

## 核心数据流

| 流 | 路径 |
|---|---|
| 控制线 | `Workbench -> Platform Adapter -> Edge/Hub -> Runtime adapter -> Runtime` |
| 事件线 | `Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript` |
| 证据线 | `RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview` |
| 同步线 | `Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers` |

## 非协商边界

1. UI 不能直接启动 Agent CLI。
2. Web 不能持有 TokenDance API key、本机文件系统能力或 Local Edge 直连能力。
3. Desktop renderer 不能获得 raw process execution 权限；危险能力必须经过 typed Tauri host API 和 allowlist。
4. Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份。
5. 所有来源必须 normalize 到统一 transcript contract 后再渲染。
6. Mock、fixture、observed、approved-real、production 必须显式区分；stub/fixture/readiness-only 不能冒充真实登录、真实模型/API、packaged Desktop 或 release。

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

共享 UI 只消费 platform adapter，不直接调用 Tauri invoke、Hub client 或 Edge client。

```ts
interface AgentHubPlatform {
  surface: "desktop" | "web";
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  runs: RunPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  settings?: SettingsPort;
}
```

Transcript 目标合同：

```text
Conversation -> Message -> TranscriptBlock -> TranscriptItem -> RowItem / UserMsg / AgentGroup
```

消息流必须按时间线性展示。用户输入应立即出现且不闪消；Agent 回复、工具调用、审批、子 Agent 报告、Diff、Preview 和结果卡片按事件时间归一化后渲染。详细分组、滚动、markdown/table 和 data mode 合同见 [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)。

## Module Owners

| 主题 | 文档 |
|---|---|
| Hub Server | [architecture/01-hub-server.md](architecture/01-hub-server.md) |
| Edge Server | [architecture/02-edge-server.md](architecture/02-edge-server.md) |
| Runtime adapters | [architecture/03-runtime-adapters.md](architecture/03-runtime-adapters.md) |
| Frontend data flow | [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md) |
| Deployment | [architecture/05-deployment.md](architecture/05-deployment.md) |
| Auth and identity | [architecture/06-auth-identity.md](architecture/06-auth-identity.md) |
| Architecture decisions | [adr/](adr/) |

## Acceptance Gates

| 变更 | 最低验收 |
|---|---|
| API/协议 | OpenAPI YAML parse + affected handler/service tests |
| Hub/Edge 逻辑 | focused Go tests; broad changes run `go test ./... -short -count=1` in touched service |
| Shared transcript/UI | shared unit/contract + Desktop/Web Playwright + Visual QA；Desktop/Web 主视口为 16:9 `1440x810` |
| Desktop packaged claim | Tauri package/sidecar/icon/installer evidence, not Vite-only |
| Real login/model/API claim | approved-real evidence with explicit approval and no silent fallback |

## 文档权威

- 当前规则：[../AGENTS.md](../AGENTS.md)
- 当前 SPEC 进度：[progress/MASTER.md](progress/MASTER.md)
- 总进度：[roadmap.md](roadmap.md)
- 安全风险：[governance/security-risk-register.md](governance/security-risk-register.md)
