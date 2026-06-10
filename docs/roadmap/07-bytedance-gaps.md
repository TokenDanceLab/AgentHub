# 07 — bytedance.md 对照缺口

> 2026-06-10 · 逐条对照比赛课题 `bytedance.md` 全部要求
> 标记：✅ 已覆盖 | ⚠️ 部分 | ❌ 缺失 | (P2) 标 P2 的不强制

---

## 1. IM 聊天式交互（核心体验）

| 子项 | 要求 | 状态 | 证据 / Roadmap |
|---|---|---|---|
| 对话列表 | 新建/置顶/归档/搜索，按最近活跃排序 | ⚠️ | 有 session CRUD。**缺：置顶排序、归档 UI** |
| 单聊模式 | 1v1 与单个 Agent 对话 | ✅ | private session |
| 群聊模式 | @多 Agent，Orchestrator 自动分派，依次回复 | ✅ | group session + orchestrator dispatch |
| 文本消息 | — | ✅ | Hub message API 完整 |
| 代码块 | — | ✅ | CodeBlock + MarkdownRenderer |
| **图片** | 消息类型含图片 | ❌ | **缺** — Hub attachment API 完整（probe/upload/download），但前端 Composer 没有图片入口 |
| **文件附件** | 消息类型含文件附件 | ❌ | **缺** — 同上，attachment 管线在但前端未接线 |
| 网页预览卡片 | — | ⚠️ | ArtifactBrowser 有 web category，缺自动 inline 预览卡 |
| Diff 视图卡片 | — | ⚠️ | DiffViewer 有，但缺 accept/reject 接线（已在 [01-pipeline #2](01-pipeline.md)） |
| **部署状态卡片** | 消息类型含部署状态卡片 | ❌ | **缺** — 无部署闭环 |
| **消息回复** | 回复 | ❌ | **缺** — Hub message API 有但前端回复 UI 不完整 |
| **消息引用** | 引用 | ❌ | **缺** — 同上 |
| **重新生成** | 重新生成 Agent 回复 | ❌ | **缺** — 无此功能 |
| 复制代码 | — | ✅ | CodeBlock 已有 |
| **一键应用 Diff** | — | ❌ | **缺** — 需要管线 [01-pipeline #2](01-pipeline.md) 配合 |
| 展开预览 | — | ✅ | PreviewPanel 有 |
| 上下文管理 | pin 关键消息作为长期上下文 | ✅ | Hub message pin API 完整 |

---

## 2. 主 Agent 协调器（Orchestrator）

| 子项 | 要求 | 状态 | 证据 / Roadmap |
|---|---|---|---|
| 自动理解意图 → 拆解 | — | ⚠️ | dispatch scan from CLI NDJSON。缺结构化规划。 [06-orchestrator #4](06-orchestrator-enhancement.md) |
| 分派给子 Agent | — | ✅ | `dispatchInterceptor.handleDispatch()` |
| 聚合产出 → 聊天流汇报 | — | ✅ | `runResultListener` + `emitProgressSummary` |
| **并行调度** | 支持并行调度 | ✅ | 10 并发 goroutine fan-out |
| **失败降级** | 支持失败降级 | ❌ | **缺** — [06-orchestrator #1](06-orchestrator-enhancement.md) P0 |
| **代码冲突处理** | 支持代码冲突处理 | ❌ | **缺** — [06-orchestrator #2](06-orchestrator-enhancement.md) P0 |

---

## 3. 多 Agent 接入

| 子项 | 要求 | 状态 | 证据 / Roadmap |
|---|---|---|---|
| 统一适配器层 | — | ✅ | 6 adapters（Claude Code/Codex/OpenCode/Anthropic SDK/OpenAI SDK/Orchestrator） |
| 至少接入 2 个 | Claude Code + Codex / OpenCode | ✅ | 全部 3 个 |
| **用户自建 Agent（对话式创建）** | 对话式创建，设定 System Prompt + 工具集 | ❌ | **缺** — 只有表单配置（CustomAgentCreator 5 步向导），不是对话式 |
| Agent 显示为联系人 | 头像、名称、能力标签 | ⚠️ | WorkbenchAgent 类型有，但能力标签（capability tags）未在 UI 展示 |

---

## 4. 产物预览与编辑

| 子项 | 要求 | 状态 | 证据 / Roadmap |
|---|---|---|---|
| 内联产物预览卡片 | 网页 iframe、文档渲染 | ⚠️ | ArtifactBrowser 有但格式少。 [03-right-panel](03-right-panel.md) 全格式覆盖 |
| 点击展开全屏预览 | — | ⚠️ | PreviewPanel 只有 image/web。 [03-right-panel](03-right-panel.md) 补 |
| 代码编辑器 | — | ✅ | CodeBlock + Monaco（已有） |
| (P2) PPT 浏览 | PPT 浏览 | ❌ | **P2** — [03-right-panel #6](03-right-panel.md) |
| (P2) Diff 视图 | — | ✅ | DiffViewer 已有 |
| **(P2) 版本历史** | 版本历史 | ❌ | **P2，缺** — 无 artifact 版本管理 |
| **(P2) 对话式局部修改** | 选中代码→聊天描述修改 | ❌ | **P2，缺** — 无此功能 |

---

## 5. 部署发布（P2）

| 子项 | 要求 | 状态 | 证据 / Roadmap |
|---|---|---|---|
| (P2) 部署指令 | 聊天中发送"部署" | ❌ | **P2，缺** — 无 |
| (P2) 部署状态卡片 | — | ❌ | **P2，缺** — 无 |
| (P2) 一键预览 URL | — | ❌ | **P2，缺** — 无 |
| (P2) 静态站点部署 | — | ❌ | **P2，缺** — 无 |
| (P2) 容器化部署 | — | ⚠️ | Docker compose 生产部署已有，但不是"一键 Agent 部署" |
| (P2) 源码打包下载 | — | ❌ | **P2，缺** — 无 |

---

## 6. 多端支持（P2）

| 子项 | 要求 | 状态 | 证据 |
|---|---|---|---|
| (P2) Web 端 | 主力端，完整 IM + 代码编辑 + 全功能 | ✅ | app/web |
| (P2) 桌面端 | 本地文件访问、系统通知、Agent 进程管理 | ✅ | Tauri Desktop (72 Rust 文件) |
| (P2) 移动端 | 轻量 IM：查看对话、审批确认、产物预览 | ✅ | Tauri Android (app/mobile-rn) |

---

## 考核维度检查

| 维度 | 权重 | 相关 Roadmap |
|---|---|---|
| **AI 协作能力** 30% | Spec/Skill/Rules 沉淀 | ⚠️ 有 11 ADR + skills + .agents/，但**缺 AI_COLLABORATION.md 证据包导出** — 竞品 Queena/DDJH44 有标准格式 |
| **功能完整度** 25% | IM 体验 + 多 Agent 调度跑通 | ⚠️ 缺：消息引用/重新生成/图片附件、对话式创建 Agent、失败降级、代码冲突 |
| **生成效果质量** 20% | 聊天 UI + 产物预览 | ⚠️ 缺：PPT/DOCX/PDF 预览、版本历史、对话式局部修改(P2) |
| **代码理解度** 15% | 答辩解释架构 | ✅ 有 design-decisions + 11 ADR |
| **创新与产品感** 10% | 超预期功能/体验/产品设计方案 | ⚠️ 三端原生是超预期的，但缺演示面包装 |
| **交付物** | 产品设计文档 + 技术文档 + 可运行 Demo + AI 协作记录 + 3 分钟视频 | ❌ 缺 AI 协作记录 + 视频 |

---

## 仍未进入 Roadmap 的缺口

| # | 缺口 | 优先级 | 为什么之前没入 |
|---|---|---|---|
| 1 | **消息引用/回复/重新生成** | P0 | 改动在 Composer + Transcript 层，之前"不动聊天流"原则过滤掉了。但这是比赛核心体验第 1 条（消息操作） |
| 2 | **图片/文件附件在聊天中** | P1 | Hub attachment 管线和 API 全有，缺 Composer 照片入口 + 消息气泡内嵌渲染。改动 Composer 边界 |
| 3 | **对话式创建 Agent** | P1 | 比赛明确写"对话式创建"。表单创建有，对话式要新聊天流 |
| 4 | **(P2) 部署发布** | P2 | 标了 P2 所以之前放下个版本 |
| 5 | **(P2) 版本历史 + 对话式局部修改** | P2 | 同上 |
| 6 | **AI_COLLABORATION.md** | P0 | 考核维度 30% 的交付物，竞品有标准格式 |
| 7 | **Agent 能力标签在联系人 UI** | P1 | WorkbenchAgent 有类型但能力标签未在 UI 渲染 |

---

## 更新 Roadmap 入口

把缺口 #1（消息引用/回复/重新生成）和 #6（AI_COLLABORATION.md）加入 P0。这两个是：
- #1 考核维度 25%（IM 体验流畅度）+ 比赛明确列在"消息操作"第一行
- #6 考核维度 30%（AI 协作能力）+ 交付物明确列在第 5 个

底线：对话式创建 Agent 和图片附件涉及改 Composer，如果"不动聊天流"原则不能破，可以在答辩时诚实说明"表单创建已完整，对话式创建在路线图上"——然后补 #1（消息引用/回复）作为 IM 完整度的补救。
