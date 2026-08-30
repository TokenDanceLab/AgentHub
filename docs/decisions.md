# AgentHub Decisions

最后更新：2026-08-29

本文件是当前架构决策摘要。旧 ADR 全文已外迁到 `docs/history.md` 指向的 TokenDance docs archive；旧正文只作追溯，不覆盖 `AGENTS.md`、`docs/architecture.md`、`docs/architecture/`、`api/` 或当前源码事实。

| ID | 状态 | 当前结论 | Owner | 仍有效 |
|---|---|---|---|---|
| ADR-001 | Accepted | AgentHub 保持 Hub/Edge 双层架构：Hub 负责账号、IM、同步、路由、审计；Edge 负责本地执行、adapter、workspace、事件和本地持久化。 | Architecture / Hub / Edge | 是 |
| ADR-002 | Accepted | 运行事件走 typed WebSocket event stream；CLI NDJSON/JSONL 只在 Edge adapter 内解析，REST 负责查询和普通 RPC。 | API / Edge / Frontend | 是 |
| ADR-003 | Accepted | 服务端状态使用 TanStack Query，客户端 UI 临时状态使用 Zustand；具体实现以 `app/shared`、Desktop/Web 当前代码为准。 | Frontend | 是 |
| ADR-004 | Accepted | Edge 使用 Go `os/exec` + AgentAdapter 管理 Agent CLI/SDK runtime，进程生命周期由 Edge lifecycle 承担。 | Edge | 是 |
| ADR-005 | Accepted, updated 2026-06-27 | worktree 隔离、短分支、PR 合并和清理仍是并行 Agent 工作的基本规则；模型/供应商路由改由 `AGENTS.md` 和 active skills 约束。 | Repository governance | 是，已更新 |
| ADR-006 | Accepted | Agent 间协作以 Hub typed TeamAssignment / TeamRun 为事实源；IM message 只是人可读投影，不作为 Agent 决策输入。 | Hub / Product model | 是 |
| ADR-007 | Accepted | Edge runtime 统一到 AgentAdapter + Registry + EventEmitter；新增 runtime 通过 adapter 接口接入，不让前端感知 CLI 差异。 | Edge adapters | 是 |
| ADR-008 | Accepted, partially superseded | 设计 token 化原则仍有效；旧 `--glass-*` 细节是历史实现，当前共享设计合同以 TokenDance design docs、OKLCH/CSS Modules 和 `--td-*` intent 为准。 | Frontend design | 部分有效 |
| ADR-009 | Accepted, historical | SettingsPage 拆分为 section/primitives/lazy lanes 的方向有效；是否已完成以当前 Desktop/Web settings 代码为准，不作为新 backlog。 | Frontend settings | 历史有效 |
| ADR-010 | Accepted | Edge 暴露 MCP-compatible capability 时以 Edge auth、tool schema、transport 和当前 endpoint 代码为准；不要为每个外部工具做专用协议。 | Edge MCP | 是 |
| ADR-011 | Accepted | 前端保持 pnpm workspace / shared package 架构；Desktop/Web/Mobile 共享类型和 UI contract，平台能力留在各平台 adapter。 | Frontend platform | 是 |
| ADR-012 | — 未单独成档 | 历史审计未找到 ADR-012 记录（git log 与归档索引均无）。编号跳过，不补记；后续新决策从 ADR-024 续号。 | — | — |
| ADR-013 | Accepted, historical | Hub app 启动入口应保持职责拆分：wiring、events、background、admin、router 等边界清楚；当前文件布局以源码为准。 | Hub server | 是 |
| ADR-014 | Accepted, partially realized | Agent team service 应按 CRUD、member、run、compete、routing、events 等领域拆分；当前落地情况以 `hub-server/internal/service/` 为准。 | Hub service | 部分有效 |
| ADR-015 | Accepted | 避免服务间循环依赖；优先窄接口、构造函数显式依赖和事件中介，不用 setter 注入掩盖循环。 | Hub architecture | 是 |
| ADR-016 | Accepted | Hub->Edge dispatch 需要 delivery outbox / ACK / retry / dead-letter 语义，避免 fire-and-forget 造成状态永久分歧。 | Hub reliability | 是 |
| ADR-017 | Accepted | Hub/Edge 授权区分身份令牌和 per-run capability token；真实安全边界以当前 JWT/capability 实现和风险登记表为准。 | Edge auth / Security | 是 |
| ADR-018 | Accepted | 仓库根布局：README/AGENTS/LICENSE/go.work/.github 与编辑器/CI 根配置必须留在根目录；不 bulk move。根 `docker-compose.yml` + `.env.example` 暂留；仅当 scripts/dev 与 verify 同改时可迁 `deployments/dev/`。正文已外迁（见 history.md）。 | Repository layout | 是 |
| A-V1 | Accepted 2026-08-03；landed 2026-08-03 (#1526/#1566) | adapters/lifecycle 拆分裁决：**lifecycle 不拆**（D-V1 已解 god-function 主痛点，纯谓词以文件名前缀表达足矣）；adapters 只做定向抽取——`adapters/orchestrator` 13 源文件迁入叶子包（插件式单向依赖，叶子仅依赖 `internal/orchestration` 合同 + 窄 ports，composition root 装配），驳回全量叶子包化。Step 0 合同 SSOT 抽离 #1526；Step 2 orchestrator 叶子包迁移 + `verify-orchestrator-deps.py` 依赖方向门禁 #1566。正文已外迁（见 history.md）。 | Edge adapters | 是 |
| A-V3 | Accepted 2026-08-03；landed 2026-08-03 (#1525) | `@agenthub/shared` 拆分裁决：**驳回全量 hub/edge 三分**（churn 高一个数量级、收益被既有 14 层边界门禁吃掉、mobile-rn 作为 hub-only 客户端仍需 hubClient）；采纳两个 quick-win——剔除零消费的 `apiClient.ts` 死表面、`workspace:*` 显式依赖声明；edge 表面隔离门禁 `verify-shared-edge-surface-isolation.py` 硬化（web/mobile 禁 import edge 表面）。正文已外迁（见 history.md）。 | Frontend boundary | 是 |
| ADR-019 | Accepted 2026-08-09 | bus/ws 单源：WebSocket 事件流走单一 bus 抽象，禁止前端/Edge 各自分叉 event 解析与重放；reconnect 补数据、dispatch 语义、停机广播、jitter、CAS 由 bus 统一承担。 | Frontend / Edge / API | 是 |
| ADR-020 | Accepted 2026-08-09 | execution target `target_type` 对齐：DB CHECK 枚举与 service/route 层 `target_type` 取值集合保持同名同序，service 校验与 DB 兜底不得漂移；组合约束（local_edge/hub_relay 需 route/device，remote_* 需 host）留 service 层。 | Hub / Edge | 是 |
| ADR-021 | Accepted 2026-08-09 | 安全门禁四修（AH-SR-051）：迁移触发器双炸弹修复链、Go toolchain 1.26.5（stdlib vuln GO-2026-5037/5038/5039）、i18n callsites ratchet 接线、文档版本对齐。 | Security / CI | 是 |
| ADR-022 | Accepted 2026-08-09 | 迁移触发器修复原则：已发布迁移不可变（不改 0040/0058.up/0060.up/0016.up），新建后续迁移（0061/0064）以 `DISABLE/ENABLE TRIGGER USER` 或 `NOT VALID` 方式旁路 0040 append-only 触发器；down 链同样补外包。legacy 行 backfill 留给计数器列通道，不在此轮。 | Hub migrations | 是 |
| ADR-023 | Accepted 2026-08-09 | Tauri 安全加固：sidecar 重启策略、command 门控（最小权限 capability）、SSRF 防护（出站 URL allowlist + 私网拦截）。正文见 Tauri 通道交付。 | Desktop / Security | 是 |
| ADR-024 | Accepted 2026-08-20；landed #1760/#1761（2026-08-19~20 全量落地） | service/adapters 领域子包化收官：#1761 hub `internal/service/` 平铺大包按领域拆 28 子包（Identity/Agent/IM/执行/资源/审计六族，`handler -> service -> repository` 单向依赖不变，纯包 `dispatch/deliveryoutbox/im/agentevent` 经 `verify-hub-pure-packages.py` 门禁禁止 import gorm/cache/ws/service 树，持久化经 `Store` 接口注入）；#1760 edge `internal/adapters/` 按 Agent 家族拆 `claude/codex/opencode/orchestrator/sdk/testdata` 叶子子包（orchestrator 为唯一纯叶子，`verify-orchestrator-deps.py` + `TestLeafDoesNotImportRootAdapters` 机器门禁，composition root 装配，根包保留共享 ACP 运行时）。新增领域逻辑放入对应子包，不再回平铺包。 | Hub / Edge architecture | 是 |

| ADR-025 | Accepted 2026-08-29（设计基线，未实施） | 双平面正式化：Hub 是控制面（不执行模型 Turn），Edge 是数据面；任务拆分/路由由确定性 supervisor 承担；证据由 Edge 产生并签名，Hub 只校验/审计。完整目标/差距矩阵见 `docs/architecture/10-macro-engineering-design.md`。 | Architecture / Hub / Edge | 是 |
| ADR-026 | Accepted 2026-08-29（设计基线，未实施） | 协议分层与四条 P0 设计合同：自有 REST/WS 保持产品契约 SSOT，MCP/A2A/AG-UI 只做 capability mapping；事件一致性（outbox 同事务/idempotent/version/snapshot）、最小代理权（task-scoped/per-action/secret 隔离）、OTel GenAI 可观测进入实施 backlog。升级但不替代 ADR-016/ADR-017。 | Architecture / Hub / Edge / Security | 是 |

## Archive

Full ADR bodies are archived in TokenDanceLab/docs under `archive/agenthub/repo/docs/adr/`. See [history.md](history.md) for the exact archive commit and follow-up tracking.
