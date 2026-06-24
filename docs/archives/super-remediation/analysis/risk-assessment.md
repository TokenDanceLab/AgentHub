# AgentHub 风险评估 — S.U.P.E.R 架构健康总结

> 生成日期：2026-06-19 | Phase 1 分析 | Spec-Driven Develop

## 1. 风险矩阵

| ID | 类别 | 严重度 | 影响 | 可能性 | 修复复杂度 | 状态 |
|---|---|---|---|---|---|---|
| AH-SR-035 | 安全 | **P0** | 无浏览器 OIDC 登录 live 证据 | 高 | M | Open |
| AH-SR-036 | 安全 | **P0** | Desktop login/logout 有代码无部署证据 | 高 | M | Open |
| AH-SR-037 | 安全 | **P0** | Web sessionStorage token，无 BFF/HttpOnly | 高 | XL | Open |
| AH-SR-042 | 安全 | **P0** | Mobile 缺设备证明、无 dev-build 证据 | 高 | L | Open |
| AH-SR-045 | 安全 | **P0** | Edge 远程读路由缺细粒度授权 | 高 | L | Open |
| AH-SR-046 | 安全 | **P0** | Edge run-start 信任单一 API token | 高 | XL | Open |
| AH-SR-047 | 安全 | **P0** | Edge 子进程 env 使用宽泛 AGENTHUB_* whitelist | 中 | M | Open |
| AH-SR-049 | 可靠性 | **P0** | Hub-Edge 交付缺 outbox/journal；回调 fire-and-forget | 中 | XL | Open |
| AH-SR-048 | 安全 | P1 | 子进程 args 已脱敏但 runtime log 验证未完成 | 中 | M | 已缓解（需验证） |
| dev 落后 master | 治理 | **P0** | dev/delicious233 落后 master 15 提交 | 已确认 | S | Open |
| Mobile typecheck | 质量 | **P0** | exactOptionalPropertyTypes 3 个 tsc 错误 | 已确认 | S | Open |
| **Hub 无 Gin recovery 中间件** | 可靠性 | **P0** | `app.go:399` 使用 `gin.New()` 未注册 `gin.Recovery()`，handler panic 会崩溃进程 | 已确认 | S | **新发现** |
| ESM import | 质量 | P1 | 9 test files 因 @lobehub/fluent-emoji ESM 失败 | 已确认 | M | Open |
| HubClient 无 timeout | 质量 | P1 | hubClient.ts 缺 AbortController | 已确认 | S | Open |
| Web 无 ErrorBoundary | 可靠性 | P1 | main.tsx 直接 render App，无错误边界 | 已确认 | S | Open |
| API doc 不匹配 | 治理 | P2 | openapi.yaml 5+ 路径与 router.go 不一致 | 已确认 | M | Open |
| WS 事件数错误 | 治理 | P2 | 架构文档已更新为 33 个事件（与 frame.go 33 个常量一致） | 已修复 | S | Closed |
| 阶段命名矛盾 | 治理 | P2 | AGENTS.md/contributing.md 已统一使用 Phase 1-7，旧 Phase A/B/C/D 引用已清理 | 已修复 | S | Closed |
| release.sh 回归 | 治理 | P2 | 从 ~550 行回退到 352 行 | 已确认 | M | Open |
| Mobile screen tests | 质量 | P2 | 3,864 行源码零渲染测试 | 高 | L | Open |
| AH-SR-043 | 质量 | P1 | Web preview/mock 与生产 UI 共享路径 | 中 | M | Open |
| AH-SR-044 | 质量 | P1 | Runner 兼容性 health 泄漏到 UI | 中 | M | Open |
| PGX CVE | 安全 | P3 | pgx v5.9.2 内存安全漏洞，等上游修复 | 低 | S | 上游阻塞 |
| Edge security_hooks panic | 可靠性 | P1 | `security_hooks.go:345,357` 正则失败时 `panic()` 应改为返回错误 | 已确认 | S | **新发现** |
| io.ReadAll 静默丢弃错误 | 质量 | P3 | 6 处 `io.ReadAll` 返回 error 被丢弃 | 已确认 | S | **新发现** |
| 签名证书 | 可靠性 | **P0** | 无代码签名证书，Tauri 包未签名 | 已确认 | XL | Open |

**P0 数量: 11 项**（8 Open High 安全 + dev/master 差距 + Mobile typecheck + 签名证书）。全部阻断发布。

---

## 2. 测试覆盖评估

### Hub Server
- 131 Go 源文件，CI 强制 40% 最低覆盖率
- 所有包级别有测试：handler (27)、service (20+)、repository (15+)、middleware (12)、model、config、jwtutil、ws、cache
- 集成测试：~15 文件（oidc_e2e、edge_callback_security、message_pin_security、multi_device_auth、attachment_sharing、teamrun_smoke）
- **缺口**：CI 用 `-short` 跳过真实 Postgres/Redis 的 E2E

### Edge Server
- CI 强制 75% 最低覆盖率
- 核心包全测：lifecycle、adapters、store、api、events、security、jwtutil
- **缺口**：Adapter E2E 需真实 CLI 二进制（`-short` 模式跳过）

### Desktop
- ~70 test files，E2E: events、health、runners、oidc、smoke、teamrun
- **6 文件因 ESM import 失败**（独立测试全通过）
- 无强制覆盖率阈值

### Web
- 21 test files（18 pass、3 ESM 失败）
- **关键缺口**：root ErrorBoundary 缺失
- E2E: oidc-login、task-contract、web-hub-real-mode-smoke

### Mobile
- 20 test files
- **关键缺口**：3,864 行源码零 screen-level 渲染测试
- typecheck 失败（exactOptionalPropertyTypes × 3 errors）

