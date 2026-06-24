# AgentHub SUPER 治理关闭报告

最后更新：2026-06-19

本报告对照 `docs/governance/super-score-2026-06-19.md` 的原始发现，逐项审计当前状态（分支 `feat/super-phase1-safety-foundation`，HEAD `0ff0984`），判定关闭/存续/回归。

评分沿用 SUPER 框架（S/U/P/E/R），每项标注原始等级、当前判定、证据摘要。

---

## 关闭（FIXED）

| # | 原等级 | 问题 | 原始状态 | 关闭证据 |
|---|--------|------|----------|----------|
| F1 | P1 | HubClient 无 timeout/AbortController | ❌ Open | `app/desktop/src/api/hubClient.ts` 和 `app/web/src/api/hubClient.ts` 均已添加 `AbortController` + 30s 默认超时，含超时错误封装和重试逻辑。L971-1043（desktop），L880-929（web）。 |
| F2 | P1 | Web `main.tsx` 无 root ErrorBoundary | ⚠️ Desktop 有，Web 无 | `app/web/src/main.tsx` 已 `import ErrorBoundary` 并包裹 `<App />`。L8-14。 |
| F3 | P1 | `scripts/release.sh` 意外回退到 352 行 | 352 行，丢失 tag-only/semver/clean check | 当前 505 行，含 semver 校验、`--dry-run`、`--skip-tests`、`--skip-build`、`--skip-upload`、`git push origin $TAG`（tag-only，不 push master）。`bash -n` 语法检查通过。 |
| F4 | P0 | Mobile verify 失败（exactOptionalPropertyTypes） | ❌ 3 errors | `app/mobile-rn` 的 `npx tsc --noEmit` 退出码 0，通过。tsconfig 仍含 `exactOptionalPropertyTypes: true`，但当前代码无类型错误。 |
| F5 | P2 | Desktop/Web 测试 ESM 导入失败（9 文件） | ⚠️ 6 Desktop + 3 Web fail | Desktop: 149/150 files pass（1 fail 为 DOM query 问题，非 ESM）。Web: 21/21 files pass（130 tests）。ESM 导入问题已全部解决。 |
| F6 | P1 | release shell 脚本原先直接 push master | 已改为 tag-only | `scripts/release.sh` 仅 tag push（`git push origin $TAG`），不再 push 分支。clean check 覆盖 tracked/staged/untracked。 |

---

## 仍存续（STILL OPEN）

| # | 原等级 | 问题 | 当前状态 | 证据 |
|---|--------|------|----------|------|
| O1 | P0 | release gate 不通过 | **仍 BLOCKED** | `scripts/verify-release-gate.ps1 -SkipRefCheck` 报告 3 个 blocker：(1) 8 个 Open High 风险 AH-SR-035/036/037/042/045/046/047/049；(2) signing/notarization 未批准；(3) updater publication 未批准。与原始报告完全一致。 |
| O2 | P0 | dev 分支落后 master | **仍 15 commits behind** | `origin/dev/delicious233..origin/master = 15`，`origin/master..origin/dev/delicious233 = 0`。分支差无变化。 |
| O3 | P0 | 真实登录和客户端发布验证不足 | **仍 Open** | O1 中 AH-SR-035/036/037/042 即为此类。OIDC 浏览器完成路径、Desktop login/logout/reconnect、Web server-owned session、Mobile device proof 均缺 live 记录。 |
| O4 | P0 | Windows unsigned package 证明不足 | **仍 Open** | verify-tauri-package-readiness 的 dry topology 通过，但缺乏完整 Tauri build/package 产物、hash 和安装包记录。 |
| O5 | P1 | version drift — Desktop Cargo.lock | **仍 Open** | `tauri.conf.json` 和 `Cargo.toml` 为 0.4.1，但 `Cargo.lock` 仍为 0.4.0（`version = "0.4.0"`）。其他包（shared/web/mobile-rn/desktop package.json）均为 0.4.1。 |
| O6 | P1 | tracked runtime/generated files | **部分残留** | `hub-server/server-hub` 已从 git index 移除。但 `css-audit-results.json`、`edge-server/edge.db-shm`、`edge-server/edge.db-wal` 仍被 git 追踪（`git ls-files` 可查）。 |
| O7 | P2 | API doc openapi.yaml 与 router.go 不匹配 | **恶化** | 原始报告 5+ 条路径标记 planned 但已实现。当前 openapi.yaml 含 **47 个** "planned" 标记（7513 行总长），大量路径标注 "No corresponding Hub router path exists" 或 "routes from router.go not yet documented"。 |
| O8 | P2 | README_EN.md 版本 badge 仍是 0.4.0 | **未修复** | `README_EN.md` L10：`![version](https://img.shields.io/badge/version-0.4.0-blue...)`。当前实际版本 0.4.1。 |
| O9 | P2 | edge-server README 含"闭环" | **新增一处** | 原始报告那处已改为"完整链路"，但 L107 新增："Remote/Cloud Target 仍需要 Hub 侧 target 注册、路由授权、设备证明和远程审批**闭环**"。 |
| O10 | P3 | 数据库 Schema 无外部文档 | **仍 Open** | 无独立 schema 概览文档。仅 `docs/plan/task-breakdown.md` 标记 T052 为低优先级。 |

---

