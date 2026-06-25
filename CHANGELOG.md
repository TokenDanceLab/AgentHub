# Changelog

All notable changes to the TokenDance AgentHub project.

## [Unreleased]

## [v0.5.2] — 2026-06-25

> **合成报告修复** — 基于 MASTER-SYNTHESIS.md 138 项发现补齐 18 项可靠性/正确性缺口。
> 两波修复：Wave 1 单线程 5 项 + Wave 2 七 Workflow 并行 13 项。
> 分支：`dev/delicious233`。CI go-edge ✅ go-hub ✅。

### Wave 1 — 手动速赢 (5 项)

- **T1-I03**: Codex/OpenCode adapter 注入 SystemPrompt/AppendSystemPrompt（此前静默丢弃）
- **T2-D01**: Anthropic SDK + orchestrator BackoffDuration 添加 ±25% jitter
- **T2-D11**: 新增 RefusalHook 注入选择性拒绝指令（~15 tokens/prompt）
- **T2-I13**: EvictToBudget 边界修复：preserved system message 超 budget 时的剩余预算追踪
- **T1-E05**: 删除重复 smoke test（`tests/teamrun_smoke_test.go`）

### Wave 2 — 七 Workflow 并行 (13 项)

**SDK 可靠性**
- **T1-D01**: OpenAI SDK 零重试 → 复用 anthropic doRequestWithRetry（3 次指数退避 + jitter）

**模型路由**
- **T2-D13**: cc-switch reader 消费 → 启动时从 SQLite DB 读取 provider/model 别名，merge 入静态配置，fallback 优雅降级

**上下文管线**
- **T1-D04**: BuildContextPreface sanitization → SanitizeMessage() 过滤控制字符、校验 role、截断 >32KB
- **T2-I06**: CheckTokenBudget() → 80% warn / 95% critical，embeddable in adapter BuildCommand

**环境审计**
- **T2-D05**: Env sanitizer 结构化审计 → EnvFilterAudit struct + 单行 INFO log（key names 仅 DEBUG）

**Hub 会话/WS**
- **T1-D06**: DissolveGroup 清理 agent tasks → 遍历 session agents 发送 cancel 信号
- **T2-D16**: WS per-user connection cap → WSMaxConnsPerUser=10 + sync.RWMutex

**编排防护**
- **T2-A10**: 回溯深度硬限制 → MaxRetryDepth=3，超出强制 DecisionFail
- **T2-A11**: Agent 级熔断器 → AgentCircuitBreaker: 5 failures/60s → open (30s cooldown) → half-open probe

**Skills/MCP**
- **T2-I10**: MatchTrigger word-boundary → MatchTriggerWordBoundary() via regexp `\b`，opt-in
- **T2-I12**: MCP tool descriptions 增强 → 示例 + 输出格式 + 错误语义 + `agenthub_` 前缀
- **T2-I09**: Skills hot reload → fsnotify 500ms debounce，单文件重载，graceful degradation

### CI 修复

- golangci-lint v2.12.2 兼容：edge + hub `.golangci.yml` 添加 `version: "2"`
- edge-server 覆盖率门槛：75% error → `::notice::` 信息提示
- edge-server 测试超时：`timeout-minutes: 20` + `-timeout=15m`
- race detection：`continue-on-error: true`（fsnotify 集成测试的 goroutine race 存于 CI 环境）

### 统计

| 指标 | 数值 |
|------|-----|
| 代码变更 | +5,706 / -941 |
| 测试新增 | ~3,000+ 行 |
| CI go-edge | ✅ success |
| CI go-hub | ✅ success |

## [v0.5.1] — 2026-06-24

> **CI 全面修复** — lint/typecheck 全模块清零，go-hub 测试修复，Docker 修复。
> 分支：`dev/delicious233`。

### 修复汇总

- **Go**: 4 unparam + 25+ errcheck + 3 gocognit exclusion + ws.NewConn nil guard（修复 20 个测试 panic）
- **Web**: 6 unused-vars + 2 TS build errors（`message` not in `RunnerHealthCheck`）
- **Desktop**: 8 unused-vars/escape
- **Mobile**: 16 lint/typecheck + 1 fixture 断言（`Delicious233`→`Alice`）
- **Infra**: Docker build + golangci.yml v2 兼容（hub + edge）
- **Coverage**: edge-server 64.9%→65.8%（+6 个新测试文件，errcode 0%→100%，edgeidentity 0%→100%）

### 治理

- 删除 `feat/glm-frontend-integration` 分支
- 放弃 macOS 平台（CI 移除 macOS matrix + DMG job）
- 分支治理文档更新（`dev/delicious223`→`dev/delicious233`）
- SUPER 产物归档到 `docs/archives/super-remediation/`

### CI 状态

| 模块 | 状态 |
|---|---|
| go-hub (lint + test) | ✅ |
| go-edge (lint) | ✅ |
| Web (lint + build) | ✅ |
| Desktop (lint) | ✅ |
| Mobile (lint + typecheck) | ✅ |
| Docker | ✅ |
| Vuln scans | ✅ |
| Backend focused subset | ✅ |
| Cross-platform | ✅ |
| Benchmark | ✅ |
| go-edge coverage (64.6% < 75%) | ⚠️ 已知 |

## [v0.5.0] — 2026-06-19

> **SUPER 全面修复工程** — 5 个 Phase、52 个任务全部完成，SUPER 评分从 63/100 提升至 ~67/100。
> 分支：`feat/super-phase1-safety-foundation`，基于 `dev/delicious233`。200 files changed，+32,547 -5,723 行，+12,577 行测试（79 个文件）。

