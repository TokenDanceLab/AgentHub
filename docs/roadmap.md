# AgentHub 路线图

> 最后更新: 2026-06-05 (五维 Review + 七项深研 + 比赛评审评估) | 唯一事实源 | 旧版归档: [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

## 课题目标

构建 IM 形态的多 Agent 协作平台。用户像用飞书/微信一样与 AI Agent 交互：
- 单聊/群聊对话，@Agent 分派任务
- Orchestrator 自动协调多 Agent 协作
- Agent 回复内联 Diff、预览、附件等富媒体
- 统一适配器接入 Claude Code / Codex / OpenCode
- Desktop (Tauri) 为主力端

**考察维度**: AI 协作能力 30% | 功能完整度 25% | 生成效果 20% | 代码理解 15% | 创新与产品感 10%

**交付物**: 产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频

---

## 比赛冲刺覆盖层（2026-06-05 Codex 架构审核）

> 结论：长期 Phase A/B/C/D 方向基本正确，但比赛前的优先级必须覆盖为 **IM 多 Agent 可演示闭环 > 生成效果显性证据 > 工程治理收尾**。赛题权重里 AI 协作 30%、功能完整度 25%、生成效果 20% 合计 75%，不能让 SQLite、统一信封、全量重构或远程/云场景阻塞 TeamRun Demo。
>
> 赛题原文在 workspace 根目录 `../docs/competition/bytedance.md`，提交检查清单截止日期为 2026-06-10（见 `../docs/competition/SUBMISSION-CHECKLIST.md`）。AgentHub 仓内 agent 如果只读本仓库，需要显式跳到 workspace 根目录读取比赛材料。

### 当前优先级判断

| 判断 | 处理 |
|---|---|
| Phase C 不能再等 Phase B 全部完成 | C0/C1 的比赛最小闭环只依赖 A4 足够解耦和现有 Hub/Edge API；B0 SQLite/FTS5 保留为加分项，不是 IM Demo 入场门槛 |
| IM @Agent / 富消息不再是空白 | Sprint #1/#2 已落地：`IMMessageInput` 接入 `useMention`/`MentionPopover`，`IMMessageView` 通过 `IMBlockRenderer` 渲染 Tool/Diff/Thinking/Approval。后续重点转为 E2E transcript、统一渲染合同和 Demo 证据 |
| TeamRun 已有可用产品面，但缺真实 transcript | `TeamRunDock` / `TeamRunConsole` / Hub AgentTeam API 已存在；比赛需要两个真实 Runtime Profile 的群组协作录屏、截图和 route/task/event 导出 |
| Desktop 需要从功能拼接改为 IM-first Command Center | 参考竞品正确吸收四栏信息架构：Global Rail、Conversation 列表、Unified Transcript、Right Inspector、Unified Composer；不要再只局部美化单个组件 |
| 6 月 1 终审中的部分缺口已被后续修复 | Run summary、Hub thread history 注入、Web stream recovery、IM @Agent、IM 富消息等已有代码路径；后续只补测试/部署态/截图证据，不重复规划成"完全不存在" |
| 当前已有多条 phase 分支待合并 | R2/R3/R4/R5/R6A 已推送到独立分支；后续并行先做 PR/冲突/视觉 QA 或领取 R1/R6B，不要在同一批 Desktop shell / IM renderer 文件上重复分派 |

### 比赛 Sprint 顺序（从 2026-06-05 当前 HEAD 继续）

Sprint #1 `IM @Agent`、Sprint #2 `IM 富消息`、Sprint #4 `Tool 打磨` 已进入完成历史，后续 agent 不要把它们当作待从零实现的任务。

| Rank | 任务 | 状态 | 为什么排这里 | 验收证据 |
|---:|---|---|---|---|
| 1 | **真实 TeamRun E2E transcript**：两个真实 Runtime Profile 在同一 group/team run 中协作，含 Orchestrator route、子任务、产出聚合、失败/审批处理 | 待做 | AgentHub 最大差异化证据；没有 transcript 时"多 Agent 协作"仍像后端能力声明 | 录屏脚本、截图、运行日志、任务事件导出；写入比赛证据文档 |
| 2 | **Desktop Shell 信息架构重组**：Global Rail + Conversation 列表 + Unified Transcript + Right Inspector + Unified Composer | 分支就绪 | 竞品截图暴露的是工作台信息架构差距；比赛生成效果和产品感需要第一屏直接成立 | `phase-r2/desktop-shell` 已推送；合并后补 1440x920、1280x800、390x844 截图；无重叠；右侧 Inspector 与 IM 同屏 |
| 3 | **Transcript 渲染合同收敛**：主 Chat 与 IM 共享 block/normalization 约束，避免两套 renderer 漂移 | 分支就绪 | `IMBlockRenderer` 已落地，但 ChatView/IM 仍可能双系统分离；后续富消息必须可持续扩展 | `phase-r3/transcript-contract` 已推送；focused tests 通过；旧 Markdown-only fallback 不吞 block |
| 4 | **Right Inspector 证据面板**：RunDetail + TeamRun 摘要 + Tool timeline + Changed Files + 工作文件夹 | 分支就绪 | 评审需要在右侧看到任务完成度、命令、文件和产物，而不是只看气泡文本 | `phase-r4/right-inspector` 已推送；RightInspector focused tests 23/23；合并后补截图 |
| 5 | **Composer 收敛**：`PromptInput` / `IMMessageInput` 的 @Agent、附件、workdir、approval mode 语义一致 | 分支就绪 | @Agent 已进 IM，但任务派发和本地 Run 输入仍是两条体验；统一入口降低演示认知成本 | `phase-r5/composer-convergence` 已推送；composer/attachment/IM input focused tests 44/44 |
| 6 | **IM 协作缺口收敛**：乐观更新、主 Chat/IM 审批路径统一、子 Agent / RouteDecision 卡片进入 IM 流 | 部分分支就绪 | @Agent 和富消息已落地，但审批一致性与真实 TeamRun 证据仍会直接影响"群聊协作"观感 | `phase-r6/im-optimistic` 已推送；optimistic send focused tests 37/37；approval 一致性仍待做 |
| 7 | **Demo 生成效果打磨**：Diff 高亮、Artifact/Preview 可见入口、Tool 卡片状态和标题语义化，优先服务 3 分钟脚本 | 部分完成 | 提升生成效果评分；避免 UI 看起来只是文本转发 | Desktop 截图覆盖 Diff/Preview/Tool；关键 null/long output 不崩溃 |
| 8 | **部署态最小 smoke**：如果 Demo 走 Hub/Web，补 login -> Hub session -> WS auth -> task stream -> logout/reconnect；如果 Demo 只走本地 Desktop，明确 caveat | 待做 | 可运行 Demo 和答辩可信度要求；但不能压过 IM/TeamRun | smoke 命令、截图、失败 caveat |
| 9 | **比赛资料同步**：把最新完成/未完成状态同步到提交清单、功能矩阵、Demo 脚本和 AI 协作日志 | 持续 | 防止答辩材料沿用 6 月 1 的过期缺口或夸大能力 | 文档 diff；证据路径都指向当前 commit |

### 比赛前不要阻塞的事项

这些方向重要，但不应挡住上面的 Sprint：

- B0 Edge SQLite + FTS5 完整化：可作为重启不丢数据的加分项，不能作为 C0 入场门槛。
- A6 Edge 成功响应统一信封、DB TLS、secret guard 扩展：有 worktree 可继续，但比赛主线只要求不暴露密钥、不破坏现有 API。
- ChatView 全量拆分、LegendList 替换、运行状态全局重构：只做 demo 必要的低风险切片。
- Remote Edge / Cloud Edge / Hub Relay / Web->Cloud：保持架构规划和 caveat，不承诺比赛前完成。
- Agent Market、Feishu/Lark、完整部署发布：不进入 3 分钟核心演示，除非已有可验证最小闭环。

---

## Desktop 重组路线（IM-first Command Center）

> 目标：把 Desktop 从“左侧 Thread + 中间 Chat + 右侧 RunDetail 的功能拼接”重组为比赛可演示的 IM 工作台。核心不是换皮，而是让用户第一眼看懂：谁在会话里、Agent 正在做什么、产物在哪里、下一步能点什么。

### 信息架构目标

| 区域 | 目标 | 当前基础 | 重组要求 |
|---|---|---|---|
| Global Rail | 图标式全局入口：消息、项目、Agent、TeamRun、设置 | App shell、TopMenu、`viewRegistry` | 保持窄 rail，不塞列表；icon-only 按钮必须有 tooltip/aria-label |
| Conversation Sidebar | Manager 私聊、Worker 私聊、Project 群聊、当前会话、搜索筛选 | `ThreadPanel`、`IMView` session/contact 数据 | IM 会话和项目线程统一显示层级；选中对象决定 center transcript |
| Unified Transcript | 用户消息、Agent 回复、Tool、Diff、Thinking、Approval、Artifact、Deploy | `ChatView`、`IMMessageView`、`IMBlockRenderer` | 禁止新增第三套消息流；Hub/Edge/TeamRun 事件都投影成同一 block contract |
| Right Inspector | 进度、任务计划、Tool timeline、Changed Files、Artifact、工作文件夹 | `RunDetail`、`TeamRunDock`、`TeamRunConsole`、`FileExplorer` | 宽屏常驻；窄屏可收起但必须有入口；它是证据面板，不是装饰卡 |
| Unified Composer | @Agent、附件、工作目录、审批模式、发送/部署 | `PromptInput`、`IMMessageInput`、`useMention` | 后续抽共享 composer adapter；IM 与本地 Run 的 payload 语义一致 |

### 竞品截图复核后的视觉验收

这轮参考图只吸收工作台信息密度和证据组织方式，不照搬头像、品牌、背景纹理或无关装饰。R2/R4/R7 合并验收时按以下规则检查：

- 左侧必须是两级导航：窄 Global Rail 固定 48-56px，只放头像和 icon action；Conversation Sidebar 固定 280-320px，包含搜索、Manager/Worker/Project 分组、未读/时间/状态，不能把联系人散落到主内容区。
- 中间 transcript 以真实对话为主，不做 landing hero。完成摘要、过程统计、回复/引用/重新生成、部署/产物卡必须在消息流中可见；长文本最大宽度收敛到可读范围，避免横跨整屏。
- 右侧 Inspector 固定为证据列，宽屏约 300-340px：顶部状态 + 进度条，其下是任务规划/工具事件卡，再下是工作文件夹和最近产物。它要能回答“做了几步、跑了哪些工具、改了哪些文件、产物在哪”。
- Composer 固定在底部并预留稳定高度，含 `+`、文件、附件、@Agent、审批/权限等 icon action；发送按钮有 disabled/pending 状态，不因输入内容或附件列表造成布局跳动。
- 视觉风格保持 light-first、低边框、小圆角、弱阴影、高对比文本；可以有轻微网格/玻璃感，但不能变成低可读度背景或营销页。
- 截图验收必须覆盖 1440x920、1280x800、390x844；检查无横向滚动、右侧列不压正文、底部 composer 不遮挡最后一条消息、icon-only 控件有 aria-label/tooltip。

### 执行队列

执行顺序以 Sprint Rank 为准，R-ID 只是派发和追踪编号。R0 先完成文档合同；R1 和 R2 可并行，但 R1 的 TeamRun 证据不能被 R2-R5 的视觉重组压后。

| ID | 任务 | Owner | 写入范围 | 验收 |
|---|---|---|---|---|
| R0 | 文档和架构合同同步 | 主 Agent | `docs/architecture.md`、`docs/roadmap.md` | `git diff --check`；stale 缺口不再误导 |
| R1 | TeamRun E2E transcript 与证据导出 | opus 设计，haiku/sonnet 按需实现 | Hub/Edge 最小修复、Desktop evidence UI、`docs/competition/*` | 两个真实 Runtime Profile 完成群组协作；截图、日志、事件导出可答辩 |
| R2 | Shell IA 重组：Global Rail + Conversation Sidebar + responsive layout | sonnet | `app/desktop/src/App.tsx`、`App.module.css`、`config/viewRegistry.ts`、`views/IMView.tsx`、相关 tests | Desktop 1440x920/1280x800/390x844 截图；无横向溢出；rightPanel 不无提示消失 |
| R3 | Unified Transcript contract：整理 IM/Chat block 类型、renderer 共享边界、normalization adapter | sonnet 实现，opus 审查 | `components/IM/*`、`components/ChatView*`、`components/ChatView.types.ts`、相关 tests | Tool/Diff/Thinking/Approval/Artifact/child_agent/route_decision 在 IM 和主 Chat 都可渲染；无 Markdown-only regression |
| R4 | Right Inspector：RunDetail/TeamRun/Tool/Artifact/work folder 汇总 | sonnet | `components/RunDetail*`、`components/TeamRunDock*`、`views/TeamRunConsole*`、`components/FileExplorer*`、`uiStore.ts` | 右侧显示 progress、8/8 steps、任务卡、文件树和产物入口；宽屏常驻、窄屏抽屉 |
| R5 | Composer 收敛：共享 mention/附件/workdir/approval mode 行为 | sonnet | `components/PromptInput*`、`components/IM/IMMessageInput*`、`hooks/useMention.ts`、tests | mention payload、Enter 发送、Shift+Enter 换行、disabled/loading、附件入口单测通过 |
| R6 | IM 协作缺口收敛：optimistic message、approval block、child/route cards | sonnet 实现，haiku 按需补 Hub/Edge 字段 | `hooks/useIMChat.ts`、`components/IM/*`、Team approval 相关 UI/API tests | 发送即显示 pending 气泡；审批卡一致；子 Agent/路由决策在 IM transcript 可见 |
| R7 | 比赛提交材料同步 | 主 Agent + sonnet | `docs/competition/*`、README 功能矩阵、截图索引 | 不夸大未完成能力；每个完成项有当前 commit 可验证证据 |

### 当前分支状态（2026-06-05）

| 分支 | 状态 | 验证 | 合并前注意 |
|---|---|---|---|
| `phase-r2/desktop-shell` | 已推送，PR 待开/待合并 | `uiStore.test.ts` 4/4；`git diff --check` 通过 | 需视觉 QA；typecheck 仍受旧债阻断 |
| `phase-r3/transcript-contract` | 已推送，PR 待开/待合并 | `IMBlockRenderer.test.tsx` + `IMMessageView.test.tsx` 31/31；`git diff --check` 通过 | 合并时留意 R6A 对 IM message view 的相邻改动 |
| `phase-r4/right-inspector` | 已推送，PR 待开/待合并 | `RightInspector.test.tsx` 23/23；`git diff --check` 通过 | 先以 props-only 组件接入，避免在同一 PR 重写 shell grid |
| `phase-r5/composer-convergence` | 已推送，PR 待开/待合并 | `useComposerCore`/`attachment`/`IMMessageInput` focused tests 44/44；`git diff --check` 通过 | 不引入巨型 `UnifiedComposer`；PromptInput 现有全量测试受 shared React patch 版本问题影响 |
| `phase-r6/im-optimistic` | 已推送，PR 待开/待合并 | `useIMChat.test.ts` + `IMMessageView.test.tsx` 37/37；`git diff --check` 通过；顺手清掉 `useIMChat` mention typecheck 旧债 | 只完成 R6A 乐观发送；approval 一致性另起切片 |

主线 `dev/delicious233` 当前只含 R0 文档合同提交，尚未合入上述功能分支。后续 agent 不要重复实现 R2/R3/R4/R5/R6A，应优先开 PR、做冲突审查、跑视觉 QA，或者转向 R1 TeamRun E2E。

### R2-R4 落地细化

- R2 Shell 产出：固定布局 zones（rail / conversation / transcript / inspector / composer），rail 只放 icon action，conversation 宽度使用稳定响应式约束；不在这一步重写消息数据流。
- R3 Transcript 产出：明确共享 `TranscriptBlock`/normalizer 或等价 adapter，保留 `IMBlockRenderer` 已有能力，把 `child_agent`、`route_decision`、`artifact`、`deploy_card` 从 null fallback 变为可见卡片。
- R4 Inspector 产出：至少包含 Progress、Task Plan、Tool Timeline、Artifacts、Work Folder 五个区块；`TeamRunConsole` 作为深挖视图，右侧 Inspector 必须先给摘要证据；事件卡显示动作、工具名、路径/产物、完成状态，不堆无意义大卡片。

### Subagent 分派规则

| 模型别名 | 本阶段用途 | 禁止事项 |
|---|---|---|
| sonnet | Desktop React/TypeScript、CSS、截图驱动视觉修复、批量测试修复 | 不独自改 Hub/Edge 架构；不在未分配范围里大面积重写 |
| opus | 架构审查、Transcript contract、TeamRun E2E 方案、比赛材料可信度审核 | 不做机械批量 CSS/TS 改名 |
| haiku | Go 后端小修、API/事件字段补齐、快速事实查证和测试生成 | 不承担大上下文前端重组；每次只给 1-2 个文件范围 |

### 不接受的实现方向

- 不做新的“漂亮但孤立”的 landing/hero 页面；Desktop 第一屏必须是可操作工作台。
- 不把 TeamRun Console 藏成唯一入口；比赛截图里必须能在 transcript 旁看到执行证据。
- 不把 Claude Code / Codex / OpenCode 当作联系人本身展示；它们是 Runtime，联系人是 Agent Profile 或 Team。
- 不为了赶 UI 重组破坏 `viewRegistry` slot、Tauri Desktop/Mobile 隔离、TokenDance ID 鉴权边界。
- 不再把已完成的 Sprint #1/#2 写成阻断缺口；剩余风险必须写成 E2E 证据、统一合同或体验收敛。

---

## 总体进度

```
Phase A: 工程基础设施 ████████████  95%  ← A0-A3✅, A4✅, A6.2✅, A6.3✅, 前端止血完成
Phase B: 持久化 + 性能  ███░░░░░░░  25%  ← B2 N+1✅, B3 agent.go 拆分✅
Phase C: IM 核心闭环   ████░░░░░░  35%  ← 主线保守口径；R2/R3/R4/R5/R6A 分支合并和视觉 QA 后再重估
Phase D: 高级功能      ░░░░░░░░░░   0%
```

### Phase 依赖关系

```
A (基础设施) ──→ B (持久化 + 性能) ──→ C (IM 闭环) ──→ D (高级功能)
     │                                      ↑
     └── App.tsx 拆分 (A4) ──────────────────┘ 前端解耦是 IM 开发前提
```

比赛冲刺例外：C0/C1 的最小演示闭环不等待 B0 完整出场；B0 只提升稳定性和重启恢复，不是 @Agent 群聊、TeamRun transcript、富消息投影的前置条件。

### 分支策略

- `master` — 受保护，只接受 PR
- `dev/delicious233` — 主开发分支，日常 commit 目标，定期 PR → master
- `phase-aN/xxx` — 临时 feature 分支，在 `.worktrees/` 下开发，完成后合回 dev 后删除
- 协作者分支 (`dev/johnny`, `dev/trump`) — 独立开发线

---

## Phase A: 工程基础设施 + 安全修复

> **目标**: 建立可观测性基座（错误码/日志/调试），修复安全与稳定性隐患，解耦前端开发瓶颈
>
> **入场条件**: ✅ v0.2.0 已发布，架构剖析已完成
> **出场条件**: Edge/Hub 统一错误码 + 请求追踪 + 调试端点；无凭据泄漏；App.tsx 拆为独立模块

### A0: 错误码体系收口 `errcode` ✅

- [x] 共享 `pkg/errcode` 模块 + `go.work` workspace
- [x] Hub 迁移完成：统一 envelope `{"error":{"code":"...","message":"...","traceId":"..."}}`
- [x] Edge 域错误码 — 14 个 Edge 专属错误码（EXECUTOR_UNAVAILABLE 等）
- [x] Edge handlers 重构 — 删除 `errorResponse()`，52 个调用点改用 errcode
- [x] 前端适配 — `app/shared/src/errors.ts` 已兼容，零改动

### A1: 请求日志与追踪 `reqlog` ✅

- [x] `pkg/reqlog` 共享中间件 — trace ID 生成/传播，统一字段（request_id/method/path/status/duration_ms）
- [x] Edge 接入 — `reqlog.AccessLog` 替换现有 AccessLog 中间件
- [x] Hub 接入 — `reqlog.AccessLogGin()` 统一已有 RequestID + AccessLog
- [x] 跨服务追踪 — Edge→Hub API 透传 X-Request-ID（Hub RequestID 中间件复用）

### A2: 调试端点 `debug` ✅

- [x] `pkg/debug` 模块 — 统一注册接口 + 认证辅助（BasicAuth / BearerToken）
  - `MuxConfig` 结构体：HealthChecker / EnablePprof / MetricsHandler / ConfigDumper / StateDumper / Auth
  - `RegisterEndpoints(mux, cfg)` — 注册 /health, /ready, /debug/pprof/*, /metrics, /debug/config, /debug/state
  - `BasicAuth` + `BearerAuth` — 认证辅助 + `SanitizeConfig` 递归脱敏
  - 11 个测试覆盖全部端点 + 认证 + 脱敏
- [x] Hub `/debug/` — 用 pkg/debug 替换 `app.go` 的 `newAdminMux()`
  - 保留独立 admin 端口 + `AGENTHUB_PPROF_USER/PASS` BasicAuth 认证
  - 新增 `/debug/config` — SanitizeConfig 脱敏（DB/Redis/JWT/S3/TokenDanceID 各字段）
  - 新增 `/debug/state` — DB pool stats + WS connections
- [x] Edge `/debug/` — 在 `httpserver.Run()` 的 mux 上注册
  - 新增 pprof — dev 环境无认证，生产 BearerAuth(LocalAuthToken)
  - 新增 `/debug/config` — 脱敏（LocalAuthToken / HubJWTSecret / HubToken）
  - 新增 `/debug/state` — store 统计（project count）+ bus 状态（history_len）
  - 去重 `/metrics` — 统一走 debug 模块，带 auth 保护

### A3: 安全与稳定性 P0 修复 ✅

- [x] **Edge auth token 明文日志** — `slog.Info` → `slog.Debug`，前缀 16→8 字符
- [x] **Edge FileStore async persist** — 同步 persist → 异步 50ms debounce + background goroutine + `Close()`/`Flush()`
- ~~Hub workspace schema 不一致~~ — 验证 0016 migration 已完整桥接，误报关闭

### A4: 前端架构解耦 ✅

> **关键路径**: App.tsx 拆分是 Phase C (IM 闭环) 的前置条件。

- [x] **App.tsx 拆分 Wave 1** — 1837→1525 行（-17%），已拆出 ShellIconButton、useFocusSourceTracking、DesktopHubTaskBridge、TopMenuBar、useShellShortcuts
- [x] **lazy-load** — SettingsPage、AuthPage、HomeDashboard 已改为 `React.lazy()`
- [x] **Wave 2 拆分** — 1525→991 行（-35%），7 个自定义 Hook：
  - [x] `useHiddenMessages.ts` — 隐藏消息 ID 管理 30 行（低难度）✅
  - [x] `useSidebarResize.ts` — 侧边栏拖拽缩放 40 行（低难度）✅
  - [x] `useThreadCache.ts` — React Query 缓存操作 37 行 + 4 个 ref（低难度）✅
  - [x] `useTopMenuConfig.ts` — 菜单定义 221 行（低难度）✅
  - [x] `useDesktopCommands.ts` — 窗口/编辑/诊断命令 80 行（中难度）✅
  - [x] `useThreadNavigation.ts` — 线程选择/创建/搜索 75 行（中难度）✅
  - [x] `useSendRun.ts` — 发送/启动 run 116 行（高难度）✅
  - 执行顺序：E→F→G→A（阶段1低风险）→ D→C（阶段2）→ B（阶段3核心）
- [ ] **Rust 后端基础测试** — commands.rs / oidc_server.rs 核心路径覆盖

### A5: 开发者构建体验

- [x] 移除 keyring v4 重依赖（-213 crate）
- [x] Cargo dev profile 优化（`opt-level=1`）
- [x] 前端 vendor bundle 拆分
- [ ] Edge 自动构建 — `tauri dev` 检测 edge-server 变更自动 `go build`
- [ ] sccache / CI 缓存共享
- [ ] 开发文档 — 冷启动预期、前置依赖、troubleshooting

### A6: Review 发现的安全加固（新增）

> 来自 2026-06-05 五维度深度 Review + 七项深研。
> 优先级排序：API 密钥(P0) > 统一信封(P1) > DB TLS(P1) > .env 加固(P2)

- [ ] **API 密钥迁移到 secure_store** (P0 — 最高安全优先)
  - 当前: `modelSettingsStore.ts` 的 `obscureApiKey`/`revealApiKey`（base64 + 静态 salt `ah-creds-v1`，167-188 行）
  - 目标: `secure_store.rs` 已有 keyring 集成（当前仅存 Hub 令牌），新增 `store_model_credential`/`read_model_credential`/`clear_model_credential`
  - 迁移: Zustand store 初始化时检测 localStorage 旧格式 → 写入 keychain → 清除 localStorage
  - Web 端无 `ProviderCredential` 字段，不受影响
- [x] **统一响应信封** (P1 ✅ — Edge 对齐 Hub)
  - Edge `writeSuccess()` 包装 `{code,data}`
  - 前端 `unwrapEdgeResponse()` 双格式兼容
  - 错误格式已统一（`pkg/errcode`），成功格式已对齐
- [x] **DB TLS 可配置** (P1 ✅)
  - `SSLMode` 字段 + `AGENTHUB_DB_SSLMODE` 环境变量
  - 默认 `disable` 向后兼容，Validate 白名单
- [ ] **.env 密钥轮换 + secret guard 加固** (P2 — 增量改进)
  - 密钥轮换: 轮换 .env 中真实云服务密钥；`config.go` `Validate()` 扩展弱密码拒绝到 DB/Redis/TokenDanceID
  - pre-commit 加固: 新增 `scripts/git-hooks/pre-commit` 调用 `check-secrets.sh --staged`（当前仅在 commit-msg 运行）
  - Secret Guard 扩展: 增加 base64 解码检测、二进制密钥文件检测（`*.p12`/`*.jks`）

---

## Phase B: Edge 持久化 + 性能治理

> **目标**: Edge 从内存临时态升级到 SQLite 持久化；修复 Hub 性能瓶颈；大文件拆分提升可维护性
>
> **入场条件**: Phase A 出场（错误码 + 日志 + 调试 + P0 修复完成）
> **出场条件**: Edge 重启不丢数据 + FTS5 搜索；Hub 无 N+1 查询 + 全索引覆盖

### B0: Edge SQLite 持久化

当前 Edge 用内存 + JSON 快照（FileStore），重启丢数据、无搜索、无同步。升级为 `modernc.org/sqlite`（纯 Go，FTS5 内置，无 CGO）。

- [ ] JSONL 事件流 — append-only 日志替代 JSON 快照，写操作先 append 再更新内存
- [ ] SQLite Schema — projects / threads / runs / items 四张表 + 索引
  - 现有接口 `store.Reader` / `store.Writer` / `store.Repository` 保持不变，上层零改动
  - 当前内存结构：`map[string]*Project` + `map[string]*Thread` + `map[string]*Run` + `map[string]*Item`
  - FileStore 消费者：`api/handlers.go`（读写）、`lifecycle/process_executor.go`（写）、`events/bus.go`（读）
- [ ] FTS5 搜索 — `session_messages_fts` 虚拟表，BM25 排序，`snippet()` 高亮
- [ ] 数据迁移 — 启动时检测旧 JSON 快照，自动导入 SQLite
  - 回退方案：检测 SQLite 损坏时 fallback 到 JSON 快照或空 store

> 参考: `docs/archive/build-specs-backend-03-eventstore-memory.md`

### B1: Edge 离线与同步

- [ ] 离线队列 — Hub 断连时写操作入队，重连后批量同步
- [ ] Cursor 同步协议 — `?cursor=<last_seq>` 增量拉取

### B2: Hub 性能治理 🔧

- [x] **N+1 查询 — Session list correlated subquery** (`repository/session.go`)
  - `ListUserSessions` 和 `SearchSessions` → LEFT JOIN 批量查询
- [x] **N+1 查询 — StartTeamRun 逐条查 CustomAgent** (`service/agent_team.go`)
  - 批量查询 `WHERE id IN ?` + map 复用
- [x] **N+1 查询 — dispatchTask 逐次查 CustomAgent** (`service/agent.go`)
  - `TriggerAgentTask` 预查询，参数传入 `dispatchTask`
- [x] **缺索引 — GORM model 补 index tag** + Migration 0041
  - `agent_team_tasks.team_run_id`, `agent_team_assignments.team_run_id`, `notifications.user_id`
- [ ] **migration 双系统统一** — golang-migrate 唯一生产路径（`repository/migrate.go`），AutoMigrate 仅在测试中使用

### B3: 大文件拆分 🔧

- [x] **Hub agent.go** ✅ — 1371 行 → 5 个文件（同 package，无新接口）
  - `agent.go`(161) + `agent_custom.go`(91) + `agent_dispatch.go`(546) + `agent_edge_callback.go`(327) + `agent_run_event.go`(313)
- [ ] **Edge ProcessExecutor** — 1413 行 → 4 个文件（同 package，无新接口）
  - `process_executor.go` — 保留核心：struct + Start/Cancel/run + envForRun + finish + publishFailed/Cancelled（~500 行）
  - `process_output.go` — 输出聚合：publishOutput + publishStructuredOutput + runOutputLimiter + threadTranscriptEmitter（~250 行）
  - `process_hub_callback.go` — Hub 回调：fireHubAck/Stream/Done/Fail + hubCallbackEmitter + hubOutputCollector（~350 行）
  - `process_subagent.go` — 子 Agent 编排：SpawnSubAgent + sendSubAgentResult + childBudget（~170 行）

### B4: Edge 行为修正

- [ ] **双重 dispatch 路径统一** — `orchestrator.go` text scan + `orchestrator_dispatch.go` NDJSON event 两条路径 → 统一
- [ ] **Output 截断通知** — stdout/stderr 1MB 截断时发 `run.output.truncated` 事件

---

## Phase C: IM 核心闭环

> **目标**: 打通 IM 核心工作流，Desktop 前端可用，Agent 操作可视化
>
> **长期入场条件**: Phase B 出场（Edge 持久化完成 + App.tsx 已拆分）
> **比赛冲刺入场条件**: A4 已拆到足够降低冲突风险；C0/C1 可以并行推进，不等待 B0 SQLite 完成。当前 R2/R3/R4/R5/R6A 已有独立分支待 PR/合并，新的 agent 应先看“当前分支状态”再领取任务，避免重复开发。
> **出场条件**: 用户可以在 Desktop 中与 Agent 进行完整的 IM 对话；比赛版至少要能在群聊中 @Agent 触发真实任务，并在 IM 流中展示 Agent 任务、Tool/Diff/Thinking/Approval/Artifact 证据。
>
> 进度说明：Phase C 的 35% 是 `dev/delicious233` 主线保守口径，不把未合并分支提前算作完成。R2/R3/R4/R5/R6A 合并并补视觉 QA 后再重估；C0/C1 中未带“比赛 P0”或未映射到 R1-R7 的项目，默认排在比赛 Demo 之后。

### C0: 对话核心

- [ ] 对话列表 — 新建/置顶/归档/搜索，按最近活跃排序
- [ ] 单聊模式 — 选中联系人/Agent → 1v1 对话
- [x] **比赛 P0: 群聊 @Agent 分派** — `IMMessageInput` 已接入 `useMention` / `MentionPopover`，message payload 可携带 `mentions`；剩余验收是 Hub agent task / TeamRun 的真实 E2E transcript
- [x] **比赛 P0: IM 富消息投影** — `IMMessageView` 已通过 `IMBlockRenderer` 从纯 Markdown 升级为富消息流，支持 Agent task、Tool/Thinking、Diff/File change、Approval 摘要；剩余验收是 Artifact/Deploy 与主 Chat renderer 收敛
- [ ] 消息类型 — 文本、代码块、图片、文件附件、Diff 视图卡片、网页预览卡片；IM child/route/artifact/deploy block 已在 `phase-r3/transcript-contract` 分支可见化，待合并
- [ ] 消息操作 — 回复、引用、复制代码、展开预览
- [ ] 上下文管理 — 聊天历史自动传递，支持 pin 关键消息

### C1: Agent 可视化

- [ ] Agent 运行状态 — 思考中/工具调用中/生成中等实时指示；IM 发送 pending/failed 已在 `phase-r6/im-optimistic` 分支实现，待合并
- [x] 工具调用可视化 — IM 侧已有 compact Tool block；主 Chat 侧已有 ToolUseBlock/ToolGroup，后续做统一 renderer contract
- [x] 代码 Diff 内联 — IM 侧已有 compact Diff/file_change 展示；后续补语法高亮、虚拟化和 apply/discard 闭环
- [ ] 文件操作可视化 — Agent 读写文件的实时展示
- [ ] **比赛 P0: 多 Agent TeamRun transcript** — 群聊中两个真实 Runtime Profile 依次/并行回复，并保留可答辩的 route/task/event 证据
- [ ] 审批面板 — 高风险操作弹窗确认

### C2: 前端打磨

- [ ] 对话列表 UI — 未读计数、最后消息预览、在线状态
- [ ] 消息气泡 — 头像、时间戳、发送状态、Agent 标识；发送状态已在 R6A 分支覆盖 pending/failed，样式合并后再补视觉 QA
- [ ] 输入体验 — @Agent 弹窗选择、文件拖拽、快捷键
- [ ] 侧边栏 — 会话/联系人/Agent 商店导航
- [ ] 响应式适配 — 窄屏/宽屏自适应

### C3: Orchestrator 协调器

- [ ] 意图理解 + 任务拆解 — 群聊模式自动理解用户意图
- [ ] 子 Agent 调度 — 并行调度，失败降级
- [ ] 产出聚合 — 子 Agent 完成后在聊天流中汇报
- [ ] 冲突处理 — 多 Agent 修改同一文件时的冲突检测

---

## Phase D: 高级功能

> **入场条件**: Phase C 出场（IM 闭环可用）
> **目标**: 产品差异化与生态扩展

### D0: 代码生成与 API 契约

- [ ] OpenAPI spec → 类型生成 — 消除手工维护 openapi.yaml + types.ts 的漂移
- [ ] shared API client 共享 — desktop/web/mobile 统一 HTTP client

### D1: 安全增强

- [ ] Hub OIDC blacklist 写入失败补偿 — Redis 不可用时旧 refresh token 可被重放
- [ ] Edge `internal/runners` 死代码清理 — 仍在 `httpserver/server.go` 被 import
- [ ] Hub 端点加 `/v1/` 版本前缀（或显式文档声明策略）— 当前 Hub 用 `/client/`/`/edge/`/`/web/` 无版本
- [ ] Release workflow 加分支限制 — `release.yml` 任何分支推 `v*` tag 都触发发布
- [ ] 收紧 golangci-lint + gosec 为硬阻断 — 当前 `continue-on-error: true` 无约束力
- [ ] Tauri CSP 策略收紧 — `connect-src` 端口通配符改为具体端口（3210/8080），移除 `unsafe-inline`
- [ ] macOS CI 测试取消 `continue-on-error` — 或明确记录跳过原因
- [ ] 配置 Renovate/Dependabot + CODEOWNERS

### D2: 产品扩展

- [ ] 部署发布 — 聊天中"部署"指令，返回部署状态卡片
- [ ] Agent 商店 — 搜索、安装、使用自定义 Agent
- [ ] 版本历史 — Checkpoint + Diff 对比 + 回滚
- [ ] Mobile 轻量端 — 查看/审批/预览
- [ ] Content Pool — SHA-256 + zstd 文件内容去重
- [ ] 远程 Edge — SSH / Tailscale / Hub Relay 连接远程 Desktop

---

## Quick Wins

> 不依赖特定 Phase，发现即修。trivial 修复直接执行，无需等 Phase 排期。

- [x] ~~Desktop OIDC 超时不一致~~ — `CALLBACK_TIMEOUT_SECS` 60→300，对齐 "5 minutes" 消息
- [x] ~~Desktop Edge 端口硬编码~~ — 提取 `DEFAULT_EDGE_PORT` 常量（Rust 侧）
- [ ] 补齐 OpenAPI 缺失端点（文档-代码漂移）：
  - `GET /v1/model-catalog` — 代码已实现，OpenAPI 完全缺失
  - `GET /v1/agent-instances/{id}` — 代码已实现，OpenAPI 仅定义集合端点
  - `DELETE /v1/threads/{threadId}` — 代码已实现，OpenAPI 路径定义缺失（头注释提及但无路径）
  - `POST /v1/threads/{threadId}:archive` — 代码已实现，OpenAPI 标记 planned（不准确）
  - `POST /v1/agent-instances` — OpenAPI 标记 implemented 但代码只注册 GET（自相矛盾）
  - `POST /cloud/edge/register` — Hub 代码已实现（router.go:174），OpenAPI 完全缺失
  - `GET /client/auth/oidc/callback` — Hub 代码已实现（router.go:69），OpenAPI 缺失
- [ ] 修复事件文档漂移（events.md vs 代码）：
  - `run.agent.sub_agent_status` — 代码用此名，文档定义为 `sub_agents_complete`（语义不同）
  - `run.agent.task_dispatch_failed` — 代码中发布，events.md 完全缺失
  - `friend.accepted` — 文档列为可用事件，代码从未发布（缺 "not yet emitted" 标记）
  - `message.delta` — 文档标 P0 但从未实现，建议降级为 P1
- [ ] Web 包定位决策 — 当前 App.tsx 仅 13 行空壳，但基础设施 ~32K 行已就绪（~80%）
  - 推荐：轻量 wiring（5-8 天），接入 slot 机制 + Hub 连接 + IM 消息流，暂缓未实现功能

---

## 已完成

| 批次 | 内容 | 完成日期 |
|------|------|:-------:|
| P0-P3 | Edge 24 消息类型 + Markdown + 线程管理 + Bundle 优化 | 2026-05 |
| M3b | AgentHook + 消息树 + 安全管道 + Context Budget | 2026-05 |
| M4 | Hub 骨架 + OpenCode/Codex E2E + 权限门控 | 2026-05 |
| M5 | 工程基础收敛: Edge race/metrics, Hub DI, Desktop 虚拟滚动 | 2026-05-24 |
| M6 | 生产部署: Docker + nginx + Cloudflare + 安全加固 | 2026-05-24 |
| M7 | Desktop P0: TanStack Query + RunState + 心跳 + viewRegistry | 2026-05-24 |
| M8 | 安全审计: 129 Issues 修复，纯后端清零 | 2026-05-27 |
| W22 | Desktop UI 大打磨: 40+ 验收项，Mobile/Web 对齐 | 2026-05-30 |
| 文档体系 | ADR 11 篇 + 竞品调研 25 项目 + 架构三合一 | 2026-06-02 |
| v0.2.0 | Sidecar edge + Updater + NSIS/DMG + 安全加固 + CI 签名 | 2026-06-05 |
| 构建优化 | 去除 keyring turso/tantivy（-213 crate）+ dev profile + bundle 拆分 | 2026-06-05 |
| 架构剖析 | Edge / Desktop / Hub / 集成层全面审查，P0×4 + P1×8 + P2×6 | 2026-06-05 |
| 全局死链清理 | 20 文件 docs/tutorials→docs/roadmap 等路径修复 + 端口 5199→5173 | 2026-06-05 |
| 错误码统一 (Hub) | pkg/errcode 共享模块 + Hub re-export + 统一 envelope + traceId | 2026-06-05 |
| 安全修复 | Orchestrator bypassPermissions 硬编码移除 | 2026-06-05 |
| **A0 Edge errcode** | 14 域错误码 + 52 handlers 调用点重构 + 前端已兼容 | 2026-06-05 |
| **A1 请求日志** | pkg/reqlog + Edge/Hub 接入 + context ID 传播 + 6 tests | 2026-06-05 |
| **A3 P0 安全** | Auth token Debug 日志 + FileStore async persist (50ms debounce) | 2026-06-05 |
| **A2 调试端点** | pkg/debug 共享模块 + Hub/Edge 统一注册 + health/pprof/metrics/config/state + 11 tests | 2026-06-05 |
| **A4 Wave 2 complete** | App.tsx 1525→991 (-35%)，7 hooks 全部拆出 + block key 稳定化 | 2026-06-05 |
| **A6.2 统一信封** | Edge writeSuccess + unwrapEdgeResponse 双格式兼容 | 2026-06-05 |
| **A6.3 DB TLS** | AGENTHUB_DB_SSLMODE 环境变量 + Validate 白名单 | 2026-06-05 |
| **B2 N+1 修复** | Session list/StartTeamRun/dispatchTask + Migration 0041 索引 | 2026-06-05 |
| **Sprint #4 Tool 打磨** | Tool 卡片颜色编码（5 类）+ 标题语义化 | 2026-06-05 |
| **前端 P0 execCommand** | copy/cut/paste → Clipboard API + Selection API | 2026-06-05 |
| **前端 P0 Mock+iframe** | Agent Market mock→Coming Soon + iframe sandbox 移除 same-origin | 2026-06-05 |
| **前端 P1 z-index** | 16 处硬编码 z-index → CSS 变量层级 | 2026-06-05 |
| **前端 P1 console** | 30 处 console.error 残留清理 | 2026-06-05 |
| **Sprint #1 IM @Agent** | 群聊 @Agent 分派 — useMention + MentionPopover + mention 编解码 | 2026-06-05 |
| **Sprint #2 IM 富消息** | IMBlockRenderer — Tool/Diff/Thinking/Approval 投影到 IM 聊天流 | 2026-06-05 |
| **Quick Wins** | OIDC 超时 60→300 + DEFAULT_EDGE_PORT 常量提取 | 2026-06-05 |
| **五维 Review** | 架构/API/前端/后端/DevOps 深度审查，新增 A6 安全加固 + D1 补充 | 2026-06-05 |
| **七项深研** | A2 调试端点方案 + B2 性能治理定位(N+1×3+索引+迁移双系统) + B3 大文件拆分(process_executor→4文件, agent→5文件) + Quick Wins(OpenAPI 7缺口+事件漂移3项+Web包决策) | 2026-06-05 |
| **比赛评审评估** | 6 维度全评(AI协作22/30+功能15.5/25+生成效果12/20+代码理解12/15+创新8/10，总分69.5/100) + 竞品动态调研(Codeg/Cursor3.2/Copilot SDK/Claude Agent View/Devin ACP) + 提分路径 + Demo 3 分钟策略 | 2026-06-05 |
| **前端深度审计** | P0×5+P1×29+P2×19 问题清单；IM/主聊天双系统分离、右侧面板 Diff/Preview/Tool/Artifact 逐组件审计；Sprint #1/#2 已关闭 IM @Agent/富消息核心缺口，剩余转入 Desktop 重组路线 | 2026-06-05 |

> 详细历史见 [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

---

## 比赛评审维度评估

> 2026-06-05 基于代码实证 + 竞品对比的预估得分。总分满分 100。

| 维度 | 权重 | 预估得分 | 关键发现 |
|------|:----:|:-------:|---------|
| AI 协作能力 | 30% | **22/30** | 结构化委派+IM 双模独有；七层 guardrails 业界唯一；短板：Edge/Hub 双轨未统一(-2)、无跨 Run 记忆(-1)、故障恢复不完整(-1) |
| 功能完整度 | 25% | **15.5/25** | P0 执行闭环 80%、P1 IM 55%、P2 Hub 35%；核心短板：TeamRun E2E 未打通(-3)、Edge 无持久化(-2)、P2 远程场景未实现(-2) |
| 生成效果 | 20% | **12/20** | Diff 基础可用但无语法高亮(-2)、Tool Call 7/10、流式仅文本块级非 token 级且 Codex 无流式(-2)、Artifact 正则提取脆弱(-1)、Preview 无 dev server(-2) |
| 代码理解 | 15% | **12/15** | AGENTS.md 渐进式加载竞品独一无二；workspace fail-closed 领先；MCP 仅 Server 端缺 Client(-1)、Skill 仅 Codex 格式(-1)、上下文预算未可视化(-1) |
| 创新与产品感 | 10% | **8/10** | IM-native 多 Agent "无人竞争"(UNCONTESTED)；三层架构本地优先独树一帜；Agent Profile 四层模型比竞品成熟；短板：多 Agent IM 交互缺原型验证(-1)、Profile 配置界面未落地(-1) |

**总分：69.5/100** | AI协作22 + 功能15.5 + 生成效果12 + 代码理解12 + 创新8 = 69.5

### 比赛提分关键路径（按性价比排序）

1. **IM @Agent + TeamRun E2E**（+3~4 分，~3 天）— 核心差异化唯一证据；必须在 IM 群聊里由 @Agent 触发真实 Runtime Profile 协作，而不只是 TeamRun 设置页/后端模型
2. **IM 富消息 + 生成效果可视化**（+2 分，~2 天）— Tool/Thinking/Diff/Approval/Artifact 必须进入聊天流；评审看到的是产物，不是后端 JSON 字段
3. **Edge SQLite 持久化 B0**（+1~2 分，~3 天）— Demo 经得起重启；但只在 IM/TeamRun 最小闭环后推进
4. **Preview / Diff 稳定渲染**（+1.5 分，~1.5 天）— Diff 高亮、Artifact/Preview 入口、null/long-output 防崩溃
5. **部署态 Hub smoke 或明确本地 Demo caveat**（+1 分，~1 天）— 如果 Demo 走 Hub/Web，补 login/session/WS auth/task stream；如果只走 Desktop 本地，提交材料要明确边界
6. **Edge→Hub 模式统一**（+2 分 AI 协作，~5 天）— 长期正确，但比赛前只做会暴露在 Demo 中的路径

### 竞品威胁更新（2026-06-05）

| 竞品 | 威胁级别 | 关键动态 |
|------|:-------:|---------|
| **Codeg v0.14.7** | **HIGH** | 最接近 AgentHub 的开源项目——多 CLI Agent 聚合 + Telegram/Lark IM + 多 Agent 协作 |
| **Claude Code Agent View** | **MEDIUM→HIGH** | 从单 Agent 演进到多 Session 管理面板；/bg 后台派遣 |
| **Cursor 3.2** | HIGH | /multitask 异步子代理 + /best-of-n 多模型并行 + Cursor SDK |
| **GitHub Copilot SDK** | HIGH | 6 语言 SDK GA + Sub-agents + Cloud Automations + Copilot Memory |
| **CodeBanana** | MEDIUM | 商用发布"群聊+Agent+Workspace"，36 氪获奖 |
| **Devin Desktop + ACP** | MEDIUM | Windsurf 更名为 Devin Desktop，发布 Agent Client Protocol |

**核心差异化窗口在缩窄**：IM 多 Agent 不再无人竞争。剩余壁垒：Tauri 2 原生桌面 + Hub-Edge-Runner 分布式 + 开源社区

### 调整建议

- 飞书/Telegram IM 桥接从 P1 提升为 **P0 加速**（Codeg 已证明可行）
- 新增 **Agent Adapter SDK** 为 P0（参考 Copilot/Cursor SDK，降低第三方 CLI 接入门槛）
- 新增 **后台 Agent 调度器** 为 P1（Claude Code /bg、Codex Goal Mode、Copilot Automations 成为标配）

### Demo 3 分钟策略

- **场景**：三 Agent（Architect/Builder/Reviewer）协作修复 Dashboard 性能问题，三种 Runtime 各司其职
- **时间轴**：开场钩子(25s) → Claude Code 分析+审批(30s) → Codex 执行+Diff(35s) → OpenCode 审查+聚合(40s) → 总结对比(50s)
- **三个最亮点**：(1) Thinking 面板+审批弹窗 (2) Diff 内联+FileChangeGroup (3) 三 Agent 产出聚合
- **P0 打磨项**：BlockRenderer 6 个 null case(~30 行) + Agent Profile 预设(~50 行) + @mention Runtime 信息(~20 行) + Diff 稳定渲染(~30 行)

| 层 | 技术 | 存储 | 代码量 | 测试 |
|----|------|------|--------|------|
| Desktop | React 19 + Tauri 2 + Zustand + TanStack Query | 平台 Credential Store | Rust 2,113 行 / TS ~45 组件 | `pnpm test && pnpm typecheck` |
| Edge Server | Go + gorilla/websocket + NDJSON | **JSON 快照 → SQLite + FTS5** | 15,509 行 | `go test ./... -short -race` |
| Hub Server | Go + Gin + GORM + Redis + PG | PostgreSQL 16 | ~46,000 行 | `go test ./... -short -race` |
| 协议 | REST JSON + WebSocket NDJSON | — | OpenAPI 5,590 行 | — |
| CI | GitHub Actions (Win + macOS) | — | — | `scripts/verify-ci-gates.ps1` |

---

## Desktop 前端深度审计

> 2026-06-05 基于竞品对比 + 代码实证的深度审查。聚焦 ChatView/IM/渲染/交互四大方向。
> 综合评分：**4.5/10** — 核心功能可用但体验粗糙，多处开发态残留和交互 Bug。
>
> 状态校准：本节是审计快照，不是最新待办清单。Sprint #1/#2/#4 和前端止血已关闭一批旧缺口；当前执行以“Desktop 重组路线”和 Phase C 勾选状态为准。

### P0 问题清单（阻断级）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 1 | **ChatView.tsx 1786 行单文件巨石** | `components/ChatView.tsx` | 可维护性极差，任何改动都有连锁风险 |
| 2 | **运行状态三源同步** | `App.tsx` + `useChatMessages.reducer` + `runStore` | 同一 Run 状态分散 3 处，任一同步遗漏导致 UI 卡死/显示错误 |
| 3 | ~~**block key 依赖 index 不稳定**~~（已关闭） | ChatView `blockKey()` | block key 稳定化已进入完成历史；后续只回归验证流式不闪烁 |
| 4 | ~~**Agent Market 硬编码 Mock 数据**~~（已关闭） | `AgentMarketSection.tsx` | 已改为 Coming Soon / 非欺骗性状态；后续不作为比赛阻断 |
| 5 | ~~**已弃用 `document.execCommand`**~~（已关闭） | `App.tsx`, `clipboard.ts` | 已替换为 Clipboard API + Selection API |

### P1 问题清单（体验级）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 6 | memo 签名过于简化，只比长度和标志位 | `messageBlockSignature` | 内容变化但签名相同时丢失更新 |
| 7 | scroll-to-bottom 3 次 setTimeout + double rAF | ChatView 滚动逻辑 | CPU 飙升、布局抖动 |
| 8 | 在线状态双重维护（3 处） | `connectionStore` + `useChatMessages` + `App.tsx` | 短暂不一致导致连接 banner 闪烁 |
| 9 | Agent 切换每次创建新线程 | `App.tsx:521-533` | 误点产生大量空线程；catch 创建空字符串映射 |
| 10 | ~~z-index 硬编码违规~~（已关闭） | 多文件 | 16 处硬编码 z-index 已迁移到 CSS 变量层级；后续只做 visual regression |
| 11 | 亮色主题 CSS 定义不完整 | `themes.css` | `[data-theme="light"]` 缺完整变量块 |
| 12 | ~~console.log/error 生产残留~~（已关闭） | 多文件 | 30 处 console.error 残留已清理；后续新增代码继续禁止生产噪音 |
| 13 | `useHubStore.authenticated` 永远恢复 false | `hubStore.ts:17-18` | Hub 认证状态被拆分到两个不通信的模块 |
| 14 | 右侧面板在窄屏突然消失无通知 | `App.tsx:311` | `runCardConstrained` 隐藏面板但无解释 |
| 15 | Tool 结果统一截断无差异化 | `ToolUseBlock` | Bash/Diff/图片无区别展示，竞品按 toolKind 定制 |
| 16 | Diff 无语法高亮 | DiffViewer/DiffCard | 竞品 Jean/CCUI 均有 Prism/Shiki 高亮 |
| 17 | 虚拟滚动 estimateSize 静态值 | ChatView | 消息高度偏差大时滚动位置跳动 |
| 18 | Thread 删除后无自动导航 | ThreadPanel | 删除当前 thread 后用户卡在空白 |
| 19 | **IM 和主聊天是完全分离的两套系统** | `useIMChat.ts` vs `useChatMessages.ts` | 零代码共享，Edge→Hub 路径完全不同 |
| 20 | ~~**群聊 IM 无 @Agent 分派能力**~~（已关闭） | `IMMessageInput` | 已接入 `useMention` / `MentionPopover`；剩余是 mentions 到真实 TeamRun 的 E2E 证据 |
| 21 | IM 消息无乐观更新 | `useIMChat.sendMessage()` | REST 确认后才显示，发送有感知延迟 |
| 22 | Diff 大文件无虚拟化 | DiffViewer + DiffReviewPanel | 10000+ 行 diff 全量 DOM 渲染，卡顿 |
| 23 | ~~iframe sandbox 同时允许 scripts+same-origin~~（已关闭） | ArtifactPreview/ArtifactCard/ArtifactBrowser 三处 | 已移除 same-origin；后续只回归 preview 可用性 |
| 24 | Diff 解析逻辑重复两份 | `shared/diff.ts` + `desktop/utils/parseGitDiff.ts` | 同名 `parseUnifiedDiff` 实现不同，边缘 case 行为分歧 |
| 25 | 嵌套 Tool 调用无层级渲染 | `ToolUseBlock` 只有 `children: ToolResultBlock[]` | 无递归渲染，子工具被扁平化 |
| 26 | Artifact 正则提取仅支持英文 | `ArtifactBrowser.tsx:125-143` | 中文/JSON 输出的文件路径完全丢失 |
| 27 | Blob URL 内存泄漏 | `ArtifactBrowser.tsx:558-570` | 下载后不 revokeObjectURL |
| 28 | Tool 参数无深度截断 | `ToolGroup.tsx:162` JSON.stringify 无 max depth | 嵌套/base64 数据爆 DOM |
| 29 | 右侧面板 resize 功能未实现 | `useSidebarResize.ts` 只处理 left | rightPanelWidth 存了但没应用 |
| 30 | `summarizeInput` null input 崩溃 | `ChatView.tsx:110`, `ToolGroup.tsx:63` | WebSocket 畸形 tool_use 事件 input:null 导致渲染 crash |
| 31 | `capOutputText` 静默丢弃输出头部 | `useChatMessages.ts:128-133` | >20K 字符输出只保留尾部，无截断提示 |
| 32 | `hasVisibleBlock` 缺 `tool_group` 分支 | `ChatView.tsx:1079-1108` | 潜在 Bug：若 tool_group 被持久化/回放，整条消息消失 |
| 33 | `mergeBlock` O(n²) 数组分配 | `useChatMessages.ts:93-109` | 高频流式时每次 delta 复制全量 blocks，GC 压力大 |
| 34 | tool_group 内联合成每次渲染创建新对象 | `ChatView.tsx:1188-1206` | 已沉淀消息也不跳过，BlockRenderer memo 失效 |
| 35 | `AgentTextBlock` 未 memo 化 | `ChatView.tsx:247-287` | 流式输出时每个 RAF tick 重新解析/渲染 Markdown |
| 36 | scroll-to-bottom 3 次延时覆盖用户滚动位置 | `ChatView.tsx:1410-1430` | 用户上滑查看历史时被强制滚回底部 |

### P2 问题清单（打磨级）

| # | 问题 | 文件 |
|---|------|------|
| 30 | 缺少 Markdown 数学公式支持（竞品 CCUI 有 remarkMath + rehypeKatex） | MarkdownRenderer |
| 31 | 无消息骨架屏/Streaming ticker（竞品 Jean 有 CompactStreamingTicker） | ChatView |
| 32 | Tool 标题 `summarizeInput` 截断到 40 字符（竞品 Kanna 按 toolKind 生成语义标题） | ToolUseBlock |
| 33 | PromptInput 1522 行未 memo 包装 | PromptInput.tsx |
| 34 | useChatMessages 1485 行单一 hook 职责过重 | hooks/useChatMessages.ts |
| 35 | useIMChat 1297 行单一 hook | hooks/useIMChat.ts |
| 36 | ~~App.tsx 1190 行，A4 Wave 2 还剩 2 个 hook~~（已关闭） | App.tsx |
| 37 | 懒加载组件 fallback 为 null | AuthPage/HomeDashboard/SettingsPage |
| 38 | Toast store nextId HMR 时可能重置 | toastStore.ts |
| 39 | 装饰性 Nav 按钮无功能 | `App.tsx:1049-1052` |
| 40 | Diff 长行无 word-break 水平溢出 | DiffViewer.tsx |
| 41 | Diff focusedFilePath 用 endsWith 子串匹配 | DiffReviewPanel.tsx |
| 42 | Artifact HTML 分类靠路径启发式 | ArtifactBrowser.tsx |
| 43 | IM 消息搜索完全缺失 | useIMChat 无搜索 |
| 44 | IM 群聊 leave/dissolve/成员管理 API 存在但无 UI 按钮 | IMView |
| 45 | Typing indicator API 存在但从未调用 | HubWSHandle.sendTyping() |
| 46 | Diff Accept/Reject 仅 UI 状态无持久化 | DiffViewer.tsx |
| 47 | 面板关闭动画 220ms 内可能闪更新内容 | App.tsx:349-356 |
| 48 | iframe retry 不换 URL 大概率重复失败 | ArtifactPreview.tsx |

### IM 工作流完整性评估

> 两条消息系统对比：主聊天（Edge 驱动）vs IM 聊天（Hub 驱动）

| 能力 | 主聊天 (Edge) | IM 聊天 (Hub) | 差距 |
|------|:-----------:|:-----------:|------|
| 消息发送/接收 | ✅ REST+WS 流式 | ✅ REST+WS（无流式） | IM 侧无流式渲染 |
| @Agent 分派 | ✅ useMention 完整 | ✅ useMention + mentions payload | 已关闭；待真实 Hub/TeamRun transcript 证明 |
| Agent Profile 选择 | ✅ MentionPopover | ✅ MentionPopover | 已关闭；待 Profile/Runtime/Target 信息在 IM 中更清晰 |
| Tool Call 可视化 | ✅ ToolUseBlock+ToolGroup | ✅ IMBlockRenderer compact Tool | 基础完成；待统一 renderer contract |
| Diff 内联 | ✅ DiffCard | ✅ compact Diff/file_change | 基础完成；待语法高亮、虚拟化和 apply/discard |
| 思考过程展示 | ✅ ThinkingBlock | ✅ collapsible Thinking | 基础完成；待主 Chat/IM 视觉一致 |
| 子 Agent 卡片 | ✅ ChildAgentBlock+RouteDecision | ❌ 不存在 | **核心缺失** |
| 群聊创建 | N/A | ✅ createGroupSession | IM 独有 |
| 好友/联系人 | N/A | ✅ listContacts+好友请求 | IM 独有 |
| 未读计数 | ✅ badge | ✅ unreadCount | 对等 |
| 消息搜索 | ✅ MessageSearchPanel | ❌ 缺失 | IM 缺失 |
| 乐观更新 | ✅ 流式即时 | 分支待合并 | R6A 已实现 pending/failed 气泡；合并和截图后关闭 |
| 审批 | ✅ PermissionDialog+ApprovalCard | ✅ TeamApprovalPanel | 两条路径不一致 |
| TeamRun | N/A | ✅ 4-tab console（Member/Task/Approve/Event） | IM 侧更完整 |

**核心问题更新：IM 已不再是纯文字聊天。比赛剩余风险是 @Agent mentions 到真实 Hub/TeamRun 派发的 E2E transcript、主 Chat/IM 渲染合同合并验证、审批路径不一致，以及右侧 Inspector 证据面板与 transcript 同屏后的视觉 QA。**

### 竞品关键差距（AgentHub vs 标杆）

| 维度 | AgentHub | 竞品标杆 | 差距 |
|------|---------|---------|------|
| Chat 组件分层 | ChatView.tsx 单文件 1786 行 | Jean 70+ 文件、Kanna ChatPage+TranscriptViewport+20 消息组件 | 架构差距巨大 |
| block key 稳定性 | `text-${index}` | CCUI `WeakMap+Set` 稳定 key；Kanna ID-based key | 流式闪烁根因 |
| 虚拟滚动 | useVirtualizer + 3次 scrollToBottom + 手动 ResizeObserver | Kanna LegendList `maintainScrollAtEnd` 零手动代码 | 滚动体验差 |
| Tool 渲染 | switch-case 硬编码 | CCUI ToolRenderer 配置驱动注册表 | 扩展性差 |
| Diff 语法高亮 | 无 | CCUI Prism+oneDark、Jean 自定义 | 完全缺失 |
| Tool 标题 | 截断 40 字符 | Kanna 按 toolKind 语义化（"Find \`pattern\` in files"） | 可读性差 |
| 消息预处理 | 无（运行时内联分组） | Kanna `buildTranscriptRenderItems` 两阶段预处理 | 渲染层复杂 |
| Tool 颜色编码 | 无 | CCUI 按类别左边框色标（edit=amber, bash=green, agent=purple） | 视觉扫描差 |

### 前端修复优先路线（按性价比排序）

**Phase 0 — IM 核心打通（已完成 2/4，剩余转入 Desktop 重组）— 比赛核心差异化**

1. ~~**IM 聊天集成 Agent 分派**~~ — 已接入 useMention + Agent Profile 选择；下一步验证群聊中 @Agent 触发真实任务
2. ~~**IM 消息支持富类型渲染**~~ — 已通过 IMBlockRenderer 支持 Tool/Diff/Thinking/Approval；下一步做共享 block contract
3. **IM 消息乐观更新** — sendMessage 发送前先插入 optimistic message
4. **统一主聊天与 IM 审批路径** — Edge permission + Team approval 合并为一致体验

**Phase 1 — 紧急止血（主要已关闭，剩余进入 R2-R6）**

5. ~~**修复 block key 稳定性**~~ — 已关闭；后续截图/单测回归
6. ~~**清理 Mock 数据**~~ — 已关闭；AgentMarketSection 不再展示欺骗性 mock
7. ~~**替换 `document.execCommand`**~~ — 已关闭；改用 Clipboard API + Selection API
8. ~~**z-index 统一到 tokens.css**~~ — 已关闭；后续新增 CSS 必须继续用层级变量
9. ~~**修复 iframe sandbox**~~ — 已关闭；移除 `allow-same-origin`
10. **Diff 语法高亮** — DiffViewer 接入 react-syntax-highlighter (Prism)

**Phase 2 — 架构重构（本月，~7 天）**

11. **拆分 ChatView.tsx** — 提取 ChatMessageList、ChatScrollBehavior、ChatConnectionBanner（参考 Jean 70+ 文件拆法）
12. **统一运行状态** — 消除三源同步，runStore 为唯一权威
13. **引入消息预处理层** — 参考 Kanna `buildTranscriptRenderItems`，在渲染前合并 tool group
14. **简化 scroll-to-bottom** — 评估 LegendList 替代 tanstack virtual
15. **合并 Diff 解析** — 统一 parseUnifiedDiff 为一份实现

**Phase 3 — 体验增强（下月，~5 天）**

16. **Tool 渲染配置化** — 参考 CCUI `toolConfigs` 注册表
17. **Tool 卡片颜色编码** — 参考 CCUI 左边框色标
18. **Tool 标题语义化** — 参考 Kanna 按 toolKind 生成
19. **Artifact 提取改结构化** — 从正则迁移到 tool output metadata
20. **右侧面板 resize 实现** — useSidebarResize 补全 right 侧逻辑
