# AgentHub 功能收口 Roadmap

> 2026-06-10 · 基于 11 个竞品深度审计 + 现有代码审计
> 原则：**UI 是最贵的，管线我能秒搞定。** 本文按新 UI 需求分层排序。

---

## 0. 现有资产速查（后端/管线已就绪）

| 层 | 已有 | 代码位置 |
|---|---|---|
| Transcript 合同 | 22+ 种 Block 类型（StepCard 抽象已存在：`RunStepGroupTranscriptBlock`） | `app/shared/src/transcript/types.ts` |
| Edge Adapter | 6 个：Claude Code / Codex / OpenCode / Anthropic SDK / OpenAI SDK / Orchestrator | `edge-server/internal/adapters/`（42 文件） |
| Security Hooks | 363 行 23-check 管线 | `edge-server/internal/adapters/security_hooks.go` |
| Orchestrator | 640 行 + 141 行 dispatch | `edge-server/internal/adapters/orchestrator*.go` |
| Hub REST | 100+ 端点（含 MCP CRUD、Attachment、Skill、AgentTeam、Market） | `hub-server/internal/handler/` |
| Hub WS | 26 事件常量（含 agent.dispatch/stream/done/failed） | `app/shared/src/hubEvents.ts` |
| Diff normalizer | 373 行 | `app/shared/src/diff.ts` |
| Composer | 类型 + reducer + mentions + attachments | `app/shared/src/composer/` |
| Hub MCP 端点 | 8 个 handler（CRUD + publish + unpublish） | `hub-server/internal/handler/mcp_server.go` |
| AgentTeam 全链路 | Team + Run + Route + Approval + Conflict + Assignment（22 端点） | `hub-server/internal/handler/agent_team.go` |

---

## 1. 🔌 管线类（不需要新 UI，agent 可以直接干）

这些功能后端/合同层已就绪或仅需接线，改动全在 Edge/Hub Go 代码或 shared 合同层。

| # | 功能 | 竞品来源 | 现状 | 改动范围 |
|---|---|---|---|---|
| 1 | **MCP 运行时集成** — Edge adapter 层注入 MCP 配置到 Claude Code / Codex 子进程 | SeiyunSky · metrogg | Hub CRUD 已完成，Edge registry 有 `runtime_manifest.go`。缺：Edge 端 MCP config 注入到 CLI 子进程 + `mcp_tool_call` 事件 emit | `edge-server/internal/adapters/` + `model_config.go` |
| 2 | **Diff apply 写回 workdir** — 用户接受 hunk 后真实 apply modify patch | Queena1021 | `app/shared/src/diff.ts` 已有 `applyHunks`。缺：Edge 端 `/v1/runs/:id/apply` 端点调用 OS 文件写回 | `edge-server/internal/api/handlers.go` |
| 3 | **RunEvent 持久化 + replay** — 刷新/断线重连不丢数据 | GuqierMcl | Hub `agent_run_event` 模型已有，`/web/agent-tasks/:id/events` 已有。缺：前端 replay 拉取 + 断线续订逻辑 | `app/shared/src/platform/types.ts` + Web adapter |
| 4 | **Surfacing 自动升格** — Agent 写完文件自动在聊天流内联预览/部署卡片 | Queena1021 | Transcript 已有 `ArtifactTranscriptBlock` + `PreviewTranscriptBlock`。缺：Edge 端检测文件产出 → emit surfaced artifact 事件 → 前端内联渲染 | `edge-server/internal/adapters/event_emitter.go` + shared normalize |
| 5 | **多模态消息** — 图片上传 + 消息契约支持 | GuqierMcl | Hub `/client/attachments` 端点完整（probe/upload/download）。缺：前端 Composer 图片入口 + 消息发送带 attachment ref | `app/shared/src/composer/` + Web adapter |

**工作量**：每个 20-60 分钟（agent 驱动，Go/TS 代码），总计约 3-4 小时。无 UI 风险。

---

## 2. 🔗 轻 UI 接线类（复用现有组件，不建新 UI）

现有 `@shared/ui` 和 transcript 合同已能承载，改动在 normalize 层 + 渲染分支 + 少量 CSS。

| # | 功能 | 竞品来源 | 现状 | 改动 |
|---|---|---|---|---|
| 6 | **Agent streaming bar** — 输入框上方"N 个 Agent 正在思考"状态条 | SeiyunSky · GuqierMcl | `RunSessionTranscriptBlock` + `AgentTimelineTranscriptBlock` 已定义。Hub WS 已经有 `agent.dispatch/stream/done/failed` 事件。缺：状态摘要组件（复用现有 StatusBadge）| `app/shared/src/components/` + composer 上方 1 行 CSS |
| 7 | **StepCard 可视化** — 把 `RunStepGroupTranscriptBlock` 渲染为可折叠步骤卡片 | Queena1021 · DDJH44 | `RunStepGroupTranscriptBlock` 已定义（block 类型 22 个中已含）。缺：transcript 渲染分支——已有 text/thinking/tool_call 等分支渲染，补 step group 卡片渲染 | `app/shared/src/transcript/` 渲染层 |
| 8 | **逐 hunk Diff 接受/拒绝 UI** — 复用现有 DiffViewer + hunk actions | Queena1021 | `DiffViewer.tsx` 已有 accept/reject UI 骨架。缺：接线——点 accept → `applyHunks` → 更新 diff block 状态 | `app/desktop/src/components/DiffViewer.tsx` + shared diff |
| 9 | **Artifact Workspace** — 按 topic 聚合产物卡片（复用现有 ArtifactBrowser + EvidenceRef） | DDJH44 · Queena1021 | `ArtifactTranscriptBlock` + `EvidenceRef` + `ArtifactBrowser` 组件已存在。缺：topic 分组投影层（`collectTranscriptEvidence` 已有证据收集，分组逻辑新增） | `app/shared/src/transcript/transcriptEvidence.ts` + 渲染 |
| 10 | **Context 用量可见** — 把 `ContextUsageTranscriptBlock` 渲染为可读提示 | 多竞品均有 | `ContextUsageTranscriptBlock` 已定义。缺：渲染分支 | transcript 渲染层 |

