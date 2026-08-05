# AgentHub Roadmap

最后更新：2026-07-21

本文档是 AgentHub 的总进度入口，只记录当前方向、优先级和验收边界。历史 longform roadmap 见 [history.md](history.md)。

## 产品北极星

产品定位与架构定义见 [architecture.md](architecture.md)（IM 形态的多 Agent 协作工作台，SSOT 在架构文档）。此处只记录产品方向判断：

- Agent Profile 回答“谁来做事”，Agent Runtime 回答“用什么执行”。
- Web 远控、Desktop 本地执行、Mobile/IM 审批查看使用同一 Hub/Edge 事件合同。
- 产物必须内联展示：Diff、Preview、文件附件、审批、部署状态和生成资产不应散落在后台日志里。
- Mock、fixture、observed、approved-real、production 必须显式区分。

## 已完成波次（历史，勿重启）

活进度只看 [progress/MASTER.md](progress/MASTER.md)。下表是已关闭波次的归档指针，只作追溯，不表示当前工作。

| Program | Status | Pointer |
|---|---|---|
| Post-Polish Residual Hardening (Phases 79–80) | **closed** 2026-07-21 · #1340 #1341 #1342 | [plan/post-polish-task-breakdown.md](archives/plan/post-polish-task-breakdown.md) |
| Visual polish (Phases 73–78) | closed 2026-07-20 · gate **89 Ship** | [analysis/visual-qa-scorecard.md](archives/analysis/visual-qa-scorecard.md) |
| Cleanup baseline (Phases 0–7) | closed 2026-07-16 / PR [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) | [archives/cleanup-baseline/](archives/cleanup-baseline/) · historical `docs/plan/*` banners |

## 当前优先级

### P0

| 方向 | 目标 | 验收 |
|---|---|---|
| 真实 E2E 合同 | `.agents/skills/real-e2e-acceptance/SKILL.md` 是唯一证据等级矩阵 | `scripts/verify/verify-real-e2e-contract.py` |
| 远控拓扑前置合同 | P0 remote-control fixture 验证 `Web -> Hub -> Desktop/Edge -> Local Edge -> CLI/SDK adapter` 的离线拓扑形状，不声明真实登录或真实执行 | `scripts/verify/verify-p0-remote-control-fixture.py` |
| Chat flow 可靠性 | 发送不消失、消息线性排序、自动滚动、卡片合并、markdown/table 渲染 | Desktop/Web Playwright + Visual QA |
| Hub/Edge 安全边界 | TokenDance ID 只做身份，AgentHub 权限由 Hub 本地资源检查决定 | 后端 auth/permission tests + security risk register |
| 文档 SSOT 保持 | MASTER/roadmap 与 closed residual 对齐；不复活 cleanup Phase 61 叙事 | `scripts/verify/verify-doc-ssot.py` |

### P1

| 方向 | 目标 | 验收 |
|---|---|---|
| Web/Mobile client test lanes | Web 保持 Hub-only；Mobile 只澄清 RN-safe shared contract gate，不做 native/UI 深入重构 | Web data-boundary checks + Mobile mock-Hub/Expo Doctor boundary notes |
| Desktop packaged boundary | 区分 Vite renderer、Tauri packaged、sidecar、icon、installer/signing | packaged-release gate 或明确 `real_tested=false` |
| Backend performance/leak | 行为/微基准门禁已绿；不声明生产容量；**手动** `workflow_dispatch` job `Backend perf/leak gates` | [reference/backend-performance-gates.md](reference/backend-performance-gates.md) + `scripts/verify/verify-backend-perf-leak-gates.py` **PASS**（非 capacity） |
| Mobile PR CI light | mobile-rn / shared hubClient 变更跑 typecheck+unit；重 suite 仍 dispatch | checks.yml `frontend-mobile-light` path-filter |
| API contract hygiene | REST 以 `api/openapi.yaml` 为准，WS 以 `api/events.md` 为准 | OpenAPI parse + endpoint tests |

### P2

| 方向 | 目标 | 验收 |
|---|---|---|
| Mobile UI/native | 暂不做 UI/native 深入重构；只保持 required gate 边界清楚 | Expo Web Visual QA + mock-Hub + Expo Doctor，不声明 native/device/real Hub |
| Visual residual | Type/Motion/Empty 剩余 3pt — 仅在 interactive methodology 下推进 | 不 chase static gate past 89 |
| Release hardening | High 风险关闭或 accepted；deploy/client 证据项显式 defer | release gate + risk register |

## 架构入口

架构模块导航、owner 链接与数据流概览以 [architecture.md](architecture.md) 及其 `architecture/` 子文档为 SSOT（Hub/Edge/Runtime adapters/Frontend data flow/Deployment/Auth/Design system/Outbound HTTP/decisions）。

## API 入口

| 契约 | 权威位置 |
|---|---|
| REST API | `api/openapi.yaml` |
| WebSocket events | [../api/events.md](../api/events.md) |
| API conventions | [../api/conventions.md](../api/conventions.md) |
| Human-readable API index | [api-reference.md](api-reference.md) |

## 数据模式与证据边界

`dataMode` 是兼容字段，不单独证明数据来源、登录状态或真实执行。产品模式→数据源→Auth/Execution→禁止声明的完整矩阵见 [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)；证据等级矩阵见 `.agents/skills/real-e2e-acceptance/SKILL.md`。

## 非协商边界

架构级非协商边界以 [architecture.md](architecture.md) 为 SSOT。规则/进度/历史归档的归属见 `AGENTS.md` §8 文档规则。

## 归档入口

| 内容 | 位置 |
|---|---|
| 历史 roadmap、审计、发布说明、过期设计、旧参考调研 | [history.md](history.md) |
| 已完成 spec-driven 专项和过期项目 skill | [history.md](history.md) |
| cleanup-baseline 程序快照（closed 2026-07-16 / PR #446） | [archives/cleanup-baseline/](archives/cleanup-baseline/) |