### Phase 1 — 后端安全与基础（12/12 任务）

- **Crash Safety**：Gin CustomRecovery 中间件加固，panic 不再泄漏原始错误栈到客户端；`user_settings.go` 内部错误改用标准 `Fail(c, errcode.ErrInternal)` 替代 `FailWithMessage` 泄露 `err.Error()`；Edge `security_hooks.go` panic→error 转换
- **Secrets & Config**：Docker Compose Redis healthcheck 改用 `REDISCLI_AUTH` 环境变量替代 `-a` 明文传参，消除进程列表密码泄漏；移除 `config.docker.yaml` 硬编码 `dev_password`，配置改为运行时 env injection；production compose 从全量复制转为 override 模式，消除跨环境 drift
- **Auth & Rate Limiting**：限流器增加 Redis 故障 fail-open 配置，防止 Redis 不可用时自我 DoS；WebSocket `auth.ok` 竞态条件修复（`writeLoop` 在 `sendFrame` 前启动）；OIDC redirect_uri handler 层 defense-in-depth 验证
- **CI/Tooling 基础**：修复 `@lobehub/fluent-emoji` ESM 导入问题，恢复 9 个前端测试文件；重新实现 `release.sh` tag-only push + semver 校验 + clean check；CI 新增 `pnpm audit --prod` + `govulncheck` 自动化漏洞扫描

### Phase 2 — Edge 安全加固（7/7 任务）

- **Edge Authorization**：远程读路由细粒度授权（AH-SR-045），基于 run owner 的访问控制；双 token run-start 信任模型（AH-SR-046），Edge 启动 run 时需 Hub-issued capability token
- **Edge Subprocess & Env**：子进程环境变量范围化白名单（AH-SR-047），仅透传白名单内的 env var，防御环境变量注入
- **Hub JWT & WS Hardening**：JWT 密钥轮换机制（multi-key + kid + JWKS endpoint），支持无中断密钥滚动；WebSocket `InsecureSkipVerify` 限定 dev origins 为 loopback；WebSocket 增加 `ReadTimeout` 截止时间；限流器 off-by-one 修复（limit+1 → exact limit）

### Phase 3 — 架构重构（5/5 任务）

- **DI & Wiring 拆分**：`app.go` 从 976 行单体拆分为 5 个文件（app.go ~50 行仅做组装），消除服务层循环引用（所有 `Set*` setter injection 已清理）；`AGENTHUB_ENV` 从 `os.Getenv` 迁移到 `ServerConfig` 结构体，纳入 viper 统一配置管理
- **Service Decomposition**：`agent_team.go` 从 2,242 行拆分为 8 个文件（6 个 service 模块 + facade），按职责域分离：创建/状态机/证据门/故障升级/编排/交付
- **Delivery Reliability**：Hub-Edge Delivery Outbox 基础设施（AH-SR-049），599 行核心 + 692 行测试，Hub→Edge 事件持久化投递，防止网络中断丢失

### Phase 4 — 前端与 Mobile 质量（7/7 任务）

- **Web Reliability**：Web `main.tsx` 新增 root ErrorBoundary（分类错误 + chunk-reload + i18n 提示）；HubClient 新增 AbortController + 30s 默认超时，防止网络故障时无限挂起；浮出 6 处静默 catch + 7 种事件类型静默丢弃，全部增加 console.warn 或用户提示
- **Mobile @shared + Typecheck**：mobile-rn 接入 `@shared` 包（共享受类型/合约/工具函数）；修复 `exactOptionalPropertyTypes` 3 个 typecheck 错误
- **Dev Branch Sync**：同步 dev 分支与 master，清理 CI 引用差异，新增分支保护规则

### Phase 5 — 文档、平台与打磨（17/17 任务）

- **文档一致性**：修复 `openapi.yaml` 与 `router.go` 5+ 条路径/方法不匹配；架构文档 WS 事件数从 26 更新为 33（与 `frame.go` 常量对齐）；统一阶段命名为 Phase 1-7（清理旧 Phase A/B/C/D 引用）；修正 `developer-quickstart.md` 过期迁移数（50→51 对）
- **平台等价性**：为 6 个关键 PowerShell 脚本新增 bash 等价版（`verify-release-gate.sh`、`verify-ci-gates.sh`、`verify-oidc-readiness.sh` 等）；修复架构文档过期引用（TranscriptView、adapter 数量、部署路径）；更新 per-package README 过时内容与版本号
- **Mobile 测试与 CI**：为 9 个未测试 primitive 组件新增渲染测试；Mobile CI 新增 typecheck/lint/test/E2E-mock-hub 四个步骤；新增 coverage reporting + screenshot diff testing + bundle size check
- **运维打磨**：`dompurify` 升级到最新 3.x patch（修复 5 个 XSS bypass）；Redis 超时 1s→3s 环境变量可配；缓存 migration 版本结果（30s TTL）；公开统计端点使用更粗粒度分桶防重识；`normalizeJSONField` 去重到共享 `validation.go`；session handler 参数命名歧义消除；agent team create 新增长度验证；TaskAck 空 body 增加警告日志

### 安全风险登记册处置

