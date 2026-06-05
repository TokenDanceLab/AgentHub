# AgentHub 路线图

> 最后更新: 2026-06-05 | 5 天 Desktop 比赛交付指挥盘
> 历史长版已归档: [archive/roadmap-pre-5day-cleanup-20260605.md](archive/roadmap-pre-5day-cleanup-20260605.md), [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)

## 目标和评分约束

AgentHub 是 IM 形态的多 Agent 协作平台。比赛前唯一主线是把 Desktop/Tauri 做成可运行、可录屏、可解释的 IM-first Command Center：用户像用飞书/微信一样发消息、@ 多个 Agent，由 Orchestrator 分派任务，Agent 在同一 transcript 内返回文本、工具过程、Diff、Preview、Approval、产物和部署状态。

评分权重决定当前优先级：

| 权重 | 对 AgentHub 的落地要求 |
|---:|---|
| AI 协作能力 30% | 展示 spec/rules/roadmap/subagent 协作记录，以及真实 TeamRun 多 Agent transcript |
| 功能完整度 25% | IM 单聊/群聊、@Agent、Orchestrator route、上下文、产物内联、审批路径可演示 |
| 生成效果 20% | 第一屏是工作台，不是空壳；Diff/Preview/Tool/Artifact 卡片在消息流和右侧证据列可见 |
| 代码理解 15% | 架构边界清晰：Desktop -> Edge -> Runtime，Hub 只在账号/同步/远程审计场景进入 |
| 产品感 10% | 信息密度、稳定 composer、任务队列、证据列、移动折叠路径都像真实工具 |

比赛材料在 workspace 根目录：`../docs/competition/bytedance.md`、`../docs/competition/SUBMISSION-CHECKLIST.md`。截止日期是 2026-06-10。

## 当前结论

- Desktop 先做完；Web/Mobile 只在 Desktop 验收后迁移共享能力。现在两线推进会稀释比赛主分。
- 不再把 Phase A/B/C/D 长期 backlog 放进主路线图。长期工程债保留在 archive 和专题 docs，不能驱动 2026-06-10 前的派工。
- R2/R4/R5/R3/R6A 是当前 Desktop 队列；R2 先合入，再叠右侧 Inspector、Composer、Transcript contract、乐观消息。
- Repo-wide Go/Web/Mobile/Docker/E2E 红项是独立基线债。除非阻塞 Desktop 演示或必需检查合并，否则不在本冲刺展开。
- 所有“完成”必须有当前 commit 可验证证据：focused tests、截图、真实运行日志、TeamRun export 或录屏片段。静态 mock 截图不能冒充真实多 Agent 协作。

## 5 天交付计划

| 日期 | Day | 目标 | 完成判定 |
|---|---:|---|---|
| 2026-06-05 | D0 | 路线图治理；确认比赛约束；锁定 Desktop 队列；R2 合并策略 | `docs/roadmap.md` 小于 220 行；archive 有完整历史；R2 blocker 被明确分类 |
| 2026-06-06 | D1 | 合入 R2 Desktop shell；叠 R4 Right Inspector；补 1440/1280/390 shell 截图 | Global Rail + Conversation Sidebar + Transcript + Right Inspector + Composer 同屏成立 |
| 2026-06-07 | D2 | 合入 R5 Composer 和 R3 Transcript contract；消除 IM/Chat 双 renderer 漂移 | @Agent、附件、approval mode、Tool/Diff/Approval/Artifact block 在主流路径一致 |
| 2026-06-08 | D3 | 合入 R6A optimistic IM；补 approval 一致性最小切片；跑真实 TeamRun | 两个真实 Runtime Profile 的 route/task/event/transcript/export 可录屏 |
| 2026-06-09 | D4 | Demo polish；视觉 QA；比赛文档和 AI 协作日志同步 | 3 分钟脚本可连续演示；截图集覆盖 light/dark、宽屏/窄屏、成功/失败/审批态 |
| 2026-06-10 | D5 | 提交包冻结；只修 P0 演示崩溃和文案事实错误 | README、技术文档、产品文档、Demo、协作日志、视频、证据索引一致 |

