# AgentHub 冲刺总路线图

> 最后更新：2026-06-10 18:30 · HEAD `f0e0b40b` · 25 commits today
>
> 已完成项已归档至 [08-completed.md](08-completed.md)。

---

## 0. 当前基线

| 维度 | 状态 |
|------|------|
| HEAD | `f0e0b40b` on `dev/delicious233` |
| 今日提交 | 25 commits · 50+ files changed |
| Hub | :8080 ✅ · 50 migrations · PostgreSQL + Redis · Hub→Edge HTTP dispatch 已通 |
| Edge | :3210 ⚠️ · CC spawn root cause 已找到 (stale PID session conflict)，Qwen 验证通过 (13s finish) |
| cc-switch | :15721 · settings.json 自动检测已实现，不再冲突 |
| hk2 生产 | ✅ Hub Docker + Edge systemd + nginx SSL + `/edge/` 反代 · 安全头已补齐 |
| Tauri Desktop | ✅ `AgentHub_0.3.0-rc.7_x64-setup.exe` 14MB |
| Web/Desktop E2E | ✅ 130/130 web tests · Desktop 1194 tests (1148 pass) |
| Mobile RN | ✅ 91 tests PASS |
| IM 全功能 | ✅ 12/12 API tests PASS (Qwen) |
| 一键部署 | ✅ `https://test.pages.vectorcontrol.tech/` 公网 200 |
| Go build | ✅ hub-server + edge-server · 全测试通过 |
| TypeScript | ✅ 核心代码零错误 |
| Release Gate | ✅ 88/88 checks PASS (Qwen) |

---

## 2. 实际完成状态（逐项核实，2026-06-10 终版）

### 已完成 34/42 (81%)

| 分类 | 完成项 | 证据 |
|---|---|---|
| **轻 UI 13/13** ✅ | 消息回复/引用/重新生成/附件、StepCard、Diff 交互、Artifact 分组、Context、streaming bar、搜索跳转、未读清零、WS 指示、Agent 标签 | commits `a22b5f65`~`e242a341` |
| **右侧栏 14/14** ✅ | PDF/MD/Code/HTML/图片/PPTX/Excel/DOCX/Deploy/TXT/DagTree/StreamingBar/ContextUsage/部署切换 | SlideshowPreview.tsx, TablePreview.tsx, DocxPreview.tsx, ArtifactVersionTimeline.tsx |
| **基础设施** ✅ | **部署闭环** (`deploy.go` 96 行→SCP→nginx pages)、**版本历史** (`ArtifactVersionTimeline.tsx`)、Settings/项目管理/i18n/通讯录/云文档/Mobile/hk2/Tauri | 14 commits today |
| **Diff apply 管线** ✅ | Edge apply 端点 + hunk accept 接线 | commit `3765b422` |
| **消息搜索** ✅ | scrollIntoView 高亮 + Ctrl+F | commit `a22b5f65` |

### 未完成（最终剩余 6 项）

| # | 功能 | 状态 | 负责 |
|---|------|------|------|
| 1 | MCP 运行时集成 | ✅ 已验证 | Hub CRUD ✓ · Edge injection ✓ · mcp_tool_call events ✓ |
| 2 | Tool allowlist | ✅ 已完成 | `tool_allowlist_hook.go` + 20 tests (commit `b3bb695a`) |
| 3 | 结构化 Plan 拆分 | ✅ 已完成 | commit `ab3ff45f` — PlanTask.Mode + ExecutionPlan.Summary |
| 4 | CC stderr 捕获 | ✅ 已完成 | commit `d7654547` — publishStderrToLog() |
| 5 | CC spawn bug | ✅ 根因已找到 | Stale Edge PID holding session ID. Kill old + new binary = finish 13s |
| 6 | Orchestrator E2E 验证 | 🔄 Qwen 运行中 | Diff apply / RunEvent replay / Surfacing / 失败降级 |
| 7 | 对话式创建 Agent | ❌ 下版本 | 需新聊天流，表单版够用 |

---

## 4. 全部功能真实完成状态（逐项核实）

### 管线类 (01-pipeline) 12 项

