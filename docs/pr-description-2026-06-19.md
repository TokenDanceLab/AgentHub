# PR 描述：SUPER Phase 1 安全与基础工程修复

**分支**: `feat/super-phase1-safety-foundation`
**目标**: `dev/delicious233`
**仓库**: `TokenDanceLab/AgentHub`
**日期**: 2026-06-19

---

## 概览

本 PR 是 AgentHub SUPER 工程审计（基线 63/100）的全面修复产物，覆盖 5 个活跃 Phase 共 46 个任务，目标是将工程治理评分从 63 提升至 70+，并尽可能逼近 release gate 达标。

| 指标 | 数值 |
|---|---|
| 提交数 | 25 |
| 变更文件 | 342 |
| 新增行 | +33,639 |
| 删除行 | -6,144 |
| 新增测试行 | +12,577（79 个测试文件） |
| SUPER 评分 | 63 → 67（估算） |

---

## 一、各 Phase 完成情况

### Phase 1：后端安全与基础（12/12 完成）

- P0 快速修复：panic→error 迁移、错误码去重、traceId 注入、JSON 统一响应信封、request_id 头、Vite chunk 分包、migration 修复
- P1 日志安全：access_log 移除、`errors.As` 迁移、MCP 错误码标准化、中间件哨兵值
- P1 错误处理：批量 `errors.As` 替换 + 统一错误哨兵
- P2 架构：delta 持久化、EventBus worker pool、TypeScript strict 模式、React Query 精准失效、WebSocket debounce、请求日志
- Icon library 清理：bundle size 优化

### Phase 2：Edge 安全加固（7/7 完成）

- Hub-Edge Outbox：持久化消息投递，指数退避重试，死信队列（599 行实现 + 692 行测试）
- Edge dual-token 能力验证：身份 JWT + 能力 JWT 绑定用户/设备/项目/用途（87 行实现 + 183 行测试）
- Hub 认证身份上下文：类型化 context key 在 Edge 中间件链中传递 Hub 认证信息
- Edge 所有者过滤：`filterProjectsByOwner`、`filterThreadsByOwner`、`filterRunsByOwner`
- 安全钩子优雅降级：regex 校验失败不再 panic，改为 ERROR 日志
- 前端 WS 事件桥：Desktop/Web 端 Hub WS 事件 → React Query 缓存失效

### Phase 3：架构重构（5/5 完成）

- **hub-server/internal/app/app.go 拆解**：976 行单体文件 → 5 个职责聚焦文件
  - `wiring.go`（246 行）：服务构建、DB/Redis 健康检查、HTTP 生命周期
  - `admin.go`（145 行）：pprof/metrics 管理服务器
  - `background.go`（138 行）：后台 goroutine 调度
  - `events.go`（468 行）：WebSocket 事件订阅与推送
  - `router.go`（44 行）：Gin 引擎、中间件链、路由注册

- **hub-server/internal/service/agent_team.go 拆解**：2,242 行 → 8 个职责聚焦文件
  - `agent_team_routing.go`（716 行）：路由决策（delegate/review/approve/compete/finish）
  - `agent_team_run.go`（574 行）：TeamRun 生命周期
  - `agent_team_approval.go`（574 行）：人机协作审批工作流
  - `agent_team_guard.go`（323 行）：护栏（委派深度、子代理上限、路由重复、预算）
  - `agent_team_compete.go`（319 行）：竞态模式并行任务分发
  - `agent_team_review.go`（157 行）：人工审查门
  - `agent_team_crud.go`（139 行）：团队 CRUD
  - `agent_team_member.go`（79 行）：成员管理

- **3 个新增基础设施**：
  - Evidence Gate：运行前预验证（go vet/build/test 或 TS typecheck/lint）
  - Fault Escalation：3 层故障升级链（重试 → AI 审查 → 重新规划）
  - Delivery Outbox：持久化 Hub→Edge 投递

### Phase 4：前端与 Mobile 质量（5/5 完成）

- Web ErrorBoundary 完整实现：错误分类（chunk/network/timeout/unknown）、chunk 加载自动恢复、lucide-react 图标、i18n、CSS Module 主题 token
- Mobile 单元测试：chat（722 行）、workbench-surface（675 行）、tasks（639 行）、account（590 行）、threads（496 行）
- Mobile E2E 测试：auth（261 行）、chat（293 行）、threads（238 行）、settings（230 行）、workbench（190 行）、tasks（177 行）
- Mobile CI 步骤：typecheck、lint、test、E2E-mock-hub（全部加入 checks.yml）
- React Query 缓存管理：集中化 queryKeys 工厂（188 行）+ 3 个事件桥 store（hubEventBridge 421 行、edgeEventBridge 260 行、wsEventBridge 399 行）

