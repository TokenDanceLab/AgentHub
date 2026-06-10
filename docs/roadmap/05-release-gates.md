# 05 — 收口标准与 Release Gate

> 每条功能完成 = 满足验收标准 + 通过对应门禁。
> 用 `- [ ]` 打钩追踪进度。

---

## 数据模式验收阶梯

```
Mock 验收 (demo data 走通)
  → Observed 验收 (真实 API 只读，verify-real-api-smoke.ps1)
  → Approved-Real 验收 (真实 TokenDanceID + Hub + Edge + CLI + 脱敏证据)
```

不同功能要求不同阶梯。

---

## 管线类（01-pipeline）验收门

| # | 功能 | Mock | Observed | Approved-Real |
|---|---|---|---|---|
| 1 | MCP 运行时集成 | MCP 配置注入 → 工具调用渲染 | Claude Code 真实 MCP 调用成功 | — |
| 2 | Diff apply 写回 | Hunk accept → 文件变更 | 真实 Edge apply 端点通过 | — |
| 3 | RunEvent 持久化 replay | Demo 会话刷新恢复 | Hub replay API 拉取成功 | — |
| 4 | Surfacing 自动升格 | Mock 文件产出 → 预览卡出现 | 真实 Edge 检测文件路径正确 | — |
| 5 | 上下文压缩 | 模拟超长对话 → 压缩触发 | — | — |
| 6 | 消息搜索跳转 | Demo 搜索结果点击跳转 | Hub 搜索 API 返回正确 offset | — |
| 7 | Tool allowlist | 非白名单工具被拒绝 | — | — |
| 8 | 失败降级 | 子 agent crash → 3 次重试 → LLM 决策 replan → 上报 | 真实 Edge agent crash 后自动恢复 | — |
| 9 | 同级上下文 | 3 worker 并发 → 每个 prompt 含同级边界警告 | 真实 Edge 3 agent 并发，文件冲突归 0 | — |
| 10 | Plan 确认门 | 群聊 PlanCard → 用户确认 → 分发 | 真实 Hub WS plan.proposed + plan:approve 闭环 | — |
| 11 | 结构化 Plan | LLM 拆解 → 结构化 dispatch schema | 真实 Edge orchestrator 输出验证 | — |
| 12 | 消息重新生成 | 用户点重新生成 → Hub 重新 dispatch → 新回复覆盖 | Hub re-trigger API 通过 | — |

- [x] 全部 Mock 模式通过
- [ ] 全部 Observed 模式通过
- [ ] `verify-real-api-smoke.ps1` 新 phase 全部通过
- [x] `go test ./... -short` hub-server + edge-server 通过
- [x] `pnpm typecheck` app/ 通过

## 轻 UI 类（02-light-ui）验收门

| # | 功能 | Mock | Observed |
|---|---|---|---|
| 1 | Agent streaming bar | 2 Agent 并发 → 状态条正常 | — |
| 2 | 消息搜索跳转 | 点击 → 聊天区滚动+高亮 | Hub 搜索 API 通过 |
| 3 | 未读清零 | 进会话 → 3 秒内清零 | — |
| 4 | WS 连接指示 | 断线/重连/正常 三色正确 | 真实 WS 事件验证 |
| 5 | StepCard 可视化 | Orchestrator 任务 → 卡片展开/折叠 | — |
| 6 | Diff hunk 交互 | Accept/reject → 状态更新 | 与管线 #2 联动验证 |
| 7 | Artifact topic 分组 | 多产物 → 按 topic 分组展示 | — |
| 8 | Context 用量可见 | 对话中 → Overview 进度条正确 | — |
| 9 | 消息回复 | 长按消息 → 回复模式 → 引文缩进渲染 | — |
| 10 | 消息引用 | 选中文本 → 引用发送 → blockquote 渲染 | — |
| 11 | 图片附件 | 选图片 → 上传 → 消息气泡嵌入预览 | — |
| 12 | Agent 能力标签 | 联系人列表 → 每个 Agent 旁显示彩色能力标签 | — |
| 13 | 重新生成 | 长按 → 重新生成 → 新回复流式替换 | — |