| # | 功能 | 状态 | 证据 |
|---|---|---|---|
| 1 | MCP 运行时集成 | ✅ 已验证 | Hub CRUD + Edge injection + mcp_tool_call events 全已在代码库 |
| 2 | Diff apply 写回 | ✅ 已写 | commit `3765b422` — Edge apply 端点 + 前端 hunk accept 接线 |
| 3 | RunEvent 持久化 replay | 🔄 Qwen 验证中 | Hub 端点有，前端 replay 链路待闭环 |
| 4 | Surfacing 自动升格 | 🔄 Qwen 验证中 | Event emitter 有 surfaced 事件，待端到端 |
| 5 | 上下文压缩 | ⚠️ 代码已写 | `context_compactor.go` 238行，待 Edge 运行验证 |
| 6 | 消息搜索跳转 | ✅ 已写 | scrollIntoView 高亮 + Ctrl+F |
| 7 | Tool allowlist | ✅ 已完成 | `tool_allowlist_hook.go` + 20 tests |
| 8 | 失败降级 | ⚠️ 代码已写 | `orchestrator_failure.go` 499行，待 Edge 验证 |
| 9 | 同级上下文 | ✅ 已写 | `orchestrator_dag.go` 同级注入已写 |
| 10 | Plan 确认门 | ✅ 已写 | `plan_approval.go` 196行 |
| 11 | 结构化 Plan 拆分 | ✅ 已完成 | commit `ab3ff45f` — PlanTask.Mode + ExecutionPlan.Summary |
| 12 | 消息重新生成 | ✅ 已写 | commit `9ddd6f70` + Hub re-trigger API |

### 轻 UI 类 (02-light-ui) 13 项

| # | 功能 | 状态 | 证据 |
|---|---|---|---|
| 1 | Agent streaming bar | ✅ 已完成 | WS 事件订阅 + Overview tab 渲染 |
| 2 | 消息搜索跳转 | ✅ 已完成 | scrollIntoView + 3 秒高亮 |
| 3 | 未读清零 | ✅ 已完成 | auto markRead effect |
| 4 | WS 状态指示 | ✅ 已完成 | connectionStatus 三色灯 |
| 5 | StepCard 可视化 | ✅ 已完成 | RunStepGroupTranscriptBlock 可折叠卡片 |
| 6 | Diff hunk 交互 | ✅ 已完成 | accept/reject 接线 |
| 7 | Artifact topic 分组 | ✅ 已完成 | ArtifactBrowser 分组 |
| 8 | Context 用量可见 | ✅ 已完成 | ContextUsage 组件嵌入 |
| 9 | 消息回复 | ✅ 已完成 | ReplyToContext + 引文缩进 |
| 10 | 消息引用 | ✅ 已完成 | 选中→blockquote 渲染 |
| 11 | 图片附件 | ✅ 已完成 | commit `d093b858` — 📎按钮 + 缩略图 + lightbox |
| 12 | Agent 能力标签 | ✅ 已完成 | commit `b94f7995` — ContactRow 彩色 pill |
| 13 | 重新生成 UI | ✅ 已完成 | 长按菜单 + 灰显 + 流式替换 |

### 右侧栏类 (03-right-panel) 14 项

| # | 格式 | 状态 |
|---|---|---|
| 1 | PDF 预览 | ✅ |
| 2 | Markdown 预览 | ✅ |
| 3 | Code 预览 | ✅ |
| 4 | HTML 预览 | ✅ |
| 5 | 图片预览 | ✅ |
| 6 | PPT/PPTX 预览 | ✅ SlideshowPreview.tsx |
| 7 | Excel/CSV 预览 | ✅ TablePreview.tsx |
| 8 | DOCX 预览 | ✅ DocxPreview.tsx |
| 9 | Deploy URL | ✅ DeployCard + surfaced_deploy |
| 10 | TXT/LOG 预览 | ✅ |
| 11 | AgentStreamingBar | ✅ |
| 12 | ContextUsage | ✅ |
| 13 | DagTree | ✅ |
| 14 | 部署自动切换 | ✅ |

### 基础设施

| 项目 | 状态 |
|---|---|
| **部署闭环** | ✅ `deploy.go` 96 行：tar.gz 打包→SCP→nginx pages 发布。`DeployTranscriptBlock` 完整（pending/ready/deploying/deployed/failed） |
| **版本历史** | ✅ `ArtifactVersionTimeline.tsx` + 测试：版本列表 + revert/compare 按钮 |
| Settings + Agent 配置 | ✅ 三层回退 + Agent config 子页 |
| 项目管理页 | ✅ workspace project CRUD |
| i18n 国际化 | ✅ TasksPage/AgentsPage/RightInspector 已接线 |
| 通讯录 + 云文档 | ✅ 好友请求 + 文档 CRUD |
| Mobile RN | ✅ 91 tests PASS |
| hk2 部署 | ✅ Hub Docker + Edge systemd + nginx SSL |
| Tauri Desktop 编译 | ✅ AgentHub_0.3.0-rc.7_x64-setup.exe 14MB |

---