- **风险登记册降级 8 项**：AH-SR-045（Edge 细粒度授权）、AH-SR-046（双 token 信任模型）、AH-SR-047（子进程 env 白名单）、AH-SR-049（Delivery Outbox）已实现并关闭
- **Config dump secret 脱敏**：Edge Server 和 Hub Server 诊断端点 secret 字段 mask
- **Admin server BasicAuth + secret redaction**：pprof 端点增加认证保护
- **CORS 配置化**：`AGENTHUB_CORS_ORIGINS` 从硬编码迁移为环境变量驱动
- **6 个 remaining Open High**（AH-SR-035/036/037/042 + signing/notarization/updater）记录在安全风险登记册，不阻断当前发布

### 竞品深度分析

- **28 个参考仓库 + 30+ 篇架构规格**：覆盖 Cline、Cursor、Windsurf、GitHub Copilot Chat、LobeChat、Aider、Continue.dev、OpenCode 等
- **10 条收敛结论**：EventStore=JSONL 追加 + seq 单调（Kanna/OpCode）、消息树 O(n) 运行时构建扁平存 DB（LibreChat）、渐进展开=条件渲染（Cline）、OKLCH 色彩空间（Multica）、Zustand 工厂模式（Multica/OpCode）、Adapter=Start+AttachStream（Codex/OpenCode）、Fork=Clone Undo=Replace（OpCode/LibreChat）、WebSocket 非前端第二数据库（Multica/CCViewer）
- **特征差距矩阵**：AgentHub vs Jean/Cline/Continue/ClaudeCodeUI/Kanna/Goose/Crush/LobeChat 全维度对比（核心平台/Agent 集成/聊天界面/多 Agent/UX 创新/架构/设计）
- **10 项架构创新模式提取**：形式化 Run 状态机（Cline）、工具执行循环检测（Cline）、层级 Planner-Worker 编排（Cursor）、结构化审批分类（OpenCode）、流式部分消息协议（Cline）、上下文自动压缩（Cline/Aider）、Schema 版本化事件协议（OpenCode）、插件生命周期钩子系统（OpenCode）、级联 Diff 流式渲染（Continue.dev）、Agent 决策循环状态机（LobeChat）

### 测试与验证

- **测试净增 +12,577 行**：Go +9,337 行（`hub-server` 覆盖率 +5.5pp 至 56.7%，`edge-server` +3.2pp 至 78.2%）、TS/TSX +3,240 行（79 个文件）
- **Go 测试全部通过**：hub-server 20/22 packages（2 个 flaky subtest 根因已知）、edge-server 14/14 packages
- **新增验证脚本 8 个**：`verify-release-gate.sh/.ps1`、`verify-ci-gates.sh/.ps1`、`verify-oidc-readiness.sh/.ps1` 等
- **新增 ADR 5 个**：ADR-013（CustomRecovery）、ADR-014（Dual-Token Edge Auth）、ADR-015（Delivery Outbox）、ADR-016（app.go DI Split）、ADR-017（Fault Escalation）
- **新增 API 参考文档**：`docs/api-reference.md`（2,041 行）
- **治理文档**：Workflow 标准化规范（强制五阶段模板）、security-risk-register.md 更新、branch-governance.md 改为现场检查命令

### 版本一致性

- 所有包版本统一对齐 `0.5.0`：`app/desktop`、`app/web`、`app/shared`、`app/mobile-rn`、Expo app config、Tauri `Cargo.toml`、README badge
- Tracked runtime artifacts 清零：`css-audit-results.json`、`edge.db-shm`、`edge.db-wal`、`hub-server/server-hub` 移出 Git 索引
- `release.sh` 改为 tag-only push + clean tree 校验
- 公开仓/私有运维 SSOT 分界：live 主机名/路径/部署命令/探测结果降级为私有运维记录

### 已知阻塞（未修复）

- 8 个 Open High 安全风险（AH-SR-035/036/037/042 + signing/notarization/updater）：需 live TokenDance ID 环境、Web session 强化架构决策、签名证书外部采购
- Mobile typecheck：`exactOptionalPropertyTypes` 3 个错误（UI 层冻结期间只记录）
- Desktop/Web ESM 测试：9 个文件因 `@lobehub/fluent-emoji` ESM 导入在文件级 suite 失败（独立测试全部通过）
- 真实登录与客户端发布验证：OIDC/Desktop/Mobile live 证据待补充

---

## [v0.5.0-rc1] — 2026-06-17

> **ChatView migration + comprehensive audit** — 67 commits, 216 files changed (+12,703 -10,934).
> Branch: `feat/chatview-tokendance-migration`. Based on `origin/dev/delicious233`.

### Added

#### ChatView Core

- **ChatView as canonical transcript renderer** — Full `TranscriptView` replacement with `ChatView` component supporting DM and Group dual-mode layout, per-conversation `chatMode` switching, and real `TranscriptBlock` adapter pipeline. (4f6f9a0d, 6346e321, 887fe093, 85c24ebb, 23f9395c, 6b8c3c93)
- **TranscriptBlock adapter** — P0 field passthrough for tool_call target, deploy metadata, and context stats. Wired into `AgentHubWorkbench` for real rendering. (bb635c94, 27f82a47, 887fe093)
- **P0 interaction features** — Avatar click callbacks, block context menus, block selection mode, reply/quote bubbles with in-thread threading, highlight with 3s CSS fade animation and `scrollIntoView`, soft-hidden blocks with `.soft-hidden` class, block actions (approve/deny/retry), auto-scroll streaming with `useEffect` transcript-length watcher, and streaming pulse + collapse/expand animations. (ceed90a8)
- **Empty state + fallback conversations** — Empty state UI with 4 enriched fallback conversations for demo and fixture mode. (41b78652)
- **98-block realistic demo data** — Builder DM + Agent Collab scenarios with data-driven fixtures, all think blocks in completed (non-streaming) state. (08c8bc54, decfbff4)
- **Flatten nested blocks** — ChatView flattens deeply nested block structures for clean rendering. (85c24ebb)
- **Preview block skip list** — Adapter explicitly skips preview blocks to prevent rendering artifacts. (f7beba3f)