- [ ] 全部 Mock 模式通过（11/13 已合入：#1-2, #4-6, #8-12）
- [ ] Desktop dev server (5173) 手动走通所有路径
- [ ] Web dev server (5174) 手动走通
- [x] `pnpm typecheck` app/ 通过
- [ ] `pnpm test` app/ 通过（不改 UI 测试的情况下）

## 右侧栏类（03-right-panel）验收门

| # | 格式 | Mock | Observed |
|---|---|---|---|
| 1 | PDF 预览 | 点击 .pdf → iframe 渲染 | — |
| 2 | Markdown 预览 | 点击 .md → MarkdownRenderer | — |
| 3 | Code 预览 | 点击 .ts → CodeBlock | — |
| 4 | HTML 预览 | 点击 .html → iframe srcDoc | — |
| 5 | 图片预览 | 点击 .png → lightbox | — |
| 6 | PPT/PPTX 预览 | `pptxjs` 解析 → canvas 翻页正确 | 真实 Agent 生成 .pptx → 预览 |
| 7 | Excel/CSV 预览 | SheetJS 解析 → 表格渲染 | 真实 Agent 生成 .xlsx → 预览 |
| 8 | DOCX 预览 | mammoth 转 HTML → 正确 | 真实 Agent 生成 .docx → 预览 |
| 9 | Deploy URL | 部署成功 → Browser tab 切换 | — |
| 10 | AgentStreamingBar | 同 02 #1 | — |
| 11 | ContextUsage | 同 02 #8 | — |
| 12 | DagTree | AgentTeam 任务 → 树渲染 + 状态图标 | — |
| 13 | 部署自动切换 | Agent 部署成功 → URL 自动打开 | — |

- [x] 全部 Mock 模式通过
- [ ] Desktop dev server (5173) 手动走通所有格式
- [x] `pnpm typecheck` app/ 通过
- [ ] `pnpm test` app/ 通过

## Release Gate（最终发布门）

```powershell
# CI 门
.\\tests\\scripts\\verify-ci-gates.ps1

# 真实 API smoke
.\\tests\\scripts\\verify-real-api-smoke.ps1

# Approved-Real 金链路
.\\tests\\scripts\\verify-p0-approved-real-gold-path.ps1 -RepoRoot .

# OIDC 登录
.\\tests\\scripts\\verify-token-dance-id-login-readiness.ps1 -RepoRoot .

# Release 门
.\\tests\\scripts\\verify-release-gate.ps1
```

- [ ] 全部 gate 脚本通过
- [x] `go test ./... -short` 全部 Go 测试通过
- [x] `pnpm typecheck && pnpm test` 前端通过
- [ ] 3-5 支演示视频录制完成（需你操作）
- [ ] 5-7 张截图导出（Desktop/Web/产物/审批/DAG）
- [ ] 一份 AI 协作证据包导出（AI_COLLABORATION.md）

---

## 不适用此 Gate 的项目

以下为主 roadmap 中标注但不在上述列表中的项目，原因已注明：

| 项目 | 原因 |
|---|---|
| 对话式创建 Agent | 需要新聊天交互流，排在下一版本 |
| 模型预算分配 UI | 需要新 settings 面板 |
| 部署闭环 UI | 需要新 settings 面板 |
| Android APK 构建 | 缺构建环境 |
| macOS unsigned path | 缺硬件 |
| Codex CLI 真实执行 | 缺 `OPENAI_API_KEY` |
| SDK 真实 API 消耗 | 缺 API key |
| 多模态消息 | 需要改 Composer（违反"不动聊天流"原则） |

---

## 整体进度追踪

- [ ] 管线类 12/12 Mock + Observed 双模式通过（Mock ✅，Observed 待完成）
- [ ] 轻 UI 类 13/13 Mock 模式通过（11/13 已合入）
- [x] 右侧栏类 13/13 Mock 模式通过
- [ ] Release Gate 6/6 脚本通过（2/6 Go test + pnpm typecheck/test 通过）
- [ ] 演示材料（截图 + 视频 + AI 协作证据包）
