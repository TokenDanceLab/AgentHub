<!--
  ⚠ ARCHIVED — HISTORICAL REFERENCE ONLY
  This document has been archived from docs/reference/.
  It represents completed research/analysis and is NOT actively maintained.
  The information here may be outdated. Refer to docs/reference/ for current reference material.
  Archived: 2026-06-17
-->

# 00 — 现有资产与缺口

> 新 Agent 或开发者开始任何工作前，先读此文确认基线。
> 详细架构背景见 [architecture.md](../architecture.md)。
> 运行状态见仓库根 `STATE.md`。

---

## 关键数字

| 指标 | 值 |
|---|---|
| Hub REST 端点 | 100+（50 migrations） |
| WS 事件类型 | 32 |
| Edge Adapters | 6（Claude Code / Codex / OpenCode / Anthropic SDK / OpenAI SDK / Orchestrator） |
| Security Hooks | 23-check 管线（363 行） |
| AgentTeam 端点 | 22（Team + Run + Route + Approval + Conflict + Assignment） |
| MCP Server 端点 | 7（CRUD + publish + unpublish） |
| Transcript Block 类型 | 22+ |
| Shared workbench 子页 | 7（chat/contacts/docs/agents/runs/projects/settings） |
| Desktop 组件 | 100+（含 settings 全套 30+ 节） |
| Web 组件 | 26 |

## 数据流三层

| 模式 | 说明 |
|---|---|
| Mock (demo) | JS 内存数据，零依赖。Demo 模式已工作。|
| Observed | Edge API 只读观察。`verify-real-api-smoke.ps1` 44/44 通过。|
| Approved-Real | 真实 Hub+Edge+CLI。Claude Code + OpenCode 真实执行已验证。|

## 当前未接通 gap（主 roadmap 2.2 节）

| 缺口 | 影响 | 阻塞位置 | 路线图覆盖 |
|---|---|---|---|
| **失败降级** | Orchestrator 子任务失败后无恢复机制 | 管线 | [06 Orchestrator #1](06-orchestrator-enhancement.md) |
| **代码冲突处理** | 多 Agent 并行写同文件时冲突 | 管线 | [06 Orchestrator #2](06-orchestrator-enhancement.md) |
| **Plan 确认门** | 无用户审批 plan 直接执行 | 管线 | [06 Orchestrator #3](06-orchestrator-enhancement.md) |
| **消息引用/回复/重新生成** | IM 消息操作不完整 | UI（Composer 边界） | [02 轻 UI](02-light-ui.md) #9, #10, #13 |
| **AI_COLLABORATION.md** | 缺 30% 考核维度的关键交付物 | 文档 | Release Gate |
| **对话式创建 Agent** | 比赛明确要求"对话式创建" | UI（新聊天流） | Release Gate |
| 图片/文件附件在聊天中 | IM 不能发图片/文件 | UI + 管线 | [03 右侧栏](03-right-panel.md) #6 |
| 消息搜索点击导航 | 搜索结果无法跳转原始消息 | UI 层 | [02 轻 UI](02-light-ui.md) #2 |
| 进入会话后未读清零 | 需手动清除 | UI 时序 | [02 轻 UI](02-light-ui.md) #3 |
| WS 断线重连事件不丢 | 重连后可能遗漏事件 | UI + 管线 | [01 管线](01-pipeline.md) #3 |
| 连接状态指示器 | 用户无法感知 WS 状态 | UI 渲染 | [02 轻 UI](02-light-ui.md) #4 |
| 移动端应用打包 | 手机适配未完成 | 跨端工程链路 | [05 Release](05-release-gates.md) |
| Tool allowlist 运行时强制 | Edge 不强制过滤工具 | 运行时 | [01 管线](01-pipeline.md) #7 |
| Artifact/Diff apply/revert | 只读展示，未写文件 | 管线 | [01 管线](01-pipeline.md) #2 |
| Artifact/Preview 预览格式 | 只展示图片/网页，缺文档格式 | UI + 管线 | [03 右侧栏](03-right-panel.md) |
| Agent 运行过程可视化 | 聊天流里看不到 Agent 执行步骤 | UI | [02 轻 UI](02-light-ui.md) #1 + #5 |
| 多模态消息/文件上下文 | IM 纯文本，无法发图片/文件 | UI + 管线 | [03 右侧栏](03-right-panel.md) #6 |

## 竞品威胁基线

| 排名 | 仓库 | 威胁 | 与我们差距 |
|---|---|---|---|
| 1 | GuqierMcl | 🔴 Very High（唯一还在建核心功能的） | SDK-first adapter 深，我们 CLI 解析广 |
| 2 | Queena1021 | 🟠 High（最完整答辩武器包，已冻结） | StepCard/Surfacing 我们没有 |
| 3 | doloveplayer | 🟠 High（DAG 编排+ADR 最强，已冻结） | DAG 可视化我们没有 |
| 4 | SeiyunSky | 🟡 Med-High（7 视频碾压我们 1 截图） | 演示材料差距最大 |
| 5 | DDJH44 | 🟡 Med-High（IM 最完整+6 部署+PPT） | IM 完成度差距大 |