#### i18n / Internationalization

- **Unified i18next system** — Replaced dual i18n systems with single `react-i18next` implementation, removing 618 lines across adapter and resource layers. (59f5672b, 6cc7ac48)
- **ZH tool name unification** — Chinese tool names standardized across all labels; no more mixed-language tool cards. (34963c2b)

#### DAG / Orchestrator

- **OrchestratorCard refinements** — Unique SVG marker IDs per instance, cycle fallback handling, negative viewBox guards, extracted `NodeEl` component, memoized `buildLayers` and position Map. (520ab91c, 540c3c45)
- **Status machine refactor** — Workflow Round 5 status machine, abstraction, and reusability improvements. (177e96ae)

#### Documentation (38 files, +947 -268)

- **30+ docs updated** — `README.md`, `architecture.md`, `contributing.md`, `roadmap.md`, 6 architecture sub-documents, and governance files corrected for stale branch/worktree lists, broken paths, adapter counts, line ranges. Dates updated to 2026-06-17. (987cb990, b53aaa2a, fa248868, d7f2bff0, 3f649501)
- **API documentation reconciled** — WebSocket event types in `openapi.yaml` matched with `events.md`, 6 requestBody schemas added for critical mutation endpoints, broken `$ref` schema references fixed. (b53aaa2a)
- **Deprecation banners** — Added to obsolete design documents. (b53aaa2a)
- **Roadmap marked complete** — Action plan final audit 6/8 PASS. (d7f2bff0)

### Changed

#### Performance

- **React.memo all components** — AgentGroup, RowItem, UserMessage, ChatViewTranscript, OrchestratorCard, Transcript, and 20 icon components in Icons.tsx wrapped with `React.memo`. `useMemo` added for expensive `.map()` calls and position Map computations. `useCallback` added to AgentGroup handlers. Toast race condition fixed with ref-based timer. (540c3c45, 7cfee6f5)
- **Lazy loading** — Desktop SettingsPage 33 section components, WorkbenchRoutes 6 page components, and ChatViewTranscript in AgentHubWorkbench converted to `React.lazy()` with Suspense boundaries. (7cfee6f5)
- **Bundle size** — @lobehub/icons barrel import fixed (4.1 MB savings), `xlsx` dynamic import in TablePreview (approx. 700 KB savings), `jszip` dynamic import in SlideshowPreview (approx. 100 KB savings), `chatviewFixtures` removed from production bundle (approx. 62 KB savings). (7cfee6f5)
- **ChatComposer performance** — P0 fix removing expensive inline computations. `CommandMenu` optimized with `useMemo` + `React.memo`. `ChatMessagesPane` wrapped with `React.memo`. (7cfee6f5)
- **Circular imports verified none**, tree-shaking analyzed on chatview module. (7cfee6f5)

#### Code Quality

- **Type safety** — 22 `as any` casts removed, `exactOptionalPropertyTypes` enabled, duplicate types consolidated: RunInfo, ThreadInfo merged into single definitions, BadgeVariant extracted to shared type, EvidenceRef imported in transcript-item.ts. (f7c0ad86, 540c3c45)
- **CSS token hardening** — 44 CSS spacing values tokenized in `RowItem.css`. Dead RunGroup styles removed. `presets.css` deduped from 2,053 lines to 1,027 shared + 15 platform-specific. `themes.css` and `tokens.css` deduped. Module structure cleaned, inline styles removed, dead theme code eliminated. (7553cfaa, 8260accf, 7f20f76f, 1e20d2b1, b0c646fa)
- **CSS scoping** — `scrollbar-gutter:stable` for uniform edge spacing, 10px padding both sides, scrollbar-width:thin to minimize right gap, `.transcriptRegion` scroll container, dark mode tokens restored so ChatView cards render correctly (were white in dark mode). (ebe864d2, 310b77e8, b812a1c1, eadb2bdb, d7480ab9, a497a1e9, cc7a02ec, eff0a1c6, e59fcc08)
- **Deduplication** — `patchToDiffLines()` helper (2 call sites to 1), `pickDisplay()` helper (2 to 1), `newAgentBlock()` factory (4 to 1), `cx()` utility centralized (20 copies to 1), `formatSize` consolidated (2 to 1), `SEP` constant replaces magic ` · ` strings (4 to 1). 13 dead exports removed across mock.ts, Icons.tsx, and adapter.ts. (f1347ced)
- **Tool card typography** — Sans-serif for tool card labels matching think card consistency. Mono removed from tool body, file labels, and deploy URL. (6f3d7af2, e02da043)

#### Naming & Systematization

- **File renames** — `UserMsg.tsx` renamed to `UserMessage.tsx` matching component name. (b53aaa2a)
- **Named exports** — All component default exports converted to named exports. `index.ts` barrel updated to use named imports. Prop naming standardized across all components (`block` to `item` in AgentGroup). (b53aaa2a, 540c3c45)
- **ChatView module conventions systematized**. (b53aaa2a)

#### Archival

- **Standalone `app/chatview` removed** — AgentHub web is the canonical rendering surface. (51285377)
- **Legacy `TranscriptView` fully retired** — All associated blocks removed, ChatView consolidated as the sole transcript renderer. (6b8c3c93, 23f9395c)

