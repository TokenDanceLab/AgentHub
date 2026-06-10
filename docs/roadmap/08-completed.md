# 08 — 已完成归档

> 2026-06-10 · 以下任务已全部完成，从主 README 移出存档。

---

## Wave 1 已完成

| # | 任务 | 完成时间 | 证据 |
|---|------|----------|------|
| W1-1 | 消息回复 + 引用 + 重新生成 | 2026-06-10 | commits `a22b5f65` `9ddd6f70` — ReplyToContext、Composer 回复预览、blockquote 渲染、onRegenerate 灰显 |
| W1-3 | 消息搜索跳转 + 未读清零 + WS 状态指示 | 2026-06-10 | scrollIntoView 高亮、auto markRead effect、connectionStatus 三色灯 |
| W1-4 | StepCard 可视化 | 2026-06-10 | RunStepGroupTranscriptBlock 可折叠步骤卡片组件 |
| W1-5 | 重新生成管线 | 2026-06-10 | Hub re-trigger API + onRegenerate 回调 + 流式替换 |
| W1-7 | cc-switch 别名 + Tauri Desktop 编译 | 2026-06-10 | cc-switch reader.go ✅ · `AgentHub_0.3.0-rc.7_x64-setup.exe` 14MB |

## Wave 2 已完成

| # | 任务 | 完成时间 | 证据 |
|---|------|----------|------|
| W2-1 | i18n 完整国际化 | 2026-06-10 | commit `636f0b39` — TasksPage/AgentsPage/RightInspector 已接线 |
| W2-3 | 通讯录增强 + 云文档 CRUD | 2026-06-10 | commit `00e0aefd` — 好友请求卡片、文档删除修复 |

## Wave 3 已完成

| # | 任务 | 完成时间 | 证据 |
|---|------|----------|------|
| W3-1 | hk2 服务器部署 | 2026-06-10 | Hub Docker + Edge systemd + nginx `/edge/` 反代 + SSL |
| W3-2 | 安全扫描 + 文档 | 2026-06-10 | gitleaks 扫描零新增泄露、`tests/results/` 已 gitignore、API key 已轮换 |

## 基础设施

| 项目 | 状态 |
|------|------|
| Edge 重建 + CC CLI 真实执行 | ✅ auth fix 验证通过，run status=finished |
| Demo 模式→Edge API | ✅ demo 模式从 Edge 读真实数据，fallback mock |
| Hub→Edge HTTP dispatch | ✅ commit `924de9aa` — Hub POST /v1/runs 到 Edge |
| Claude Code adapter 深度 | ✅ NDJSON 流式解析、session 管理、env passthrough、cc-switch 集成 |
| Codex/OpenCode adapter | ✅ env passthrough、cc-switch 路由 |
| Anthropic SDK adapter | ✅ HTTP SSE 流式解析 |
| Skill 8 + MCP 6 Market | ✅ DB seed（migration 0050） |
| 右侧栏 13/13 格式预览 | ✅ PDF/MD/Code/HTML/图片/PPTX/Excel/DOCX 全部组件已创建 |
| DagTree | ✅ ul/li 树组件 |
| AgentStreamingBar | ✅ WS 事件订阅 |
| Orchestrator 增强代码 | ✅ 4 文件已写（failure_degradation/sibling_context/plan_approval/context_compactor）— 待运行验证 |
| 安全钩子 | ✅ 23-check 管线（363 行） |