## 回归（REGRESSION）

| # | 原等级 | 问题 | 原始状态（已修复） | 当前回归证据 |
|---|--------|------|-------------------|-------------|
| R1 | P1 | `verify-tauri-package-readiness.ps1` 读已删除文件 | 原始报告称已改为读 `docs/architecture/05-deployment.md` | 当前 L503 仍引用 `docs\backend-integration-governance.md`，该文件已不存在。多个 verify 脚本（verify-edge-cli-real-readiness、verify-login-fixture-topology、verify-packaged-login-real-readiness、verify-tauri-sidecar-binary-smoke）也仍引用此已删除文件。 |
| R2 | P2 | active docs AI 腔清零 | 原始报告称"active docs 清零" | 当前仍有：(1) `docs/roadmap.md` L1766 "闭环面板"；(2) `docs/roadmap/README.md` L48 "增量补齐闭环"；(3) `docs/governance/threat-model.md` L107 "待闭环项"、L112 "收口"；(4) `docs/governance/security-risk-register.md` L262 "落地"、L267 "落地"；(5) `edge-server/README.md` L107 "闭环"。其中部分为诚实标注（threat model/risk register），部分为新增。 |

---

## 维持已修复（NO CHANGE — REMAINS FIXED）

| # | 原等级 | 问题 | 确认 |
|---|--------|------|------|
| N1 | P1 | docker-compose.us1.yml 残留 live 主机/路径 | 当前 header 无 hk2/核云/agenthub-net 引用。干净。 |
| N2 | P1 | CI 分支 dev/trump 引用 | `.github/workflows/checks.yml` 无 dev/trump。干净。 |
| N3 | P2 | 阶段命名规则自相矛盾 | CONTRIBUTING.md 无 Phase A/B/C/D 引用。干净。 |
| N4 | P2 | 架构文档 WS 事件数不准 | `docs/architecture/01-hub-server.md` 仍记录 33 个事件类型。正确。 |
| N5 | P2 | developer-quickstart 迁移文件数过期 | 50 对→51 对已在 contributing.md 修正。当前无过期引用。 |
| N6 | P2 | docs/roadmap/README.md 标题版本 | 仍为 "AgentHub v0.5.0 Roadmap"。正确。 |
| N7 | — | CI gates | `verify-ci-gates.ps1` 通过。 |
| N8 | — | 版本元数据一致性（大部分） | shared/desktop/web/mobile-rn 均为 0.4.1（除 Cargo.lock）。 |
| N9 | — | Go 后端测试 | hub-server + edge-server go test 全部通过（原始报告确认）。 |
| N10 | — | bash -n scripts/release.sh | 语法检查通过。 |

---

## 交叉验证：与 comprehensive-audit-2026-06-17 对照

| 原审计 ID | 原始状态 | 当前判定 |
|---|---|---|
| P0-1 Redis password leak in healthcheck | ✅ 已修复 | 维持已修复 |
| P0-2 Hardcoded dev_password | ✅ 已修复 | 维持已修复 |
| P0-4 No ErrorBoundary on root workbench | ⚠️ Desktop 有，Web 无 | **✅ 已关闭** — Web 已加 ErrorBoundary（F2） |
| P0-5 HubClient no timeout/AbortController | ❌ Open | **✅ 已关闭** — 均已添加（F1） |
| P0-6 Unhandled promise rejections | 🔄 需重新评估 | 未重新评估，文件路径已变更 |
| P1-1 hk2/prod compose near-duplicates | ✅ hk2→us1 重命名 | 维持已修复 |
| P1-11 No automated CVE scanning in CI | ✅ CI 已有 | 维持已修复 |
| P1-12 Zero screen-level rendering tests for mobile | ❌ Open | 仍 Open（原始 3,864 行零测试，未核实是否改善） |

---

## SUPER 分数变化（估算）

| 项 | 原始 | 当前 | 变化 |
|---|---:|---:|---|
| S | 60 | 60 | 无变化 — 风险登记册 Open High 不变 |
| U | 63 | 65 | Mobile typecheck 通过、Web ErrorBoundary 改善交付完整性 |
| P | 70 | 72 | release.sh 恢复、HubClient timeout、runtime files 部分清理 |
| E | 70 | 73 | 测试 ESM 全部修复（9→1 fail）、Mobile typecheck 通过 |
| R | 49 | 49 | 无变化 — release gate 仍是主要短板 |
| **总分** | **63** | **64** | +1，微幅改善 |

比赛口径粗算约 68 分（+1，来自测试修复和 ErrorBoundary）。

---

## 建议优先级

1. **P0 阻断**：修复 O1（8 Open High）和 O4（Windows package 证明）仍是 release gate 最大瓶颈。
2. **P0 分支**：决定 O2（dev 落后 master 15 commits）的处理策略 — 回灌或评估后废弃。
3. **P1 回归**：修复 R1（verify 脚本引用已删除文件），统一所有 verify 脚本到 `docs/architecture/05-deployment.md`。
4. **P1 残留**：修复 O5（Cargo.lock version drift）和 O6（3 个 runtime files 仍 tracked）。
5. **P2 文档**：修复 O8（README_EN 版本 badge）、O9（edge-server README 新"闭环"）、O7（openapi 同步）。
6. **P3**：补 O10（DB schema 外部文档）。