## 当前最高优先级

| Rank | 工作 | 状态 | 下一步 |
|---:|---|---|---|
| 1 | R2 Desktop Shell IA | PR #271 open, ready, head `0048be84`; `frontend-desktop` 和 `validate` 绿，merge state `UNSTABLE` | 判断 repo-wide 红项是否可豁免；若不能，单独记录合并阻塞，不转去修 Web/Mobile |
| 2 | R4 Right Inspector | PR #273 draft, head `b71d9a5c`; focused tests 曾绿，GitHub 当前红 | 等 R2 后 rebase；接入 progress、tool timeline、changed files、workspace evidence |
| 3 | R5 Composer Convergence | PR #274 draft, head `7d9bcd54`; focused tests 曾绿，GitHub 当前红 | 等 R2/R4 后 rebase；保持共享 core，小切片合并 |
| 4 | R3 Transcript Contract | PR #272 draft, head `30894536`; focused tests 曾绿，GitHub 当前红 | 在 R5 后合；避免新增第三套 renderer |
| 5 | R6A Optimistic IM | PR #275 draft, head `89ade593`; focused tests 曾绿，GitHub 当前红 | 在 R3 后合；approval 一致性另起小切片 |
| 6 | 真实 TeamRun 证据 | PR #270 已合入证据链基础，但还缺最终录屏和导出 | 跑两个真实 Runtime Profile；输出 transcript、task route、events、截图、视频素材 |
| 7 | 比赛材料同步 | 旧提交清单含 Web/Mobile 和 2026-06-01 状态，需压缩为 Desktop 证据优先 | 更新 feature matrix、submission checklist、demo script、AI collaboration log |

推荐合并顺序：R2 -> R4 -> R5 -> R3 -> R6A。每合一个分支立刻跑 Desktop-focused gate，不等待“大而全”的 repo 治理。

## Desktop 分支队列

| ID | PR | 分支 | 写入范围 | Desktop 验收 |
|---|---|---|---|---|
| R2 | #271 | `phase-r2/desktop-shell` | `app/desktop/src/App.tsx`, `App.module.css`, `config/viewRegistry.ts`, `views/IMView.tsx`, tests | 四栏 IA 成立；无横向滚动；right panel 有明确入口；1440/1280/390 截图 |
| R4 | #273 | `phase-r4/right-inspector` | `RunDetail*`, `RightInspector*`, `TeamRunDock*`, `TeamRunConsole*`, `FileExplorer*`, `uiStore.ts` | 右侧显示状态、进度、Active/Done/Warning queue、tools、changed files、workspace |
| R5 | #274 | `phase-r5/composer-convergence` | `PromptInput*`, `IMMessageInput*`, `hooks/useMention.ts`, composer tests | Enter/Shift+Enter、@Agent、附件、workdir、approval mode、disabled/pending 状态一致 |
| R3 | #272 | `phase-r3/transcript-contract` | `components/IM/*`, `components/ChatView*`, `ChatView.types.ts`, block tests | Tool/Diff/Thinking/Approval/Artifact/child_agent/route_decision 不被 Markdown fallback 吞掉 |
| R6A | #275 | `phase-r6/im-optimistic` | `hooks/useIMChat.ts`, `components/IM/*`, approval UI/API tests | 发送立即出现 pending 气泡；失败可回滚；审批卡和子 Agent 路由卡进入 IM 流 |

## Desktop 视觉和 Demo 验收

竞品截图只吸收信息架构，不复制品牌、头像、背景纹理或暗色装饰。AgentHub 自己的 Desktop 必须满足：