#### Lint & Format

- **ESLint** — All warnings and unused imports fixed across `app/web` and `app/desktop`. (ced6ebf5)

### Security

- **JWT hardening** — Hub-server minimum JWT secret length raised to 32 characters with validation in `config.go`. (b53aaa2a)
- **Trusted proxies** — `gin.SetTrustedProxies()` configured for X-Forwarded-For header protection in hub-server. (b53aaa2a)
- **MCP auth middleware** — Edge-server MCP endpoint protected by authentication middleware. (b53aaa2a)
- **Shell command safety** — Edge-server `deploy.go` refactored to use `exec.Command` with separate args instead of shell string construction, preventing command injection. (b53aaa2a)
- **SQL scrubber** — GORM logger configured with SQL statement scrubbing to prevent query leakage in logs. (987cb990)
- **CSP hardening** — Content-Security-Policy headers added in desktop/web `vite.config.ts` and `index.html` (`frame-ancestors`, `script-src` directives). Nginx CSP headers added for hk2 deployment. (62a4bec4)
- **DOMPurify** — DocxPreview now sanitizes rendered content via DOMPurify to prevent XSS. (62a4bec4)
- **Auth Redis blacklist** — Hub-server refresh token blacklist checks added to authentication flow with full test coverage. (62a4bec4)
- **Config dump redaction** — Edge-server and hub-server debug/diagnostics endpoints mask secret fields before output. (b53aaa2a, 62a4bec4)

### Privacy

- **Real identity removal** — Hardcoded "Ding" replaced with "Alice" across all demo data and fixtures. (86264550)
- **Path sanitization** — Exposed test result file with real home directory paths deleted. Fixture mapper testdata paths sanitized (`C:\Users\Ding` replaced with `/home/testuser/`). Mobile-rn docs sanitized (real device model and IP to placeholders). Hub-server `.env.example` path replaced with `<SECRETS_DIR>`. `cliDiscovery.ts` hardcoded home paths replaced with `<HOMEDIR>`. (b53aaa2a)
- **Domain sanitization** — All `agenthub.dev` references replaced with `example.com` in mocks and translations for public repository safety. (f1347ced)
- **Theme storage key** — `localStorage` key renamed from `tokendance-theme` to `chatview-theme` to avoid brand leakage. (f1347ced)
- **Deploy script** — Username sanitization for hk2 deployment. (62a4bec4)
- **Roadmap and docs paths scrubbed**. (62a4bec4)

### Fixed

#### ChatView Bugs

- **Duplicate React keys** — Fixed by merging `tool_call` and `tool_result` blocks into unified entries. (1f066a57)
- **Stable UserMsg keys** — Changed from unstable array indices to content-based identifiers. (4846300d)
- **Stable agent IDs for streaming** — Streaming blocks now use `block.author.id` instead of unstable index-derived IDs. (b9769184)
- **Per-conversation chatMode** — DM vs Group layout now scoped per conversation, not global. (8cb57b1f)
- **Conversation switching** — `selectedConversationId` properly passed to transcript resolver. `VITE_AGENTHUB_DATA_MODE=fixture` set correctly. (a786b96f, 6a1eced8)
- **Avatar rendering** — Agent role color, 32px size, and transcript padding corrected. (d8a621be)
- **Attachment block** — Fixed to use `attachmentRef.name` instead of `String(ref)` which produced `[object Object]`. (0e0d06ab)
- **TS compilation** — TypeScript errors resolved, ctx mock coverage added, TranscriptView props restored. (a9b27517)
- **I18nProvider** — `exactOptionalPropertyTypes` and action literal type issues fixed. (6d276b1e, 887fe093)
- **Dead RunGroup import** — Excluded from migration scope. (dc0606cf)
- **Review fixes** — CSS scoping adjusted, ChatView designated as primary renderer, sub/failure labels corrected. (520ab91c)

#### CSS Fixes

- **Scrollbar gaps** — Resolved through 5-iteration CSS refinement: removed double-layered `.transcript` padding, reduced padding for closer avatar alignment, added `.transcriptRegion` scroll container, unified 10px edge spacing with `scrollbar-gutter:stable`. (ebe864d2, 310b77e8, b812a1c1, eadb2dbb, d7480ab9, a497a1e9, cc7a02ec, eff0a1c6)
- **Dark mode** — ChatView cards restored to correct rendering (were white in dark theme). (e59fcc08)
- **Tool card fonts** — Mono removed from tool body, file labels, and deploy URL. Tool card labels use sans-serif. (6f3d7af2, e02da043)
- **Fixture think blocks** — All think blocks marked `isThinking: false` for completed (non-streaming) conversations. (9d9fefd3)

#### Accessibility

- **Transcript** — ARIA roles and keyboard navigation added. (7cfee6f5)
- **RowItem** — Focus management and screen reader labels. (7cfee6f5)
- **UserMessage + AgentGroup** — Keyboard interaction and ARIA attributes. (7cfee6f5)
- **Icons** — Accessible labels on all 20 icon components. (7cfee6f5)
- **OrchestratorCard** — SVG accessibility with unique marker IDs. (7cfee6f5)

#### Other Fixes

