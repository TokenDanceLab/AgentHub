> ⚠️ 已归档：Round 6 比赛提交差距终审快照。归档日期：2026-06-10。

# Round 6: 比赛提交差距终审

> 2026-06-06 | 分支：`dev/delicious233` | 基于实际代码核查（PR #278 已合入）

## 提交物总览

| 提交项 | 状态 | 最后更新 | 差距 |
|--------|:--:|------|------|
| `bytedance.md` (赛题) | ✅ | 2026-05-25 | 无问题 |
| `SUBMISSION-CHECKLIST.md` | ⚠️ | 2026-06-01 | 4 天过期；截图数量未经核实；测试数据口径不一致（885 文件 vs 1166 用例） |
| `FEATURE-MATRIX.md` | ⚠️ | 2026-06-01 | 矩阵声明总体保守诚实，但未反映 06-02 ~ 06-06 的前端补救 |
| `DEMO-SCRIPT.md` | ⚠️ | 2026-06-02 | 场景二（TeamRun 多 Agent）**无法在未补 TeamRunID 链路的当前代码上走通** |
| `AI-COLLABORATION-LOG.md` | ⚠️ | 2026-06-02 | 叙事质量高，但缺 06-02 ~ 06-06 收尾期的日更 |
| `PROJECT-OVERVIEW.md` | ⚠️ | 2026-06-01 | Mermaid 图完整性 OK，但 "P0 已完成" / "进行中" 标签需与代码同步 |
| `PRODUCT-DESIGN-SUMMARY.md` | ⚠️ | 2026-06-02 | 设计总结质量好，但引用路径 `docs/architecture/system-architecture.md` 在提交包中可能不在同一层级 |
| `COMPETITIVE-GAP.md` | ⚠️ | 2026-06-01 | P0 Sprint 4 条全部标 `[x]`，但实际的 TeamRun/部署态差距仍然真实 |
| `BYTEDANCE-FINAL-AUDIT.md` | ❌ 严重过期 | 2026-06-01 | **审计结论大部分已被代码修复推翻**；详见下文 |
| Demo 视频 | ❌ 缺失 | -- | 只有脚本，无实际视频素材 |
| Desktop QA 截图 `.tmp/` | 待核实 | -- | 声称 300+ 张但未在 docs/competition/ 路径下 |
| TeamRun E2E 证据 | ❌ 缺失 | -- | 无运行日志、无事件导出、无截图、无录屏 |

## 1. 提交清单完成度逐条审计

### 核心项目文档

| 检查项 | 状态 | 证据/差距 |
|--------|:--:|------|
| README.md 中文版 223 行 | ⚠️ | 未实地验证行数；状态 badge 需更新为 PR #278 合入后状态 |
| README_EN.md 与中文版同步 | ⚠️ | 需核实同步时间 |
| system-architecture.md (282 lines) | ⚠️ | 路径为 `docs/architecture/`，未核实存在 |
| product-requirements.md | ⚠️ | 同上 |
| implementation-guide.md | ⚠️ | 同上 |
| PROJECT-OVERVIEW.md 含 3 个 Mermaid 图 | ✅ | 已读取，图完整 |
| FEATURE-MATRIX.md 含证据路径 | ⚠️ | 矩阵存在但 06-01 后未更新 |
| ADR (001-006) | ⚠️ | 声明就绪，未逐份核实 |

### 信息安全

| 检查项 | 状态 |
|--------|:--:|
| 不含生产密钥/token/密码 | ✅ |
| 不含真实服务器地址 | ✅ |
| 不含 provider API key | ✅ |
| 不含个人身份信息 | ✅ |
| 证据路径指向仓内文件 | ✅ |

### 测试覆盖 -- 口径不一致

提交清单声称 "885+ test files"；AI-COLLABORATION-LOG 声称 "1166/1166 通过 (109 文件)"。两者矛盾：1166 是测试用例数，885 是文件数 -- 需统一表述。

