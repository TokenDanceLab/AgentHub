# AgentHub Roadmap

最后更新：2026-06-27

本文档是 AgentHub 的总进度入口，只记录当前方向、优先级和验收边界。历史 longform roadmap 已归档到 [archive/roadmap-v0.5.1/roadmap-longform-2026-06-27.md](archive/roadmap-v0.5.1/roadmap-longform-2026-06-27.md)。

## 产品北极星

AgentHub 是 IM 形态的多 Agent 协作工作台。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview 和产物，而不是 Runtime 下拉框。

核心判断：

- Agent Profile 回答“谁来做事”，Agent Runtime 回答“用什么执行”。
- Web 远控、Desktop 本地执行、Mobile/IM 审批查看使用同一 Hub/Edge 事件合同。
- 产物必须内联展示：Diff、Preview、文件附件、审批、部署状态和生成资产不应散落在后台日志里。
- Mock、fixture、observed、approved-real、production 必须显式区分。

## 当前 SPEC

当前执行中的 spec-driven 专项以 [progress/MASTER.md](progress/MASTER.md) 为准。MASTER 只记录当前专项进度、Issue/PR、阻塞和验收证据；本 roadmap 不复制任务日志。

当前阶段：

| Phase | 状态 | 说明 |
|---|---|---|
| Phase 1 Governance Baseline | 完成 | `AGENTS.md` 为项目规则 SSOT，根级重复规则文件已移除，旧 skill 归档 |
| Phase 2 Real E2E Contract | 完成 | 证据等级、数据模式边界、Visual QA、smoke manifest 归一化 |
| Phase 3 Source And Test Alignment | 进行中 | 已完成 API/Hub、模块 README、进度 SSOT、#330 聊天流测试加固、#331 前端架构文档对齐、#332 后端性能/泄漏 gate 分类、#333 Desktop packaged evidence 和 #352 active-doc consolidation；当前处理 #354 active documentation spine 去巨石化，随后回到 #334 Web/Mobile client test lanes |
| Phase 4 Acceptance And Merge Readiness | 待开始 | 聚合验收、架构审批、归档和合并准备 |

## 当前优先级

### P0

| 方向 | 目标 | 验收 |
|---|---|---|
| 文档治理 | active docs 只保留规则、当前 spec、总路线、架构和契约入口；重复规则面和历史 longform/审计/发布材料/旧入口快照归档 | `scripts/verify-doc-ssot.ps1` |
| 真实 E2E 合同 | `.agents/skills/real-e2e-acceptance/SKILL.md` 是唯一证据等级矩阵 | `scripts/verify-real-e2e-contract.ps1` |
| 远控拓扑前置合同 | P0 remote-control fixture 验证 `Web -> Hub -> Desktop/Edge -> Local Edge -> CLI/SDK adapter` 的离线拓扑形状，不声明真实登录或真实执行 | `scripts/verify-p0-remote-control-fixture.ps1` |
| Chat flow 可靠性 | 发送不消失、消息线性排序、自动滚动、卡片合并、markdown/table 渲染 | Desktop/Web Playwright + Visual QA |
| Hub/Edge 安全边界 | TokenDance ID 只做身份，AgentHub 权限由 Hub 本地资源检查决定 | 后端 auth/permission tests + security risk register |

### P1

| 方向 | 目标 | 验收 |
|---|---|---|
| Web/Mobile client test lanes | Web 保持 Hub-only；Mobile 只澄清 RN-safe shared contract gate，不做 native/UI 深入重构 | Web data-boundary checks + Mobile mock-Hub/Expo Doctor boundary notes |
| Desktop packaged boundary | 区分 Vite renderer、Tauri packaged、sidecar、icon、installer/signing | packaged-release gate 或明确 `real_tested=false` |
| Source/test alignment | Shared transcript/data-mode normalizer 和 Desktop/Web 实现一致 | shared unit + app E2E |
| Backend performance/leak | 对 Hub EventBus/outbox/scheduler/Redis TTL、Edge lifecycle/store/adapters 建立路径级检查 | [../scripts/load-test-scenarios.md](../scripts/load-test-scenarios.md) + `scripts/verify-backend-perf-leak-gates.ps1` |
| API contract hygiene | REST 以 `api/openapi.yaml` 为准，WS 以 `api/events.md` 为准 | OpenAPI parse + endpoint tests |

