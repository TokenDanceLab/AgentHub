# AgentHub 验证报告 — 2026-06-19

**分支**: `feat/super-phase1-safety-foundation`
**基准**: `dev/delicious233`
**范围**: 全仓（hub-server / edge-server / app / docs / scripts）
**验证日期**: 2026-06-19

---

## 1. 总评: WARN

| 维度 | 结果 | 说明 |
|------|------|------|
| 构建 | **PASS** | hub-server + edge-server `go build ./...` 零错误 |
| 测试 (hub-server) | **FAIL** | 18 包中 2 失败，6 个测试——全部是 sqlmock 参数漂移，无逻辑错误 |
| 测试 (edge-server) | **PASS** | 22 包全部通过，零失败 |
| 前端类型检查 | **FAIL** | web（`shared/src/workbenchState.ts` 联合类型缩窄问题）+ mobile-rn（测试文件 strict null 违规） |
| Vet/Lint | **FAIL** | edge-server `mock_executor_test.go` 重复方法定义 `SetRunRetryCount` |
| 隐私/密钥扫描 | **WARN** | 无真实密钥泄露。活跃文档中残留 hk2/核云/agenthub-net 主机名 ~50 处；AI 写作模式 ~20 处（闭环 12、收口 5、落地 3）。`super-score` 声称"清零"不准确 |
| 安全审查 | **FAIL** | 1 个 CRITICAL（两个端点未注册认证中间件）+ 1 个 MEDIUM + 2 个 LOW。另有 11 项安全改进 |
| Diff 卫生 | **PASS** | 仅 2 处 EOF 空行 + 1 处尾部空格，无冲突标记、无二进制、无非 UTF-8 |
| 完整性审计 | **FAIL** | P0 5 项中 1 项部分修复、4 项未处理；P2 2 项未处理；新增 Fault Escalation 无专属测试文件 |

**判定**: 存在一个 CRITICAL 安全缺陷（未认证端点）+ 4 项 P0 未闭合 + 测试/前端编译未全绿 → **不能合并，不能发布**。

---

## 2. SUPER 评分估算

以 `super-score-2026-06-19.md` 审计基准，按完成度加权：

| 优先级 | 项目数 | 已完成 | 部分完成 | 未完成 | 得分率 |
|--------|--------|--------|----------|--------|--------|
| P0（发布阻断） | 5 | 0 | 1 | 4 | **8%** |
| P1（高优先级） | 7 | 7 | 0 | 0 | **100%** |
| P2（中优先级） | 9 | 6 | 1 | 2 | **72%** |
| 新增特性 | 4 | 3（含测试） | 0 | 1（Fault Escalation 无测试） | **75%** |
| 安全（扣分项） | — | — | — | 1 CRITICAL 未认证端点 | **-8** |

**加权估算**: P0×0.40 + P1×0.30 + P2×0.15 + 新增×0.10 + 安全修正 =  
0.032 + 0.30 + 0.108 + 0.075 − 0.08 = **0.435 → 估计 44/100**

> 注：P0 的高权重（40%）直接拉低了总分。即使 P1 全部完成、P2 基本完成，只要 P0 未闭合，分数不可能超过 60。上次审计时估算基准约 35/100，本次分支 P1 全部修复 + 新增 3 个有测试的特性是实质进展，但 P0 停滞导致总分提升有限。

**上次审计估算**: ~35/100  
**本次估算**: ~44/100（+9 分，主要来自 P1 清零和新增特性）

---

## 3. 发布就绪判定: **不可发布**

| 阻断项 | 严重度 | 详情 |
|--------|--------|------|
| 未认证端点 | **CRITICAL** | `/client/team-runs/:id/compete-summary` 和 `/client/team-runs/:id/review-decision` 注册在无 `AuthMiddleware` 的 `client` 路由组上。任何无 Bearer token 的请求均可访问。修复：迁至 `web` 路由组 |
| Release gate 8 项 Open High SR 未闭合 | **P0** | AH-SR-035/036/037/042/045/046/047/049 + 签名/公证/更新器元数据 |
| dev 落后 master 15 commits | **P0** | `origin/dev/delicious233..origin/master` = 15 commits，未合并未变基 |
| Mobile 类型检查失败 | **P0** | `exactOptionalPropertyTypes` 仍为 true，`npx tsc --noEmit` 仍有 TS2532/TS2322 错误 |
| 真实登录/客户端验证不足 | **P0** | 无 OIDC 浏览器流、Desktop 登录/登出、Mobile dev build、Remote Edge auth 的实机验证记录 |
| Windows 签名包缺失 | **P0** | 无完整 Tauri build/package 产物或安装验证 |
| hub-server 测试未全绿 | **阻断** | 2 包 6 测试失败（sqlmock 参数漂移，修复简单但必须先修） |
| edge-server vet 失败 | **阻断** | 重复方法 `SetRunRetryCount`，必须先删重复定义 |

---

## 4. 剩余工作（合并前必须完成）

### 4.1 立即修复（阻断合并）