- 左侧两级导航：48-56px Global Rail + 280-320px Conversation Sidebar。Manager 私聊、Worker 私聊、Project 群聊层级清晰，支持搜索、最近活跃、置顶/归档/空状态。
- 中间是 Unified Transcript，不做 landing hero。每条 Agent/子 Agent 消息显示身份、Runtime badge、时间、工具状态和可操作卡片。
- 右侧是证据列，不是装饰 summary。宽屏 300-340px 常驻；包含 progress、Active/Done/Warning queue、tool timeline、changed files、workspace、artifacts。
- 底部 Unified Composer 高度稳定；`+`、文件、附件、@Agent、审批/权限、发送按钮使用 icon action，并具备 disabled/pending/错误态。
- 消息流同时覆盖成功、进行中、失败和审批：thinking/tool running、route decision、dispatch、tool error、agent error、approval required 都有可读卡片。
- 1440x920、1280x800、390x844 必须无横向滚动、无文本遮挡、composer 不盖住最后一条消息。390x844 明确 list -> transcript -> inspector/approval 的折叠路径。
- 真实 TeamRun 截图必须来自当前运行，不用 mock 数据伪装。演示中至少能看到两个 Runtime/Profile 协作、Orchestrator route、子任务、工具过程、产物和最终摘要。

## 24 小时执行队列

| 顺序 | Owner | 任务 | 产出 |
|---:|---|---|---|
| 1 | 主 Agent | 完成本文件治理，提交并推送 | `docs/roadmap.md` 精简版 + archive 快照 |
| 2 | 主 Agent | 复核 PR #271 必需检查策略 | 合并 R2，或在 PR/roadmap 写明 Desktop 绿但 repo-wide 基线阻塞 |
| 3 | sonnet | R4 rebase 到 R2 后修 Desktop UI 接入 | Right Inspector 截图和 focused tests |
| 4 | sonnet | R5/R3 按顺序 rebase，减少 renderer/composer 漂移 | Composer + transcript focused tests |
| 5 | haiku | 只在真实 TeamRun 被 Go/Edge 小 bug 阻塞时介入 | 最小 Go 修复 + `go test ./... -short -count=1` 对应包 |
| 6 | opus | 审查合并后 IA、评分覆盖和 demo script | 3 分钟脚本、证据索引、答辩要点 |

## Subagent 分派规则

- sonnet：Desktop UI、多模态截图审查、CSS/React 小切片。允许路径优先限制在 `app/desktop/src/` 和必要的 `app/shared/src/ui/`。
- haiku：Go/Edge/Hub 的小型阻塞修复。只在 Desktop TeamRun 真实运行被后端问题卡住时派发，不做后台治理大扫除。
- opus：架构判断、安全/权限审查、PR 顺序和比赛材料一致性审查。重要合并前至少一次只读 review。
- 每个 subagent prompt 必须写清允许路径、禁止范围、验收命令和“不碰 Web/Mobile/Go/Docker 基线债”的边界。
- subagent 交付后主 Agent 复核 diff、运行 targeted checks，再决定是否合并。

## 暂不做

这些方向继续保留，但不进入 2026-06-10 前 Desktop 主线：

- Web 工作台重组、Web visual QA、Web lint/typecheck 基线治理。
- Mobile Tauri/OIDC 深链、移动端截图补全。
- Go repo-wide 测试基线、Docker build、cross-platform build、E2E smoke 的系统性治理。
- Edge SQLite/FTS5 完整持久化、Remote Edge、Cloud Edge、Hub Relay。
- Feishu/Lark、Agent Market、完整部署发布、公开站 SEO/i18n。
- ChatView 全量重写、LegendList 替换、全局状态大重构。

如果以上事项成为 Desktop Demo 的直接 P0 blocker，先写明 blocker、最小修复范围和回退方案，再单独派发；不能把它们重新塞回主路线图。

## 归档和治理规则

- 主 `docs/roadmap.md` 只保留当前 5 天可执行命令、分支队列、验收条件和禁止范围，目标控制在 220 行以内。
- 历史 Phase A/B/C/D、Quick Wins、长期安全/性能/架构债、深度竞品审计和评审长文归档到 `docs/archive/`，不再重复粘贴。
- 更新 roadmap 时用替换和合并，不追加第二套状态叙事。每次状态变化只改当前表格的一行。
- 与比赛提交相关的事实最终同步到 `docs/competition/*`；与当前接手状态相关的事实同步到 `docs/handoffs/STATE.md`。