### P2

| 方向 | 目标 | 验收 |
|---|---|---|
| Mobile | 暂不做 UI/native 深入重构；只保持现有 required gate 边界清楚 | Expo Web Visual QA + mock-Hub + Expo Doctor，不声明 native/device/real Hub |
| Release hardening | High 风险关闭或 accepted，依赖漏洞和安全头补齐 | release gate + risk register |
| Long-term docs | 活跃文档只保留入口/当前事实/owner 链接；历史 session log、审计和旧入口快照归档 | doc SSOT + 人工 review |

## 架构入口

| 主题 | 权威位置 |
|---|---|
| 系统结构、数据流、Desktop/Web/Mobile 边界 | [architecture.md](architecture.md) |
| Hub Server | [architecture/01-hub-server.md](architecture/01-hub-server.md) |
| Edge Server | [architecture/02-edge-server.md](architecture/02-edge-server.md) |
| Runtime adapters | [architecture/03-runtime-adapters.md](architecture/03-runtime-adapters.md) |
| Frontend data flow | [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md) |
| Deployment | [architecture/05-deployment.md](architecture/05-deployment.md) |
| Auth and identity | [architecture/06-auth-identity.md](architecture/06-auth-identity.md) |
| Architecture decisions | [adr/](adr/) |

## API 入口

| 契约 | 权威位置 |
|---|---|
| REST API | `api/openapi.yaml` |
| WebSocket events | [../api/events.md](../api/events.md) |
| API conventions | [../api/conventions.md](../api/conventions.md) |
| Human-readable API index | [api-reference.md](api-reference.md) |

## 数据模式与证据边界

`dataMode` 是兼容字段，不单独证明数据来源、登录状态或真实执行。验收时同时标注 Surface、Data Source、Auth/Execution，并按 `.agents/skills/real-e2e-acceptance/SKILL.md` 写证据等级。

| 产品模式 | Data Source | Auth/Execution | 边界 |
|---|---|---|---|
| Demo | local-mock | anonymous | Workbench runtime 不访问 Hub/Edge；Desktop entry preflight 可探测 Local Edge health |
| Fixture | deterministic-fixture | anonymous | 只验证离线证据形状，`real_tested=false` |
| Local | Local Edge | local-only | Desktop 可访问 `127.0.0.1:3210`；Web 不直连 Local Edge |
| Login/Hub | Hub | hub-signed-in | 需要 Hub session 证据；不等于模型消耗 |
| Observed | observed replay | read-only observed | 只读回放或无消耗观察；不代表真实执行 |
| Approved-Real | approved Hub/Edge/CLI/API | approved-real | 只有 approved-real gate 和 manifest 通过时才可声明真实登录或真实 CLI/model/API |

## 非协商边界

1. Web 只和 Hub 通信，不直接连接 Local Edge 或 raw runtime。
2. Desktop renderer 不获得 raw process execution 权限。
3. Local Edge 负责本地执行、adapter 调用、runtime policy、日志和证据。
4. Hub 负责账号、IM、同步、路由、权限、审计和远程控制面。
5. Agent Profile、Agent Configuration、Agent Runtime 和 Execution Target 必须保持术语分离。
6. Mock 和 fixture 模式必须显式；real mode 不能静默降级。
7. 真实登录、真实模型消耗、部署、签名、公证、updater、release upload 都需要明确审批。
8. 当前 spec 进度写 `docs/progress/MASTER.md`，规则写 `AGENTS.md`，历史 longform/审计/发布材料放 `docs/archive/`，已完成 spec 工件和过期项目 skill 放 `docs/archives/`。
9. UI 改动必须有任务和验收；禁止无关重设计、调试信息污染聊天流或绕过 shared workbench 合同。
10. TokenDance API key 不得暴露给浏览器 UI。

## 归档入口

| 内容 | 位置 |
|---|---|
| 历史 roadmap、审计、发布说明、过期设计、旧参考调研 | [archive/README.md](archive/README.md) |
| 已完成 spec-driven 专项和过期项目 skill | [archives/README.md](archives/README.md) |
