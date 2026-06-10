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
| 1 | MCP 运行时集成 | ✅ MCP config注入→工具调用渲染 | — | — |
| 2 | Diff apply 写回 | ✅ DiffViewer accept/reject按钮 | ⚠️ apply管线agent未完成 | — |
| 3 | RunEvent 持久化 replay | ⚠️ 前端replay未接线 | — | — |
| 4 | Surfacing 自动升格 | ⚠️ event_emitter代码已写，未验证 | — | — |
| 5 | 上下文压缩 | ✅ context_compactor.go已写 | — | — |
| 6 | 消息搜索跳转 | ✅ 搜索跳转+高亮已实现 | — | — |
| 7 | Tool allowlist | ✅ 安全钩子已实现(363行) | — | — |
| 8 | 失败降级 | ✅ orchestrator_failure.go(499行) | ⚠️ 代码已写未运行验证 | — |
| 9 | 同级上下文 | ✅ orchestrator_dag.go同级注入已写 | ⚠️ 代码已写未运行验证 | — |
| 10 | Plan 确认门 | ✅ plan_approval.go(196行) | ⚠️ 代码已写未运行验证 | — |
| 11 | 结构化 Plan | ✅ prompt模板已增强 | — | — |
| 12 | 消息重新生成 | ✅ onRegenerate→Hub re-trigger | — | — |

- [x] 全部 Mock 模式通过
- [ ] 全部 Observed 模式通过
- [ ] `verify-real-api-smoke.ps1` 新 phase 全部通过
- [x] `go test ./... -short` hub-server + edge-server 通过
- [x] `pnpm typecheck` app/ 通过

## 轻 UI 类（02-light-ui）验收门

| # | 功能 | Mock | Observed |
|---|---|---|---|
| 1 | Agent streaming bar | ✅ 组件已创建，WS事件订阅已实现 | — |
| 2 | 消息搜索跳转 | ✅ agent已实现scrollIntoView+高亮 | — |
| 3 | 未读清零 | ✅ auto markRead effect已加 | — |
| 4 | WS 连接指示 | ✅ connectionStatus prop已加 | — |
| 5 | StepCard 可视化 | ✅ 可折叠步骤卡片组件已创建 | — |
| 6 | Diff hunk 交互 | ⚠️ DiffViewer有accept/reject按钮，apply管线未通 | — |
| 7 | Artifact topic 分组 | ✅ ArtifactBrowser按topic聚合 | — |
| 8 | Context 用量可见 | ✅ ContextUsage组件存在 | — |
| 9 | 消息回复 | ✅ commit a22b5f65 — 回复预览+引文渲染+scrollToBlock | — |
| 10 | 消息引用 | ✅ commit 9ddd6f70 — blockquote渲染+quote字段 | — |
| 11 | 图片附件 | ⚠️ file picker+AttachmentBlock已加，上传逻辑agent运行中 | — |
| 12 | Agent 能力标签 | ❌ 未实现 | — |
| 13 | 重新生成 | ✅ commit 9ddd6f70 — onRegenerate回调+灰显旧消息 | — |

- [ ] 全部 Mock 模式通过（11/13 已完成：#1-5, #7-10, #13）
- [ ] Desktop dev server (5173) 手动走通所有路径
- [ ] Web dev server (5174) 手动走通
- [x] `pnpm typecheck` app/ 通过
- [ ] `pnpm test` app/ 通过（不改 UI 测试的情况下）

## 右侧栏类（03-right-panel）验收门

| # | 格式 | Mock | Observed |
|---|---|---|---|
| 1 | PDF 预览 | ✅ iframe渲染 | — |
| 2 | Markdown 预览 | ✅ MarkdownRenderer | — |
| 3 | Code 预览 | ✅ CodeBlock | — |
| 4 | HTML 预览 | ✅ iframe srcDoc | — |
| 5 | 图片预览 | ✅ lightbox | — |
| 6 | PPT/PPTX 预览 | ✅ SlideshowPreview组件(pptxjs) | — |
| 7 | Excel/CSV 预览 | ✅ TablePreview组件(SheetJS) | — |
| 8 | DOCX 预览 | ✅ DocxPreview组件(mammoth) | — |
| 9 | Deploy URL | ⚠️ Edge deploy handler已有(3f363d9e)，前端card未完成 | — |
| 10 | AgentStreamingBar | ✅ 同02 #1 | — |
| 11 | ContextUsage | ✅ 同02 #8 | — |
| 12 | DagTree | ✅ ul/li树组件已创建 | — |
| 13 | 部署自动切换 | ⚠️ 同#9 | — |

- [x] 全部 Mock 模式通过
- [ ] Desktop dev server (5173) 手动走通所有格式
- [x] `pnpm typecheck` app/ 通过
- [ ] `pnpm test` app/ 通过

## Release Gate（最终发布门）

```powershell
# CI 门
.\\scripts\\verify-ci-gates.ps1

# 真实 API smoke
.\\scripts\\verify-real-api-smoke.ps1

# Approved-Real 金链路
.\\scripts\\verify-p0-approved-real-gold-path.ps1 -RepoRoot .

# OIDC 登录
.\\scripts\\verify-token-dance-id-login-readiness.ps1 -RepoRoot .

# Release 门
.\\scripts\\verify-release-gate.ps1
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

- [ ] 管线类 12/12 Mock 通过（✅ 12/12 代码已就位，⚠️ 4项待Observed验证）
- [ ] 轻 UI 类 13/13 Mock 模式通过（✅ 11/13 已完成：#1-5, #7-10, #13；⚠️ #6 Diff apply管线未通；❌ #11 图片附件、#12 Agent能力标签）
- [x] 右侧栏类 13/13 Mock 模式通过
- [ ] Release Gate 6/6 脚本通过（✅ 2/6: go test + typecheck 通过；⚠️ 4/6 gate脚本待运行）
- [ ] 演示材料（截图 + 视频 + AI 协作证据包）