### Shared
- ~45 test files，chatview pipeline、transcript normalization、35+ 组件全测

### 零测试覆盖的关键路径

1. Web root rendering（无 ErrorBoundary 测试）
2. Mobile screen-level rendering
3. `scripts/release.sh` 无自动测试
4. Docker/部署配置测试
5. Tauri native Rust 代码测试

---

## 3. 复杂度热点

| 文件 | 行数 | 风险 |
|---|---|---|
| `hub-server/internal/service/agent_team.go` | 2,313 | 81 函数、委托树、循环检测——修改风险最高 |
| `edge-server/internal/api/handlers.go` | 2,195 | 所有 Edge REST 端点、安全强制执行点 |
| `edge-server/internal/lifecycle/process_executor.go` | 1,852 | 15 字段、9 内部 map、fire-and-forget 回调 |
| `hub-server/internal/app/app.go` | 1,080 | DI 单体、30+ WS 订阅内联、sensitive middleware setup |
| `edge-server/internal/adapters/orchestrator.go` | 935 | DAG 路由、failure modes |

---

## 4. 治理缺口

### 指令面状态

| 面 | 路径 | 状态 |
|---|---|---|
| AGENTS.md | `/AGENTS.md` (468行) | ✅ 活跃，must-read |
| CONTRIBUTING.md | `/CONTRIBUTING.md` (37行) | ⚠️ 过于简短 |
| CONTRIBUTING.md | `/docs/contributing.md` (~750行) | ✅ 详细 |
| STATE.md | `/STATE.md` (239行) | ⚠️ 可能过期 |
| CLAUDE.md | **不存在** | ❌ 缺失——Claude agents 无项目级指令 |
| 项目记忆 | `.agenthub/memory/project.md` (9行) | ❌ 几乎为空 |

### 已确认的规则冲突

1. **阶段命名**: AGENTS.md/contributing.md 已统一使用 Phase 1-7，旧命名矛盾已消除
2. **分支治理**: 规则说 `feat/* → dev/delicious233 → master`，实际 15 个提交直接从 PR 合入 master
3. **开发分支**: AGENTS.md 指定 `dev/delicious233` 为工作分支，当前 checkout 在 `master`
4. **WS 事件计数**: 架构文档 26 vs frame.go 34

### 跨仓库治理

AgentHub 引用 9+ 个跨仓库治理文档（`../docs/identity/`、`../docs/security/`、`../docs/design/`、`../docs/ecosystem/`），覆盖身份认证、授权、安全风险、i18n、设计系统。这是好的实践但增加了 onboarding 复杂度。

---

## 5. S.U.P.E.R 架构健康总结

### S — 单一目的 (3/5)

**Top 3 违规热点**:
1. `agent_team.go` (2,313行) — CRUD+路由+分配+审批+护栏，应拆为 3+ 文件
2. `process_executor.go` (1,852行) — 进程生命周期+输出预算+Hub 回调+子代理跟踪
3. `handlers.go` (2,195行) — 所有 Edge API 端点在一个文件

### U — 单向流 (4/5)

**Top 3 违规热点**:
1. Hub-Edge 回调 fire-and-forget（AH-SR-049）——状态可发散
2. Web sessionStorage token 模式——XSS 可读取
3. Edge 远程模式粗粒度 API 凭证

### P — 端口优先于实现 (3/5)

**Top 3 违规热点**:
1. `AgentTeamService` 直接依赖 `*gorm.DB` + 显式了解 `AgentService`、`cacheClient`、`controlSvc`
2. Handler 层直接调用 service 构造函数
3. `ProcessExecutor` 消费具体 `store.RunLifecycleStore`（15+ 方法暴露，只用到 5-6 个）

### E — 环境无关 (2/5) ← 最低分

**Top 3 违规热点**:
1. Live 主机/路径泄漏到文档中（反复出现）
2. PowerShell 脚本单一文化（55+ .ps1、~6 .sh）
3. E2E smoke/验证框架仅 Windows

### R — 可替换部件 (3/5)

**Top 3 违规热点**:
1. Hub DB 紧耦合 PostgreSQL+Redis（用 GORM 直接操作，无抽象边界）
2. Adapter 注册表通过字符串匹配而非插件加载
3. `store.RunLifecycleStore` 接口本质是 SQLite 特定的

### 总体 S.U.P.E.R 得分: 3.0/5

| 原则 | 得分 | 本次修复优先级 |
|---|---|---|
| S | 3/5 | 修复中（拆分 agent_team.go） |
| U | 4/5 | 修复中（Hub-Edge 交付合约） |
| P | 3/5 | 修复中（窄端口接口） |
| E | **2/5** | 修复中（文档清理、bash 等价版） |
| R | 3/5 | 延后（数据库耦合为接受风险） |

---

## 修复优先级矩阵

| 时机 | 内容 | 预估工作量 |
|---|---|---|
| **即刻 (P0)** | AH-SR-035/036（OIDC 证据）、AH-SR-045/046（Edge 远程认证）、AH-SR-049（Hub-Edge 交付）、同步 dev、修复 Mobile typecheck | XL |
| **本轮 (P1)** | 修复 release.sh 回归、给 Web main.tsx 加 ErrorBoundary、给 HubClient 加 AbortController、拆分 agent_team.go、提取 ProcessExecutor 窄端口、修复 ESM import | M |
| **下一轮 (P2)** | 修复 API doc 路径不匹配、修复架构文档 WS 事件数、统一阶段命名、补 bash 等价验证脚本、外部 DB schema 文档 | M |
| **延后** | Web BFF/HttpOnly session（AH-SR-037）、Mobile screen-level tests、handlers.go 拆分、Store 接口泛化、CVE 依赖升级（等上游） | L-XL |
