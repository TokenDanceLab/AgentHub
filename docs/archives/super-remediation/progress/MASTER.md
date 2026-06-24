# AgentHub SUPER 修复 — MASTER.md

> 最后更新：2026-06-24
> 追踪模式：**GITHUB_STANDARD**（Issues + Milestones + Labels）
> 仓库：`TokenDanceLab/AgentHub`

## 任务概述

基于 [SUPER 工程审计](../governance/super-score-2026-06-19.md)（基线 63/100）的全面修复计划。

**全部完成。已合并到 master（PR #316 + #317）。产物归档到 `docs/archives/super-remediation/`。**

## CI 修复（v0.5.1, 2026-06-24）

SUPER 合并后 CI 遗留问题修复。详见 `docs/analysis/ci-remediation-analysis.md`。

| 模块 | 修复项 | 数量 | 状态 |
|---|---|---|---|
| Go edge | unparam + coverage tests | 4 + 6 files | ✅ |
| Go hub | errcheck + gocognit + ws nil guard | 25+ + 3 + 20 tests | ✅ |
| Web | lint unused-vars + TS build | 6 + 2 | ✅ |
| Desktop | lint unused-vars/escape | 8 | ✅ |
| Mobile | lint/typecheck + fixture | 16 + 1 | ✅ |
| Infra | Docker + golangci.yml | 3 | ✅ |

### CI 最终状态

| 作业 | 状态 |
|---|---|
| 全模块 lint/typecheck | ✅ 0 errors |
| 全模块 vuln scan | ✅ |
| go-hub test | ✅ |
| Backend focused subset | ✅ |
| Cross-platform | ✅ |
| Docker | ✅ |
| go-edge coverage | ⚠️ 65.8% (< 75%) |
| E2E/Smoke | ⚠️ 预存（需基础设施） |

## 治理清理

- 删除 `feat/glm-frontend-integration`
- 放弃 macOS
- 分支治理更新：`dev/delicious223`→`dev/delicious233`
- 文档版本 badge：v0.4.0→v0.5.1
> 分支：`feat/super-phase1-safety-foundation`（基于 `dev/delicious233`）

## 任务概述

基于 [SUPER 工程审计](../governance/super-score-2026-06-19.md)（基线 63/100）的全面修复计划。目标：SUPER >=80，release gate 通过。原定 5 个活跃 Phase + 1 个延后 Phase，共 52 个任务。

**状态：全部 Phase 完成。merge to dev 待执行，release gate 仍有阻断项。**

## 分析文档

| 文档 | 路径 |
|---|---|
| 项目概览 | [docs/analysis/project-overview.md](../analysis/project-overview.md) |
| 模块清单（S.U.P.E.R 评分） | [docs/analysis/module-inventory.md](../analysis/module-inventory.md) |
| 风险评估 | [docs/analysis/risk-assessment.md](../analysis/risk-assessment.md) |

## 计划文档

| 文档 | 路径 |
|---|---|
| 任务分解 | [docs/plan/task-breakdown.md](../plan/task-breakdown.md) |
| 依赖图 | [docs/plan/dependency-graph.md](../plan/dependency-graph.md) |
| 里程碑 | [docs/plan/milestones.md](../plan/milestones.md) |

## Phase 进度

| Phase | 名称 | 任务数 | 完成 | GitHub Milestone | 状态 |
|---|---|---|---|---|---|
| Phase 1 | 后端安全与基础 | 12/12 | 100% | M1 | ✅ 完成 |
| Phase 2 | Edge 安全加固 | 7/7 | 100% | M2 | ✅ 完成 |
| Phase 3 | 架构重构 | 5/5 | 100% | M3 | ✅ 完成 |
| Phase 4 | 前端与 Mobile 质量 | 7/7 | 100% | M4 | ✅ 完成 |
| Phase 5 | 文档、平台与打磨 | 17/17 | 100% | M5 | ✅ 完成 |
| Phase 6 | 延后项 | 4/4 | 100% | M6 | ✅ 完成 |

**全部 52 个任务完成。**

## 最终统计

| 指标 | 数值 |
|---|---|
| 分支 | `feat/super-phase1-safety-foundation` |
| 基准分支 | `dev/delicious233` |
| 总提交数（分支） | 2,189 |
| 文件变更 | 200 files（vs origin/dev）；335 files（vs dev/delicious233） |
| 新增行数 | +17,462（vs origin/dev）；+32,547（vs dev/delicious233） |
| 删除行数 | -1,501（vs origin/dev）；-5,723（vs dev/delicious233） |
| 新增 Go 测试行数 | +9,337 |
| 新增 TS/TSX 测试行数 | +3,240 |
| 测试净增 | +12,577 行（79 个文件） |
| 新增验证脚本 | 8 个（`scripts/verify-*.sh`） |
| 新增 ADR | 5 个（ADR-013 ~ ADR-017） |
| 新增 API 参考文档 | `docs/api-reference.md`（2,041 行） |

### 测试通过率

| 套件 | 结果 |
|---|---|
| `hub-server: go test ./... -short -count=1` | ✅ 20/22 packages pass（2 个包各有 1 个 subtest flaky，根因已知） |
| `edge-server: go test ./... -short -count=1` | ✅ 全部通过（14 packages） |
| `app/desktop: pnpm typecheck` | ✅ 通过 |
| `app/web: pnpm typecheck` | ✅ 通过 |
| `app/mobile-rn: npx tsc --noEmit` | ❌ 失败（exactOptionalPropertyTypes，3 errors） |
| `app/desktop: pnpm test` | ⚠️ 144/150 files pass，6 fail（ESM import） |
| `app/web: pnpm test` | ⚠️ 18/21 files pass，3 fail（ESM import） |
| `api/openapi.yaml` YAML 校验 | ✅ 通过 |
| 版本元数据一致性（全部 0.5.0） | ✅ 通过 |