### 截图证据

| 证据类型 | 声明数量 | 是否核实 |
|----------|:--:|:--:|
| Desktop QA `.tmp/` | 300+ | 未核实 |
| Desktop `app/desktop/screenshots/` | 14 files | 未核实 |
| Web `app/web/screenshots/` | 135 files | 未核实 |
| Mobile `app/mobile/screenshots/` | 173 files | 未核实 |

## 2. 功能矩阵准确性（代码实证）

### BYTEDANCE-FINAL-AUDIT.md 的 5 项核心结论已被代码推翻

审计日期 2026-06-01，当前代码 2026-06-06。以下审计结论与实际代码不符：

| 审计原结论 | 当前代码真相 | 证据 |
|-----------|------------|------|
| "ChatView 无 deploy/artifact/approval 渲染" | **已有** DeployCard, ArtifactPreview, ApprovalCard, LinkCard 完整渲染 | `ChatView.tsx` L423-537: ApprovalBlock / artifact case / deploy_card case |
| "前端从未调用 getTaskRunEventSummary" | **已调用**，并在 MetricGrid 渲染 step_count / elapsed_ms / tokens / approvals / artifacts | `RunDetail.tsx` L174: `.getTaskRunEventSummary(taskId)`, L193-235: 6 MetricGridItem |
| "IMView pin/archive/search/sort 零命中" | **已有** searchSessions, sortBy, pinned/archived badge 渲染 | `IMView.tsx` L37: searchSessions, L51: sortBy, L280: pinned badge |
| "connectionStore reconnect/resume/restore 零命中" | **已有** reconnecting 状态、recovery state、reconnect 方法 | `connectionStore.ts` L18: reconnecting, L52-53: reconnect+recovery |
| "RunProcessContext 无 Messages/PinnedMessages" | **已有** Messages + PinnedMessages 字段 | `runnerctx/context.go` L72-73 |

**结论**：审计文档与实际代码之间有 5 天 lag，在此期间 TeamRun 无关的前端缺陷已全部修复。审计需重跑。

### 仍属半成品的声称

| 功能 | FEATURE-MATRIX 声称 | 实际 |
|------|:--:|------|
| Orchestrator 多 Agent 调度 | 部分完成 | Hub 后端模型完整（22 struct types），但 **TeamRunID 传递链路未闭合**（见关键缺失 #1） |
| 群聊 @Agent | 部分完成 | 代码存在但缺两个真实 Runtime Profile 的 TeamRun E2E transcript |
| TokenDance ID OIDC | 部分完成 | PKCE 代码完整（17 E2E tests），但缺部署态 login/callback/session/WS auth/logout/reconnect smoke |
| 5/8 远程执行场景 | 未实现 | 声明诚实：仅 3/8 可运行 |

## 3. Demo 脚本可行性

| 场景 | 时间 | 是否可行 | 阻塞项 |
|------|------|:--:|------|
| 开场 Logo | 0:00-0:20 | ✅ | 无 |
| 场景一：本地 Agent 工作台 | 0:20-1:10 | ✅ | Desktop 本地离线链路已验证 |
| 场景二：多 Agent 协作 | 1:10-2:00 | ❌ | **TeamRunID 链路未闭合**，无法用两个真实 Runtime 走通 Orchestrator 分派 |
| 场景三：三 Runtime 适配 | 2:00-2:30 | ✅ | 三个 adapter 均有测试覆盖 |
| 场景四：多端与 Hub | 2:30-2:50 | ❌ | Web -> Desktop 最小闭环代码存在但缺部署态 smoke；TokenDance ID login 未部署态验证 |
| 收尾 | 2:50-3:00 | ⚠️ | 测试覆盖率数字需核实（1166 用例 vs 885 文件口径不一致） |