### Phase 5：文档、平台与打磨（完成）

- 新增 `docs/api-reference.md`（2,041 行完整 API 参考）
- 新增 5 份 ADR（ADR-013 至 ADR-017）
- 新增治理文档：workflow-standard.md（强制五阶段工作流）
- 新增分析文档：project-overview、module-inventory、risk-assessment
- 新增计划文档：task-breakdown、dependency-graph、milestones
- 新增 8 个验证脚本（verify-release-gate、verify-ci-gates、verify-oidc-readiness、verify-p0-local-smoke、verify-product-loop-qa、verify-runtime-readiness、verify-tauri-package-readiness、verify-web-hub-boundary）
- 新增 client-smoke.sh、integration-smoke.sh
- release.sh 修复：tag-only push + semver 校验 + clean check + dry-run + 跳过构建/测试/上传
- 公开文档中移除所有 live 主机名、部署路径和 Docker 网络名
- 移除 tracked runtime/generated files（css-audit-results.json、edge.db-shm、edge.db-wal、hub-server/server-hub）
- 版本元数据全部对齐到 0.5.0
- 清理 AI 腔（闭环/落地/收口/赋能/production ready）

---

## 二、关键架构变更

### 2.1 模块拆解

| 原文件 | 原大小 | 拆解后 |
|---|---|---|
| `hub-server/internal/app/app.go` | 976 行 | 5 文件：wiring / admin / background / events / router |
| `hub-server/internal/service/agent_team.go` | 2,242 行 | 8 文件：routing / run / approval / guard / compete / review / crud / member |

### 2.2 新增基础设施

| 组件 | 文件 | 行数 | 测试 | 用途 |
|---|---|---|---|---|
| Delivery Outbox | `hub-server/.../delivery_outbox.go` | 599 | 692 行 | 持久化 Hub→Edge 消息投递，退避重试，死信队列 |
| Evidence Gate | `edge-server/.../evidence_gate.go` | 285 | 519 行 | 运行前预验证，阻止破损提交 |
| Fault Escalation | `edge-server/.../fault_escalation.go` | 125 | — | 3 层故障升级：重试 → AI 审查 → 重新规划 |
| JWT KeyManager | `hub-server/.../jwtutil/jwt.go` | +272 | 341 行 | 多密钥轮换，kid 头，线程安全 |
| Edge Capability Token | `edge-server/.../jwtutil/capability.go` | 87 | 183 行 | 双令牌（身份 + 能力）绑定用户/设备/项目 |
| React Query key factory | `app/shared/.../queryKeys.ts` | 188 | — | 集中化缓存键管理 |
| Hub Event Bridge | `app/desktop/.../hubEventBridge.ts` | 474 | — | Hub WS 事件 → React Query 缓存失效 |
| Edge Event Bridge | `app/desktop/.../edgeEventBridge.ts` | 260 | — | Edge WS 事件 → React Query 缓存失效 |
| Web WS Event Bridge | `app/web/.../wsEventBridge.ts` | 451 | — | Web 端 Hub WS 事件 → 缓存失效 |

### 2.3 事件系统升级

- EventBus 从简单 pub/sub → worker pool 模式（并发安全）
- Hub Server events.go 重构：33 个事件类型的 WebSocket 推送订阅
- 前端事件类型定义集中化（`app/shared/src/events.ts`，213 行）
- WS 重连回放测试（`ws_reconnect_replay_test.go`，483 行）

---

## 三、安全修复（17 项）