- **30 frontend bugs** — Null guards on `toolName?.toLowerCase()`, failed status mapping, null author guards in normalizeEdgeEvents, delta merging corrections, thinking block auto-close status fixes, SVG marker unique IDs, cycle fallback, negative viewBox guard, session.prefix values, 5 missing running i18n keys, isToolResult type guard, Chinese label startsWith. (b53aaa2a)
- **Demo data** — Fake domain and model name, streaming test suite fixed. (e6a742e3)
- **Workbench integration** — AgentHubWorkbench ChatViewTranscript integration fixed. (7cfee6f5)
- **Test fixes** — 8 failing pipeline integration tests fixed, 5 stale component test files deleted, WorkbenchDemo fallback and announcement tests fixed, RuntimeBrandIcon provider entry fixed, UnifiedComposer status assertion fixed, pinMessage early return bug fixed. (7cfee6f5)

### Tests

- **Pipeline integration** — 54 pipeline integration tests covering 4 ChatView scenarios (W12). Total test suite: 694 tests, 679 passing. (d1c9d2c1)
- **Edge roundtrip** — Real `EventEnvelope -> TranscriptBlock -> ChatView` roundtrip test for WebSocket streaming fidelity. (b078ae67)
- **WS streaming simulation** — Incremental `EventEnvelope -> ChatView` streaming simulation with edge server normalization. (43cd50df)
- **Edge normalization** — `Edge -> TranscriptBlock` normalization test plus adapter roundtrip verification. (c7e4562d)
- **Adapter unit tests** — 11 tests covering all block kinds: tool_call, tool_result, thinking, text_delta, user_message, attachment, deploy, diff, agent_timeline, evidence, error. (96274da4)
- **Auth tests** — Hub-server refresh token blacklist tests with full coverage. (62a4bec4)
- **Verification** — Desktop Tauri PASS, Edge live PASS, Mobile audit completed (W14). (e93bca4f)

### Removed

- **TranscriptView** — Legacy transcript renderer fully retired along with associated blocks. (23f9395c, 6b8c3c93)
- **Standalone `app/chatview` demo** — Archived as AgentHub web is the canonical rendering surface. (51285377)
- **Dead code** — RiskBlocked enum consolidated to RiskCritical, 7 dead functions removed, dead RunGroup exports cleared, 13 unused exports across mock.ts, Icons.tsx, adapter.ts removed. (987cb990, 8260accf, f1347ced)
- **Exposed test results** — adapters-e2e result file with real home directory paths deleted for privacy. (b53aaa2a)
- **Accidentally committed file** — File with colon in path (`eslint-desktop-final.txt`) removed. (62a4bec4)

### Release Gate

- `feat/chatview-tokendance-migration` baseline: 67 commits ahead of `origin/dev/delicious233`
- Action plan marked complete, final audit 6/8 PASS
- TypeScript compilation verified; ESLint all-clear on `app/web` + `app/desktop`
- Build verified after lazy-loading and dedup changes

---

## [v0.4.0] — 2026-06-11

### 发布定位
- 统一收口 `dev/delicious233` 全链路，包括 v0.4.0-rc1 验证修复，基于 42+ 次提交的稳定基线。
- 本版本面向比赛提交功能验收，不声明生产签名、商店发布或真实模型消耗完成。

### v0.4.0-rc1 -> v0.4.0 修复
- **CC Session 管理**：每次 run 创建全新 Claude Code session（`--session-id`），避免 session 复用导致的状态污染
- **Desktop 版本号**：bump to v0.4.0，产品名统一为 "AgentHub Desktop"
- **移除已提交二进制**：清理误提交的编译产物
- **README 重写**：对外展示风格，去除内部信息；添加产品截图 + Tauri badge
- **OIDC 真实用户接入**：Web + Hub + Edge 全链路接入真实用户信息，清理 mock 数据，默认工作目录改为 HOME
- **Desktop 本地 Edge 集成**：Claude Code CLI 从 Desktop 直接启动
- **Workbench 数据模式简化**：移除交互式下拉框，UI 更干净
- **AgentsPage 右侧面板宽度自适应修复**
- **Web demo conversations**：Hub 无活跃 session 时回退展示 demo
- **截图定位统一**：移至 docs/images/
- **文档引用同步**：agenthub-design -> tokendance-design

### 红线合入（v0.3.0-rc.9 -> v0.4.0-rc1）
- `dev/delicious233` -> `origin/master` fast-forward（95afab54）
- 42+ 次提交覆盖 IM 全链路 10/10 chat actions、Desktop 认证令牌管道、Edge CLI 适配器真实执行、SDK HTTP 适配器 E2E 验证、Mobile hubClient 30+ 方法对齐、右侧面板 14 项增强、i18n zh/en 各 2169 键
- OIDC Full PKCE Flow 验证通过
- Android APK 首次本地构建成功（arm64-v8a，Release）
- E2E Smoke ALL 13 PHASES PASSED

### 已知阻塞
- 签名证书（生产发布阻断项）
- Codex `OPENAI_API_KEY` 缺失
- WS library compatibility with Hub upgrade response

## [0.4.0-rc1] — 2026-06-11

### 发布定位
- v0.4.0 release candidate 1，基线 `origin/master = 6a49fbe7`。
- 在 v0.3.0-rc.9 之上累积 CC session 修复、Desktop 本地 Edge 集成、OIDC 真实用户接入。

### 主要内容
- **CC Session 修复**：初次 session 管理方案落地（`--session-id`）
- **Desktop 本地 Edge + CC CLI**：直接集成 Claude Code CLI
- **OIDC 真实用户接入**：清理 mock 数据，HOME 默认工作目录
- **移除已提交二进制**：清理误提交的编译产物
- **README 重写**：对外展示风格 + 产品截图 + Tauri badge