**附：Demo 准备清单中提到的依赖**：
- 场景二需要 "预配置 Builder + Reviewer 两个 Agent Profile，Orchestrator 可用" -- Orchestrator 代码存在但 TeamRun E2E 未过
- 场景四需要 "Hub Server 已部署，Desktop/Web/Mobile 已登录 TokenDance ID" -- 部署态未验证

## 4. 文档时效性

所有 9 份比赛文档均在 2026-06-01 或 2026-06-02 最后更新。
当前代码最新 commit 为 2026-06-06 01:03（`d2603f9c docs(roadmap): 标记 Desktop P0 集成合入`）。
间隔 4-5 天，其间合入了 4 个 merge commit（R2 Shell, R4 Inspector, Desktop P0 IM composer, Desktop P0 集成）。

BYTEDANCE-FINAL-AUDIT.md 是过期最严重的 -- 其 "比赛前必修清单" 的前 5 项（Runtime 一等 UI / ChatView block types / Web 会话列表 / 上下文连续性 / WS 重连恢复）实际上已在 06-02 到 06-06 之间完成或接近完成。

## 5. AI 协作日志质量

**优点**：
- 逐日记录结构清晰，13 天全覆盖
- 量化指标有出处（git log 命令佐证）
- 模型分配策略描述了 opus/sonnet/haiku 的收敛过程
- dev-team skill 并行开发的叙事有说服力
- subagent 分发协议和 Worktree 隔离的工程实践沉淀完整

**问题**：
- 日志止于 06-02，缺 06-02 至 06-06 的最后冲刺期（4 天）
- 数字口径不一致：1166 前端测试 vs 885 test files 关系不明确
- 某些声明强调 "1055 commits"，但未区分自研代码与 AI 生成代码的边界
- 未提及 AI 协作中的失败案例或返工 -- 全是成功叙事

## 关键缺失 Top 5

### 1. TeamRunID 传递链路（比赛生死线）

**严格程度**：致命。评分权重 AI 协作 30% + 功能完整度 25% 直接受影响。

Roadmap 标记为 "P0-3：⚠️ 比赛生死线"。当前状态验证：

- Hub `agent_dispatch.go` **已** 在 dispatch payload 中填充 TeamRunID（L292-294）
- Desktop `buildEdgeRunBody()` **未** 转发 TeamRunID -- 返回体中无 `teamRunId` 字段（L268-285）
- Edge `PostRuns` 请求体 **未** 接收 TeamRunID -- struct 中无此字段（handlers.go L597-626）
- `hub-server/internal/service/agent.go` **未** 在 TriggerAgentTask 路径传递 TeamRunID（grep 零命中）

**影响**：群聊中 @多个 Agent 时，Edge 无法关联回 Hub 的 TeamRun。场景二全部 Demo 走不通。

### 2. 比赛材料全面过期

全部 9 份竞争文档 4-5 天未更新。BYTEDANCE-FINAL-AUDIT.md 的核心结论已被代码推翻。评审者如果以 audit 文档为基准判断完成度，将严重低估实际交付。

### 3. 无 Demo 视频素材

只有脚本，无任何录屏片段、运行日志、事件导出。DEMO-SCRIPT 本身假定了 TeamRun 可运行态，但当前代码还不支持。

### 4. TokenDance ID 部署态 zero-evidence

OIDC PKCE 代码链路完整（17 E2E tests），Desktop PKCE 15 refs 存在，Hub session gate 就绪。但**从未在真实部署环境中完成一次 login -> callback -> session -> WS auth -> logout/reconnect 闭环**。提交时只能声称 "代码就绪但未部署态验证"，这会显著削弱功能完整度评分。

### 5. 测试口径与截图证据未经核实

多种数字相互矛盾（885 test files vs 1166 test cases），截图路径存在但未逐一核实内容是否对应功能点。评审者若要求展示特定截图，可能无法定位。

## 可补救项（附预估工作量）