| # | 修复项 | 严重度 | 文件 |
|---|---|---|---|
| 1 | CustomRecovery 中间件 — 结构化 slog 日志，不泄露 panic 文本，断管检测，trace ID | HIGH | `hub-server/.../recovery.go` (103 行) + test (283 行) |
| 2 | 速率限制 fail-open/fail-closed — 认证路径始终 fail-closed | HIGH | `rate_limit.go`, `global_rate_limit.go` |
| 3 | 速率限制原子化 member ID — 防止 ~15.6ms Windows 定时器精度下 ZSET 碰撞 | MEDIUM | `rate_limit.go:21` |
| 4 | JWT KeyManager 多密钥轮换 — `kid` 头，线程安全，不对外暴露 JWKS | HIGH | `jwtutil/jwt.go` (+272) + test (341 行) |
| 5 | Edge 范围 JWT 令牌 — `SignEdgeToken` with `agenthub-edge` audience | HIGH | `jwtutil/jwt.go:41` |
| 6 | Edge 双令牌能力验证 — 身份 JWT + 能力 JWT 绑定 | HIGH | `jwtutil/capability.go` (87 行) + test (183 行) |
| 7 | Hub 认证身份上下文 — 类型化 context key | MEDIUM | `edgeidentity/context.go` (34 行) |
| 8 | OIDC redirect_uri 纵深防御 — allowlist 验证，fragment 拒绝，scheme 强制 | HIGH | `handler/oidc.go` (+142) + test (273 行) |
| 9 | CORS 环境变量解析 — 配置管理而非直接读取环境变量 | MEDIUM | `middleware/cors.go` (+25) |
| 10 | Edge 所有者过滤 — `filterProjectsByOwner` 等 | HIGH | `api/handlers.go` (+205) |
| 11 | Admin 服务器 BasicAuth — pprof/metrics 受保护 | HIGH | `app/admin.go` (145 行) |
| 12 | Config dump 密钥脱敏 — `/debug/config` 输出中全部 secret 掩码 | MEDIUM | `app/admin.go:89-94` |
| 13 | Edge 安全钩子优雅降级 — regex 校验失败不再 panic | MEDIUM | `adapters/security_hooks.go` (+57) |
| 14 | Evidence Gate — go vet/build/test 或 TS typecheck/lint 预验证 | MEDIUM | `lifecycle/evidence_gate.go` (285 行) + test (519 行) |
| 15 | Fault Escalation — 3 层故障升级，可配置深度/超时 | MEDIUM | `lifecycle/fault_escalation.go` (125 行) |
| 16 | Delivery Outbox — 持久化 Hub→Edge 消息投递 | HIGH | `service/delivery_outbox.go` (599 行) + test (692 行) |
| 17 | CORS 初始化返回 error 替代 panic | LOW | `router/router.go:23` |

### 安全扫描结果

- 硬编码密钥扫描：**0 个生产环境泄露**（全部 grep 命中均为测试 fixture，使用显式命名常量如 `testCapSecret`、`bench-test-secret`）
- 冲突标记：**0**
- TODO/FIXME/HACK/XXX：**0**
- 非 UTF-8 文件：**0**
- 二进制文件：**0**

---

## 四、测试结果

### 4.1 后端测试

| 模块 | 状态 | 包数 | 备注 |
|---|---|---|---|
| `hub-server` (Go) | ✅ 全部通过 | 14 packages | `go test ./... -short -count=1` |
| `edge-server` (Go) | ✅ 全部通过 | 14 packages | 1 包无测试文件 |

### 4.2 前端测试

| 模块 | typecheck | 测试 | 备注 |
|---|---|---|---|
| `app/desktop` | ✅ 通过 | ⚠️ 144/150 文件通过 | 6 文件因 `@lobehub/fluent-emoji` ESM 导入失败（所有独立测试通过） |
| `app/web` | ✅ 通过 | ⚠️ 18/21 文件通过 | 3 文件同上 ESM 问题 |
| `app/mobile-rn` | ❌ 失败 | — | `exactOptionalPropertyTypes` 导致 3 errors |

### 4.3 新增测试覆盖

| 类别 | 文件数 | 新增行 |
|---|---|---|
| Go 测试 | 44 | +9,337 |
| TS/TSX 测试 | 35 | +3,240 |
| **合计** | **79** | **+12,577** |

### 4.4 治理验证

| 验证项 | 结果 |
|---|---|
| `scripts/verify-tauri-package-readiness.ps1` | ✅ 通过 |
| `scripts/verify-ci-gates.ps1` | ✅ 通过 |
| `bash -n scripts/release.sh` | ✅ 通过 |
| `bash scripts/release.sh 0.5.1-rc.1 --dry-run --skip-tests --skip-build --skip-upload` | ✅ 通过 |
| `api/openapi.yaml` YAML 校验 | ✅ 通过 |
| 版本元数据一致性（全部 0.5.0） | ✅ 通过 |
| Tracked runtime artifacts | ✅ 零 |
| `git diff --check` | ✅ 通过（仅 CRLF 提示） |
| 隐私扫描（hk2/核云/agenthub-net） | ✅ active docs 清零 |

---

## 五、剩余工作

### 5.1 P0 — Release Blockers