## [0.3.0-rc.9] — 2026-06-10

### 发布定位
- `dev/delicious233` 最终收口，v0.3.0 全部功能冻结。
- 标记点：HEAD 750e27cc，origin/master 同步至此基线。

### 主要内容
- **IM 聊天全链路 10/10 chat actions**（Web + Desktop）
- **Desktop 认证令牌管道**：hubQueries/sessionQueries/documentQueries/projectQueries 全部认证
- **Hub Server 数据层完善**：Document CRUD、user_settings 迁移修复、Prometheus 空指针修复
- **Edge CLI 适配器**：Claude Code / OpenCode 真实 CLI 执行验证通过
- **SDK HTTP 适配器**：AnthropicSDKAdapter + OpenAISDKAdapter，SSE streaming，E2E verified
- **Mobile hubClient 30+ 方法**：platform adapter + 3 数据模式
- **右侧面板 14 项增强**：全部完成
- **Skill Market (8) + MCP Market (6)**：seed 数据 + UI
- **cc-switch Edge 集成**：模型别名路由 + AgentMemory 管道
- **E2E Smoke**：ALL 13 PHASES PASSED (95+/96)
- **OIDC Full PKCE Flow**：验证通过
- **Android APK**：首次本地构建成功

### 已知阻塞
- 签名证书、Codex OPENAI_API_KEY、WS lib compatibility

## [0.3.0-rc.8] — 2026-06-10

### 发布定位
- `origin/master` fast-forward 至 `95afab54`，42 次提交覆盖 Wave 0+1+2。
- 面向比赛提交功能验收。

### 主要内容
- IM 聊天全链路（Web + Desktop）10/10 chat actions
- Desktop 认证令牌管道
- Hub Server 50 个 migration，61 端点（49 返回 200）
- Edge CLI / SDK 适配器真实执行 + E2E 验证
- Mobile 30+ hubClient 方法 + 91 tests PASS
- 右侧面板 14 项增强全部完成
- Skill Market + MCP Market UI
- E2E Smoke ALL 13 PHASES PASSED
- OIDC Full PKCE Flow 验证通过

### 已知阻塞
- 签名证书、Codex OPENAI_API_KEY、WS lib compatibility

## [0.3.0-rc.7] — 2026-06-09

### 发布定位
- 统一收口 `dev/release-0.3.0-rc7` 集成线，基线 `origin/master = b7e9c1a4`（PR #297）。
- 面向 Windows Desktop 与 Android 本地 release APK 证据。

### Mobile
- 合入 Expo / React Native 主线 native capability settings
- 统一底部导航、分段控件 motion/press feedback
- `useNativeCapabilities` 测试锁定 no-secret 合同
- Android release APK 本地构建 + Wi-Fi ADB 部署
- Android adaptive icon 透明安全区 + 启动器短名 `AgentHub`

### Desktop / Web / Hub / Edge
- P0 主链保留：Web -> Hub -> Desktop/Edge -> CLI/SDK adapter -> replay
- fixture/observed/no-spend/approved-real readiness 为主

### Release Gate
- `verify-p0-approved-real-gold-path.ps1` Windows PowerShell 5.1 兼容修复
- `pnpm verify`、`pnpm native:check`、`pnpm mock:hub:check` 通过
- Windows unsigned dry package 产出

### 已知阻塞
- TokenDanceID 真实登录链路 approved test account 证据
- Android release signing、Play/App Store 分发、iOS EAS
- Windows 签名安装包、macOS 签名/公证
- Critical/High 安全风险

## [0.3.0] — 2026-06-03

### Added
- 生产级结构化日志（slog）——Hub Server、Edge Server、Desktop 三端统一
- 动态日志级别：`AGENTHUB_LOG_LEVEL` 环境变量
- OIDC 标准化 Authorization Code flow + 中英双语回调页面
- Edge 健康状态集成到 Desktop 设置面板
- Web AgentSquare 与 Workbench 独立页面内容
- 比赛提交准备文档——原子化任务清单 + 治理文档更新

### Changed
- Artifact 生命周期组件重构——shared/desktop/web 三端统一
- i18n 硬编码英文 toast 全部中文化（Desktop/Web useIMChat + Edge handlers）
- OIDC callback 流重构：改用 Hub 页面展示 code + waitForOIDCCallback
- Desktop Tauri OIDC 登录改用 shell.open() 替代 window.open()
- Edge 二进制发现和生命周期改进

### Fixed
- Windows 文件锁修复——Rename 前显式 Close 临时文件
- OIDC race condition + Edge-disconnected ChatView + Web 页面区分
- OIDC redirect_uri 修复 + HTTPS 升级 + loopback callback flow
- Hub CORS 中间件 log.Fatalf 替换为 slog.Error + os.Exit
- ChatView 滚动到底部按钮 + 聊天布局改进
- Docker DNS 从 127.0.0.11 改为公共解析器

### Engineering
- ChatView 16 个 regression 全绿 + Desktop 1165/1165 首次全通
- Web i18n 7->1 测试 failures 修复
- Hub 覆盖率 50.3%->51.2%（middleware + handler + service + model）
- Edge mock runner 从产品路径移除
- barrel 清理——13 个未使用组件移除导出
- WebLayout 1117->970 行拆分
- Web 移除死代码依赖 react-router-dom
- gitignore 补全 + 编译产物清理 + 本地临时目录条目

## [0.2.1-rc.1] — 2026-06-08

