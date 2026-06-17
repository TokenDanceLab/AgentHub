<!--
  ⚠ ARCHIVED — HISTORICAL REFERENCE ONLY
  This document has been archived from docs/reference/.
  It represents completed research/analysis and is NOT actively maintained.
  The information here may be outdated. Refer to docs/reference/ for current reference material.
  Archived: 2026-06-17
-->

# 01 — 管线类功能（不需要新 UI）

> 后端/合同层已就绪或仅需接线，改动全在 Edge/Hub Go 代码或 shared 合同层。
> **Agent 可直接执行。**

---

| # | 功能 | 竞品对标 | 验收标准 | 改动范围 | 预计 |
|---|---|---|---|---|---|
| 1 | **MCP 运行时集成** — Edge adapter 注入 MCP config 到 CLI 子进程，emit `mcp_tool_call` 事件 | SeiyunSky · metrogg | Mock 模式能触发 MCP 工具调用并渲染事件卡片 → Observed 模式真实 Claude Code MCP 调用成功 | `edge-server/internal/adapters/model_config.go` + `event_emitter.go` | 45 分钟 |
| 2 | **Diff apply 写回 workdir** — 用户接受 hunk → Edge `/v1/runs/:id/apply` → OS 文件真实写回 | Queena1021 | Mock 模式 hunk apply 成功 → Observed 模式真实文件变更可验证 | `edge-server/internal/api/handlers.go` (apply endpoint) + `app/shared/src/diff.ts` (applyHunks) | 30 分钟 |
| 3 | **RunEvent 持久化 + replay** — 刷新/断线重连不丢数据。复用 Hub `/web/agent-tasks/:id/events` 已有端点 | GuqierMcl ⚠️ 竞品已在做 event coalescing | 刷新页面后聊天历史完整恢复 → 断线 30 秒重连后增量补齐 | `app/shared/src/platform/types.ts` (replay API) + Web/Desktop adapter 接线 | 40 分钟 |
| 4 | **Surfacing 自动升格** — Agent 写完文件 → Edge 检测 → emit `artifact.surfaced` 事件 → 聊天流内联预览卡片 | Queena1021 | Mock 模式文件产出 → 3 秒内聊天流自动出现预览卡 → Observed 模式真实文件路径正确 | `edge-server/internal/adapters/event_emitter.go` (新增 surfaced 事件) + shared normalize 层新增 block 类型 | 90 分钟 |
| 5 | **AgentTeam 上下文窗口** — 上下文即将溢出时自动触发压缩/截断并写 event | doloveplayer | 模拟超长对话 → 系统自动压缩上下文 → `context.compressed` 事件写入 EventStore | `edge-server/internal/adapters/context_budget.go` | 30 分钟 |
| 6 | **Hub 消息全文搜索索引** — 消息搜索点击跳转到原始消息位置 | — | 搜索结果点击 → 聊天区滚动到对应消息 → 高亮 3 秒 | `hub-server/internal/handler/message.go` (搜索 API 完善) + `app/shared/src/platform/types.ts` (跳转语义) | 40 分钟 |
| 7 | **Tool allowlist 运行时强制** — Edge 运行时对非白名单工具调用返回 rejected 事件 | — | 非白名单工具调用 → `tool.rejected` 事件 → 不 spawn 子进程 | `edge-server/internal/lifecycle/process_executor.go` (allowlist check) | 20 分钟 |
| 8 | **失败降级** — sub-agent 失败后分类处理：transient(自动重试3次+指数退避) / capability(切换 agent) / cancel(跳过回滚) | doloveplayer · Queena | 子 agent crash → 3 次重试 → LLM 决策(continue\|replan\|abort) → 人工上报 | `dispatchInterceptor` error path — 分类逻辑 + `handleSubAgentResult(msg, isError=true)` 增强 | 90 分钟 |
| 9 | **同级上下文** — sub-agent spawn 时注入同级 agent 列表 + 并发写入边界警告，避免多 Agent 写同文件冲突 | Queena | 3 个 worker 并发 → 每个 worker prompt 注入"其他 agent 正在写 X/Y/Z 文件，请勿触碰"→ 文件冲突归 0 | `SubAgentTask` 加 `SiblingAgents` 字段 + spawn 时收集 + prompt 注入 | 30 分钟 |
| 10 | **Plan 确认门** — orchestrator 拆解任务后 emit `plan.proposed` WS 事件，暂停执行等用户 approve | Queena · Toufumind | 群聊发"重写整个项目"→ Orchestrator 拆解 6 个子任务 → ChatPanel 出现 PlanCard "是否确认执行？"→ 用户点确认 → 开始分发 | `dispatchInterceptor.scanForDispatch()` 检测后 emit `plan.proposed` → Hub 端等 `plan:approve` 再 `fanOutDispatches()` | 60 分钟 |
| 11 | **结构化 Plan 拆分** — orchestrator prompt 增强，输出带 `agent/task/dependsOn/mode` 的结构化 dispatch schema | Queena · SeiyunSky | LLM 自动拆解"写一个微服务"→ 结构化 Plan {tasks: [{agent,description,dependsOn,mode}]} → 前序完成的结果传给后续 | `DefaultOrchestratorPrompt()` prompt 模板增强 | 45 分钟 |
| 12 | **消息重新生成** — Hub 端支持重新触发最近一条 Agent 消息的生成 | — | 用户对 Agent 回复不满意 → 点"重新生成"→ Hub 重新 dispatch 同 task → 覆盖旧回复 | `hub-server/internal/handler/agent.go` (re-trigger) + WS 事件 `agent.regenerate` | 30 分钟 |

## 验收门

每项必须在 Mock + Observed 双模式通过后方可标"完成"。

Mock 验收 = `app/desktop` dev server 打开 + demo data + 功能路径手动走通。
Observed 验收 = `verify-real-api-smoke.ps1` 相关 phase 通过。