| ID | 问题 | 状态 |
|---|---|---|
| AH-SR-035 | 浏览器 OIDC login 真实验证缺失 | Open |
| AH-SR-036 | Desktop login/logout/reconnect 部署证据缺失 | Open |
| AH-SR-037 | Web server-owned session posture 未证明 | Open |
| AH-SR-042 | Mobile development-build auth 证据缺失 | Open |
| AH-SR-045 | Edge 远程读取路由授权过粗 | Open |
| AH-SR-046 | Edge run-start 令牌缺少路由范围绑定 | Open |
| AH-SR-047 | Parent-env `AGENTHUB_*` 白名单过于宽泛 | Open |
| AH-SR-049 | Hub-Edge 投递缺乏端到端持久化合同 | Open |
| — | Tauri 签名/公证/updater 元数据 | Open |
| — | Mobile typecheck `exactOptionalPropertyTypes` 失败 | Open |

### 5.2 P1 — 重要但非阻断

- `@lobehub/fluent-emoji` ESM 导入问题，导致 9 个测试文件失败（Vitest 配置或 mock 修复）
- `api/openapi.yaml` 与 `router.go` 路径/方法差异（5+ 条）
- `router.go:353-356` 缩进不一致（仅样式问题，Go 作用域基于大括号）

### 5.3 P2 — 改进

- 数据库 Schema 外部文档缺失（仅在 migration SQL 中）
- `/debug/panic` 端点：log_level≠debug 时无害，但缺少生产配置中的可达性集成测试
- 2 处行尾空格（文档）+ 2 处文件末尾空行（Go 文件）——纯样式问题
- `app/mobile-rn/playwright.config.ts` 已新增但 CI workflow 中 mobile E2E 步骤未完全激活

### 5.4 建议合并前操作

1. 修复 `router.go:353-356` 缩进（一个额外 tab）
2. 运行完整测试套件：
   - `hub-server: go test ./... -short -count=1`
   - `edge-server: go test ./... -short -count=1`
   - `app/desktop: pnpm typecheck && pnpm test`
   - `app/web: pnpm typecheck && pnpm test`
3. 修复 Mobile `exactOptionalPropertyTypes` 问题（3 errors）——当前唯一 CI gate 失败项
4. 修复 `@lobehub/fluent-emoji` ESM 导入恢复 9 个失败测试文件
5. 声明生产就绪前处理 P0 Open High 风险（AH-SR-035/036/037/042/045/046/047/049）

---

## 六、与上一次审计的交叉验证

来自 `docs/audit/comprehensive-audit-2026-06-17.md`（69 项 Open）：

| 原审计 ID | 当前状态 |
|---|---|
| P0-1 Redis password leak in healthcheck | ✅ 已修复 |
| P0-2 Hardcoded dev_password in config.docker.yaml | ✅ 已修复（文件已删除） |
| P0-4 No ErrorBoundary on root workbench | ⚠️ Desktop 有，Web 本轮已加 ErrorBoundary |
| P0-5 HubClient no timeout/AbortController | ❌ 仍 Open（P1 项） |
| P0-6 Unhandled promise rejections | 🔄 涉及文件路径已变更，需重新评估 |
| P1-1 hk2/prod docker-compose near-duplicates | ✅ hk2→us1 重命名，us1 header 已清理 |
| P1-11 No automated CVE scanning in CI | ✅ CI 已有 govulncheck（hard block）+ gosec（warning） |
| P1-12 Zero screen-level rendering tests for mobile | ⚠️ 本轮新增 3,122 行单元测试 + 1,189 行 E2E，但仍需更多覆盖 |

---

## 七、新增文件速览

| 文件 | 行数 | 用途 |
|---|---|---|
| `docs/api-reference.md` | 2,041 | 完整 API 参考（新增） |
| `docs/governance/workflow-standard.md` | 53 | 强制五阶段工作流标准 |
| `docs/plan/dependency-graph.md` | 198 | 模块依赖图 |
| `docs/plan/task-breakdown.md` | 180 | SUPER Phase 1 任务分解 |
| `docs/plan/milestones.md` | 95 | 里程碑定义 |
| `docs/analysis/module-inventory.md` | 89 | 模块清单分析 |
| `docs/analysis/risk-assessment.md` | 175 | 风险评估分析 |
| `docs/adr/ADR-013-app-go-split.md` | 77 | ADR: app.go 拆解 |
| `docs/adr/ADR-014-agent-team-go-split.md` | 84 | ADR: agent_team.go 拆解 |
| `docs/adr/ADR-015-circular-refs-elimination.md` | 125 | ADR: 循环引用消除 |
| `docs/adr/ADR-016-hub-edge-outbox.md` | 127 | ADR: Hub→Edge delivery outbox |
| `docs/adr/ADR-017-edge-dual-token.md` | 125 | ADR: Edge 双令牌认证 |
| 8 个 `scripts/verify-*` 脚本 | ~2,000 | 验证管线：release gate、CI gates、OIDC、P0 smoke、QA、runtime、Tauri、web/hub 边界 |