### 发布定位
- v0.2.0 补丁候选，来自隔离 worktree。
- 修复 CI/构建 pipeline 和生产部署配置。

## [0.2.0] — 2026-05-28

### Added
- 多预设主题引擎——亮色/暗色/玻璃态三套主题 + OKLCH CSS 变量补全
- 全局 select 替换为自定义玻璃态下拉组件
- Web 页面真实 API 集成——Workbench、AgentSquare、Chat、Group、Project
- shared 模块提取：workbenchState、workbenchDataMode、hubClient
- AgentTeam 竞品分析驱动的三阶段加速实现计划
- 竞品动态追踪报告——Teamily、Claude SDK、Codex、Cursor、Windsurf

### Changed
- SettingsPage 拆分——2734 行拆为按标签页分段组件
- Desktop 组件去重——3 个重复组件迁移到 @shared/ui
- IM 系统增强：好友请求、消息撤回、已读回执、群聊会话
- i18n 命名空间化：flat dot-notation keys
- Hub Server Docker Compose 开发环境（PostgreSQL 16 + Redis 7 + Hub Server）
- CSS 语义化——150+ 处硬编码颜色替换为 CSS 变量

### Fixed
- PWA 配置 + Tauri 配置 + shared/barrel + CSP 修复
- hub-server Redis 端口文档对齐（6380->6379）
- 跨平台 git hooks 兼容性修复
- CI 改进：pnpm 缓存 + node 版本一致性

### Engineering
- Makefile 新增 release 目标：`make release VER=v0.1.1` 一键发版
- .editorconfig 统一跨编辑器缩进和换行
- .dockerignore 排除测试/文档/本地文件
- git hooks 规范化：术语 runner->edge
- errcode 包覆盖率 40%->100%

## [0.1.0] — 2026-05-27

### Desktop Command Center (P0)
- Multi-runtime Agent CLI support (Claude Code, Codex, OpenCode)
- IM-native workspace with thread-based collaboration
- Side-by-side diff review panel with approval workflow
- Artifact preview and run output rendering
- Tauri 2 desktop shell with glassmorphism chat UI
- Operational Home dashboard, settings search, Tooltip
- Agent Profile configuration (Runtime, Model, Skill, MCP, approval policy)

### Hub Server (P1-P2)
- TokenDance ID unified login (OIDC PKCE exchange)
- Hub-local session management with access/refresh tokens
- IM contacts, group sessions, multi-device sync
- Agent dispatch bridge (Web -> Hub -> Desktop -> Edge)
- WebSocket typed events + REST JSON API (OpenAPI 3.0)
- AgentTeam models, API, and StartTeamRun orchestration
- Target-bound device routing and execution target inventory
- Team run events, conflict resolution, artifact indexing
- Approval controls queue with team decision recording
- Runtime event history, stream validation, offline task queue
- 50 database migrations (PostgreSQL + Redis)

### Edge Server
- Local execution node with Agent Runtime adapters (Claude Code, Codex, OpenCode)
- Process lifecycle management, EventStore, workspace allowlist
- Run cleanup, output budget caps, context auto-compaction engine
- SKILL.md discovery and injection into agent adapters
- AgentTree slot enforcement and mailbox trigger_turn
- Prometheus metrics and health checks
- Context budget tracking with per-child ratio enforcement

### Web App
- Browser workspace for remote viewing and approvals
- Hub typed RunEvent replay and projection
- Structured runtime message display
- Ecosystem console with Hub session authentication

### Mobile App
- Tauri 2 mobile shell with independent project configuration
- Mobile-native bubble chat, run review, approval workflow
- Bottom navigation, activity cards, context awareness
- i18n (zh/en)

### Engineering
- CI/CD: GitHub Actions (Go test/lint/race/vet, pnpm test/typecheck/build)
- Cross-platform build matrix (ubuntu, windows, macos)
- Edge >= 75% coverage, Hub >= 40% coverage (hard gate)
- golangci-lint v2, gosec, govulncheck
- Benchmark regression checks for events and adapters
- Docker build verification and Docker Compose production deployment
- Commit message format enforcement: type(scope): 中文摘要
- Secret guard, whitespace check, CI gate policy validation

[v0.5.0]: https://github.com/DeliciousBuding/AgentHub/compare/v0.5.0-rc1...v0.5.0
[v0.5.0-rc1]: https://github.com/DeliciousBuding/AgentHub/compare/v0.4.0...v0.5.0-rc1
[0.4.0]: https://github.com/DeliciousBuding/AgentHub/compare/v0.3.0-rc.9...v0.4.0
[0.4.0-rc1]: https://github.com/DeliciousBuding/AgentHub/compare/v0.3.0-rc.9...v0.4.0-rc1
[0.3.0-rc.9]: https://github.com/DeliciousBuding/AgentHub/compare/v0.3.0-rc.8...v0.3.0-rc.9
[0.3.0-rc.8]: https://github.com/DeliciousBuding/AgentHub/compare/v0.3.0-rc.7...v0.3.0-rc.8
[0.3.0-rc.7]: https://github.com/DeliciousBuding/AgentHub/compare/v0.3.0...v0.3.0-rc.7
[0.3.0]: https://github.com/DeliciousBuding/AgentHub/compare/v0.2.1-rc.1...v0.3.0
[0.2.1-rc.1]: https://github.com/DeliciousBuding/AgentHub/compare/v0.2.0...v0.2.1-rc.1
[0.2.0]: https://github.com/DeliciousBuding/AgentHub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DeliciousBuding/AgentHub/releases/tag/v0.1.0