**工作量**：每个 30-90 分钟（agent 写接线 + 渲染分支 + CSS，UI 面全是复用），总计约 4-6 小时。

---

## 3. 🎨 需要新 UI 面的（真正的瓶颈）

这些需要新建组件、交互设计、多状态处理。后端/管线就绪，但 UI 需要设计+实现。

| # | 功能 | 竞品来源 | 后端 | UI 需求 | 优先级 |
|---|---|---|---|---|---|
| 11 | **对话式创建 Agent** — 场景问答→AI 生成 Agent Profile 配置→确认创建 | GuqierMcl | Hub `POST /web/agent-profiles` 已有，CustomAgent CRUD 已有。可复用 Orchestrator 做对话 | **新 UI**：对话流 + Profile 预览卡 + 确认/修改交互。需要设计 agent 创建向导 | P0 |
| 12 | **DAG 任务可视化** — 多 Agent 并行/串行的任务 DAG 图 | doloveplayer · Toufumind | AgentTeam 有 route/assignment/dispatch/complete/fail 全链路。DAG 拓扑信息已在 `RouteDecisionTranscriptBlock` 中 | **新 UI**：DAG 节点 + 边 + 状态色 + 拖拽/缩放的图组件 | P1 |
| 13 | **ContextBus / 上下文管理面板** — 跨 Agent 共享上下文 + 压缩配置 | doloveplayer | Edge 有 `context_budget.go`。Hub 消息搜索 API 已可用 | **新 UI**：上下文列表 + 优先级滑条 + 压缩阈值设置 + 预览 | P1 |
| 14 | **PPT / Slideshow 产物** — PPTX→HTML 内联预览 | MasterOfAgents · DDJH44 | Edge preview 架构已就位 | **新 UI**：PPTX 渲染组件（iframe 或 canvas 方案） | P2 |
| 15 | **模型预算分配 UI** — 按场景分配模型额度/成本 | laobiao651 | Provider Binding + model_catalog 已就绪 | **新 UI**：预算分配面板 + 使用统计图表 | P2 |
| 16 | **部署闭环 UI** — SSH/Preview/Static/Container/Vercel 多 provider | DDJH44 | Edge DeployPreview 有 placeholder | **新 UI**：Deploy 配置卡片 + 状态流 + 一键触发 | P2 |

**工作量**：P0 约 2-4 小时（含 UI 设计），P1 各 3-6 小时，P2 各 4-8 小时。瓶颈在 UI 面设计+实现，不是管线。

---

## 4. 执行优先级（总排序）

```
P0 — 立即（对演示决定性影响，大部分不需要新 UI）
  1. Agent streaming bar            🔗 轻 UI · 60 分钟
  2. StepCard 可视化               🔗 轻 UI · 90 分钟
  3. RunEvent 持久化 replay         🔌 管线 · 40 分钟
  4. Surfacing 自动升格             🔌 管线 · 30 分钟
  5. Diff apply 写回 workdir        🔌 管线 · 30 分钟
  6. 对话式创建 Agent               🎨 新 UI · 3 小时 ← 唯一需要新 UI 的 P0

P1 — 短期（后续 sprint，含最多新 UI）
  7. MCP 运行时集成                🔌 管线 · 45 分钟
  8. 逐 hunk Diff 接受/拒绝 UI     🔗 轻 UI · 60 分钟
  9. Artifact Workspace topic 分组  🔗 轻 UI · 60 分钟
  10. 多模态消息                    🔌 管线 · 45 分钟
  11. Context 用量可见              🔗 轻 UI · 30 分钟
  12. DAG 任务可视化                🎨 新 UI · 5 小时
  13. ContextBus 面板               🎨 新 UI · 4 小时

P2 — 规划中
  14. PPT 产物                      🎨 新 UI
  15. 模型预算 UI                   🎨 新 UI
  16. 部署闭环 UI                   🎨 新 UI
```

---

## 5. 一句话总结

> **管线型（9 条）= agent 今晚就能干完。轻 UI 型（5 条）= 一天内搞定。新 UI 型（5 条）= 需要我们一起定交互方案。但 P0 的 6 条里只有 1 条需要新 UI——对话式创建 Agent。其余 5 条要么是纯管线，要么是现成组件接线。**

P0 总工作量：约 3 小时管线类（agent 干）+ 3 小时对话式 Agent UI（需要你定交互方向）。

要不要我从 P0 #1-5（纯管线+轻 UI）现在开始逐一执行？