| 优先级 | 补救项 | 预估工时 | 阻塞 |
|:--:|---|:--:|---|
| P0 | 补 TeamRunID 传递链路（3 文件：useHubIntegration.ts + handlers.go + runnerctx/context.go） | 1-2h | 无 |
| P0 | 跑两个真实 Runtime TeamRun E2E，导出证据 | 2-3h | TeamRunID 链路闭合后 |
| P0 | 录制 3 分钟 Demo 视频（场景一+场景三为主，场景二裁减为代码演示） | 3-4h | TeamRun E2E 证据就绪后 |
| P1 | 更新全部 9 份比赛文档到 06-06 状态 | 2-3h | 无 |
| P1 | 重跑 BYTEDANCE-FINAL-AUDIT 审计 | 2-3h | 文档更新后 |
| P1 | 统一测试数字口径（明确 1166 = 测试用例数，标注文件数） | 0.5h | 无 |
| P2 | AI-COLLABORATION-LOG 补 06-02 ~ 06-06 日更 | 1h | 无 |
| P2 | TokenDance ID 部署态 smoke（真实 login/logout/reconnect） | 2-3h | Hub 需在可访问部署地址 |

**可补救总计：约 13.5 - 20.5 工时。如果只聚焦 P0（TeamRunID + E2E + 视频），约 6-9 工时。**

## 不可补救项

### 1. 5/8 远程执行场景（SSH / Relay / Cloud）

竞赛需求文档将 "多端支持"（Web / 桌面端 / 移动端）列为 P2 可选。但赛题自身并未要求 SSH 远程、Hub Relay、Cloud Edge 等场景必须可运行。**这不是提交硬伤**，但在答辩时需明确说明当前 3/8 场景可运行（本地离线、本地在线 Hub、Web->Desktop 最小闭环），其余为架构规划。

### 2. 完整端到端部署

TokenDance ID 的生产部署态验证如果在提交截止前无法完成（依赖可访问的 Hub 地址 + 真实 OIDC provider），则只能以 "代码就绪、E2E 测试覆盖、待部署态验证" 的 caveat 提交。这会扣功能完整度分，但不是一票否决。

### 3. 真实 Agent Market / Skill/MCP 管理

赛题未要求，属超预期加分项。不在比赛交付范围内。

## 附录：核实过的代码路径

| 文档声明 | 核实方式 | 结论 |
|---------|---------|:--:|
| ChatView 有 deploy/artifact/approval/link_card 渲染 | `grep -n` ChatView.tsx L423-537 | ✅ 通过 |
| RunDetail 消费 getTaskRunEventSummary | `grep -n` RunDetail.tsx L174 | ✅ 通过 |
| IMView 有 search/sort/pin/archive | `grep -n` IMView.tsx L37,L51,L280 | ✅ 通过 |
| connectionStore 有 reconnect | `grep -n` connectionStore.ts L18,L52-53 | ✅ 通过 |
| hubWS.ts 有 reconnection | `grep -n` hubWS.ts L50-53,L205-208 | ✅ 通过 |
| RunProcessContext 有 Messages/PinnedMessages | `grep -n` context.go L72-73 | ✅ 通过 |
| buildEdgeRunBody 无 TeamRunID 转发 | 读取 useHubIntegration.ts L261-285 | ✅ 确认缺失 |
| Edge PostRuns 不接收 TeamRunID | 读取 handlers.go L597-626 | ✅ 确认缺失 |
| agent.go 不传 TeamRunID 到 TriggerAgentTask | `grep -rn` agent.go 零命中 | ✅ 确认缺失 |
| Hub agent_dispatch.go 填充 TeamRunID | `grep -n` agent_dispatch.go L292-294 | ✅ 已填充但下游未消费 |
| TeamRun handler 接口存在 | `grep -n` agent_team.go L22-25 | ✅ StartTeamRun/GetTeamRun/GetTeamRunState/ListTeamRuns |

**加权就绪度：6.1/10**（上次 Review R5 评分 5.95/10。前端补救提升了约 0.15 分，但 TeamRunID 链路缺失和文档过期仍是 P0 阻塞。）