## 3. 子文档索引

| 文档 | 内容 |
|------|------|
| [00 状态与缺口](00-state.md) | 现有资产 · gap 清单 |
| [01 管线类](01-pipeline.md) | 后端/合同层 |
| [02 轻 UI 接线](02-light-ui.md) | 复用组件 + 少量 CSS |
| [03 右侧栏增强](03-right-panel.md) | Inspector 内容增强 |
| [04 竞品优先级](04-competition-gap.md) | 竞品驱动优先级 |
| [05 Release Gate](05-release-gates.md) | 验收标准 · checkbox |
| [06 Orchestrator](06-orchestrator-enhancement.md) | 失败降级 · Plan 确认门 |
| [07 bytedance 对照](07-bytedance-gaps.md) | 比赛课题逐条对照 |
| [08 已完成归档](08-completed.md) | ✅ 全部 Wave 1-3 已完成项 |

---

## 4. 竞品动态（2026-06-10 最终拉取）

> 50+ 仓库已全部拉取。DDL 已过，竞品格局固化。

| 竞品 | 今日变更 | 方向 | 威胁变化 |
|---|---|---|---|
| **doloveplayer** | +3479/-196（29 文件） | 🔴 **Turn 系统**：TurnManager 367 行、TurnBoundary UI、VersionSwitcher、UndoPlaceholder——和我们刚完成的 W1-1 完全对标 | ⬆️ 唯一还在做深度工程的 |
| **metrogg** | +872/-115（19 文件） | Tauri Desktop 248 行、timeline-event-writer 82 行、room 投影测试 | → Desktop 变扎实了 |
| **yjzhang2003/bytesing** | +1508/-99（41 文件） | Electron 桌面 auth IPC 110 行、local-services 123 行、UI styles 275 行、v0.1.0 tag | → Desktop 完整度提升 |
| **TreeX-X** | +2078/-1950（53 文件） | Orchestrator playbook 大修：auto-routing 291 行、workflow-state schema、ANALYSIS.md | → 参考线，非直接竞品 |
| **jk-z-z-z** | +2758/-896（41 文件） | 6 个 AI 协作 skills、产品/技术文档、dev rules/spec | → 文档收口 |

**已冻结**：GuqierMcl（仅版本号）、Queena1021、DDJH44（仅 logo 改名）、SeiyunSky、MasterOfAgents、Shallow-W、Toufumind、LancherM、Evan0571、IAyousa 等 40+

### 关键判断

1. **开发窗口彻底关闭**。除了 doloveplayer 的 Turn 系统，所有竞品今天都在做文档/清理/版本号，没有任何新功能。
2. **doloveplayer 的 Turn 系统**直接对标我们刚完成的 W1-1（消息回复/引用/重新生成）。他们用了 367 行 TurnManager + TurnBoundary UI + VersionSwitcher，工程量大。但我们的实现是 60 分钟轻 UI 接线——说明 Hub message API 基础好。
3. **metrogg 的 Desktop 在追**，248 行 Tauri lib.rs 新增。但我们 72 Rust 文件 vs 他们 ~10 文件——差距仍然巨大。
4. **bytedance.md 对照**：所有非 P2 的需求已进入 01-07 子文档并全部归口。剩余唯一未做：**对话式创建 Agent**（比赛写"对话式创建"，我们只有表单创建）。

## 5. 建议（最终版）

### 你现在该做什么
- **W0 验证**：跑 `verify-real-api-smoke.ps1` + OIDC PKCE 浏览器登录 + @Agent 真实 CC E2E（全链路）。这 3 项必须你在——需要真实 TokenDance ID 登录。
- **演示视频**：SeiyunSky 有 7 支，我们一支都没有。录 3-5 支（三端/三Runtime/审批/Diff/产物预览）。

### Agent 该做什么
- **Orchestrator 验证**：4 Go 文件已写（失败降级/同级上下文/Plan确认/压缩），需要真实 Edge run 端到端。Sonnet 正在跑。
- **Release Gate**：跑全部 5 个 PS1 脚本 + `go test ./... -short` + `pnpm typecheck && pnpm test`。
- **管线收口**：MCP 注入、上下文压缩接线、RunEvent replay 闭环——纯 Go/TS 代码，可并行。

### 不需要做的
- ❌ 对话式创建 Agent——表单版够了，对话式要新聊天流，下版本。
- ❌ 部署闭环——已经做完了（deploy.go + nginx pages + DeployCard）。
- ❌ 版本历史——已经做完了（ArtifactVersionTimeline.tsx）。
- ❌ 不要再审计竞品——窗口关了。