## 当前 SUPER 评分估算

基线：63/100（`super-score-2026-06-19.md`）→ 最新估算：**~67/100**

| 维度 | 基线 | 变化 | 当前 | 主要驱动 |
|---|---|---|---|---|
| S (Safety) | 60 | +8 | **68** | CustomRecovery、rate-limit fail-open/fail-closed、JWT KeyManager 轮转、Edge dual-token、OIDC defense-in-depth、Delivery Outbox 持久化、Edge owner filtering、Admin secret redaction |
| U (User delivery) | 63 | +3 | **66** | Web ErrorBoundary（分类/chunk-reload/i18n）、Mobile E2E 1,189 行、Mobile 单元测试 3,122 行 |
| P (Process/Packaging) | 70 | +1 | **71** | release.sh 确认为 505 行 tag-only push、CI 分支清理、版本一致性验证通过 |
| E (Engineering) | 70 | +5 | **75** | 架构分解（app.go 976行→5文件、agent_team.go 2242行→8文件）、Evidence Gate 519行测试、Fault Escalation、Delivery Outbox 692行测试、Mobile CI 四步骤、queryKeys 集中化 |
| R (Release/Reliability) | 49 | +4 | **53** | CustomRecovery 防 crash 泄露、rate-limit fail-open 防级联 503、Evidence Gate 预检拦截、Delivery Outbox Hub→Edge 持久化 |
| **总分** | **63** | | **~67** | |

比赛口径粗算约 70/100。release gate 仍是主阻断项（8 Open High + signing/notarization/updater），解决后 SUPER 有望冲击 75-80。

## 当前状态

**阶段**: 全部 Phase 完成，进入合并前最终验证。
**活跃分支**: `feat/super-phase1-safety-foundation`
**目标分支**: `dev/delicious233`（merge to dev）

### 已交付的关键成果

- **安全加固（17 项）**: CustomRecovery 中间件、rate-limit fail-open/fail-closed、JWT KeyManager 多密钥轮转、Edge dual-token capability、OIDC redirect_uri defense-in-depth、Delivery Outbox Hub→Edge 持久化、Edge owner-based filtering、Admin server BasicAuth + secret redaction、CORS 配置化、config dump secret 脱敏
- **架构重构**: `hub-server/internal/app/app.go`（976行→5文件）、`hub-server/internal/service/agent_team.go`（2242行→8文件）、Delivery Outbox 基础设施（599行 + 692行测试）
- **可靠性**: Evidence Gate（285行 + 519行测试）、Fault Escalation 三层链（retry→AI review→replan）、8 个验证脚本（verify-release-gate、verify-ci-gates、verify-oidc-readiness 等）
- **文档**: API 参考（2,041行）、5 个 ADR（013-017）、Workflow 标准化规范、任务分解/依赖图/里程碑
- **测试**: +12,577 行测试（Go +9,337、TS/TSX +3,240）、79 个测试文件、Mobile CI 四步骤

## 快速状态命令

```bash
gh issue list --repo TokenDanceLab/AgentHub --label "spec-driven"
gh issue list --repo TokenDanceLab/AgentHub --milestone "Phase 1"
rg -n "Open.*High" docs/governance/security-risk-register.md
powershell -NoProfile -File scripts/verify-release-gate.ps1 -RepoRoot . -SkipRefCheck
```

## 下一步

1. **合并到 dev**：从 `feat/super-phase1-safety-foundation` 创建 PR 合并到 `dev/delicious233`，跑全量 CI。
2. **Release gate 解除**：逐项修复 8 个 Open High 安全风险（AH-SR-035/036/037/042/045/046/047/049）+ signing/notarization/updater，目标 `verify-release-gate.ps1` 全绿。
3. **Mobile typecheck 修复**：解决 `exactOptionalPropertyTypes` 3 个错误，打通 `mobile-typecheck` CI step。
4. **ESM 导入修复**：修 Vitest 配置或 mock `@lobehub/fluent-emoji`，恢复 9 个前端测试文件。
5. **OIDC/Desktop/Mobile live 验证**：私有运维记录保存脱敏 endpoint 标识、callback 注册证明、session 签发结果和已去敏截图。
6. **Tauri 完整 build 证明**：跑完整 Tauri build/package，公开仓写无密结论。
7. **Release gate 通过后打标**：`v0.5.0` 正式打标，release gate 全绿后合并 `dev/delicious233` → `master`。

## 治理状态

| 面 | 路径 | 状态 |
|---|---|---|
| AGENTS.md | `/AGENTS.md` (468行) | ✅ 活跃，需在 merge 后更新 |
| CLAUDE.md | 不存在 | ❌ 待创建 |
| 项目记忆 | `.agenthub/memory/project.md` (9行) | ❌ 待填充 |
| 验证报告 | `docs/governance/verification-report-2026-06-19.md` (145行) | ✅ 交叉审查通过 |
| 验证状态 | `docs/governance/verification-status-2026-06-19.md` (277行) | ✅ 最终交叉审查结论：高质量 diff，3 处修正 |
| Workflow 标准 | `docs/governance/workflow-standard.md` (53行) | ✅ 强制五阶段模板 |
| 安全风险登记册 | `docs/governance/security-risk-register.md` | ⚠️ 仍有 8 个 Open High |