| # | 项 | 文件 | 工作量 |
|---|-----|------|--------|
| 1 | **CRITICAL**: 两个 `/client/team-runs/...` 路由迁至 `web` 路由组 | `hub-server/internal/router/router.go:353-356` | 5 分钟 |
| 2 | 删除重复的 `SetRunRetryCount` 方法 | `edge-server/internal/lifecycle/mock_executor_test.go:83-88` | 1 分钟 |
| 3 | 更新 6 个 sqlmock `WithArgs` 以匹配新增的 `LIMIT` 参数 | `hub-server/internal/service/session_test.go`、`message_test.go` | 15 分钟 |
| 4 | 更新 `ValidActions` 测试期望值（加 `"compete"`） | `hub-server/internal/model/model_test.go:738` | 2 分钟 |

### 4.2 P0 闭合（发布前必须完成）

| # | 项 | 说明 |
|---|-----|------|
| 5 | **Release gate 闭环** | 逐个关闭 8 项 Open High SR，验证 `verify-release-gate.ps1` 全绿 |
| 6 | **dev←master 同步** | 变基或合并 master 的 15 个 commits 到 dev |
| 7 | **Mobile 类型检查修复** | 关闭 `exactOptionalPropertyTypes` 或修复所有 TS2532/TS2322 错误 |
| 8 | **实机验证记录** | 在私有运维 SSOT 中记录 OIDC 登录、Desktop 登录/登出、Mobile dev build、Remote Edge auth 的通过记录 |
| 9 | **Windows 签名包** | 完整 Tauri build + 签名 + 安装验证，产物归档 |

### 4.3 P2 收尾

| # | 项 | 说明 |
|---|-----|------|
| 10 | **ESM 测试修复** | `@lobehub/fluent-emoji` 导致 9 个测试文件失败——vitest config 中补充 mock |
| 11 | **OpenAPI 同步** | `api/openapi.yaml` 中 47 个 `planned` 标记与实际 `router.go` 对齐 |

### 4.4 新增特性补测

| # | 项 | 说明 |
|---|-----|------|
| 12 | **Fault Escalation 测试** | 创建 `fault_escalation_test.go`，覆盖 3 层链路（retry→review→replan）、`FaultEscalationConfigFromEnv`、`ShouldRetry`/`ShouldEscalateToReview`/`NextEscalationPhase`、`EscalationState` 状态转换 |

### 4.5 文档清理（建议在合并前完成）

| # | 项 | 说明 |
|---|-----|------|
| 13 | 活跃文档中 hk2/核云/agenthub-net 脱敏 | `docs/roadmap.md`、`docs/architecture/05-deployment.md`、`app/shared/src/demo/chatviewFixtures.ts:809` 等 |
| 14 | AI 写作模式清理 | `STATE.md`、`AGENTS.md`、`edge-server/README.md`、`docs/roadmap.md`、`docs/governance/` 中 ~20 处"闭环/收口/落地" |

---

## 5. 本分支已完成的正面成果

以下成果已确认有效，合并后不应回退：

| 成果 | 验证状态 |
|------|----------|
| P1-3 `release.sh` 恢复（505 行，tag-only push，semver 校验，badge bump） | ✅ 已验证 |
| P1-6 HubClient timeout/AbortController（3 个文件） | ✅ 已验证 |
| P1-7 Web ErrorBoundary | ✅ 已验证 |
| Evidence Gate（实现 285 行 + 测试 519 行） | ✅ 已测试 |
| COMPETE Mode（实现 319 行 + 3 个测试函数） | ✅ 已测试 |
| Human Review Gate（实现 157 行 + 7 个子测试） | ✅ 已测试 |
| JWT KeyManager 多密钥轮转 | ✅ 已实现 |
| 双令牌 Edge 认证（身份 JWT + 能力令牌） | ✅ 已实现 |
| CustomRecovery 中间件（不泄露 panic 文本） | ✅ 已实现 |
| OIDC redirect_uri 深度防御 | ✅ 已实现 |
| WebSocket origin 收紧 | ✅ 已实现 |
| Admin 配置输出密钥脱敏 | ✅ 已实现 |
| strict AGENTHUB_* 环境变量白名单 | ✅ 已实现 |
| 11 项安全改进 | ✅ 已验证 |

---

## 6. 建议操作顺序

```
1. 修复 4.1 节 4 项立即修复（预计 25 分钟）
2. 重新运行全量测试 + vet + typecheck，确认全绿
3. 修复 CRITICAL 安全缺陷后重新安全审查
4. 按 4.2 节逐项闭合 P0（预计 2-3 天）
5. P0 全部闭合后再次运行 release gate，确认通过
6. 清理 4.5 节文档问题
7. 合并到 dev，打 tag，发布
```

---

**结论**: 分支在 P1 修复和新增安全特性方面取得了实质进展（+9 SUPER 分），但 CRITICAL 安全缺陷 + P0 停滞意味着当前状态不可合并。先修 4.1 节的 4 个立即修复项（<30 分钟），再逐项推进 P0 闭合，方可达到可发布状态。
