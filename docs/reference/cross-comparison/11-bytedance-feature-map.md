# bytedance.md 功能映射

最后更新：2026-05-26

本文把外部 `bytedance.md` 教学/需求简报映射到当前仓库证据。它是功能差距矩阵，不是任何旧 Trump 分支、归档 worktree 或口头进度的可信记录。

状态口径：

- 已实现：当前分支源码和测试能证明链路存在。
- 部分完成：已有有效源码，但仍缺产品、端到端、部署态或 UI 证据。
- 规划中：设计存在，但当前分支没有足够实现证据。
- 证据缺失：不能对外声称完成。

## 当前北极星

AgentHub 应保持“IM-native Agent collaboration + real Runtime execution”：

```text
TokenDance ID -> Hub session/device proof -> Hub IM/task dispatch
  -> Desktop/Edge execution target -> Agent Runtime adapter
  -> typed RunEvent / Approval / Artifact projection -> Web/Desktop/Mobile surfaces
```

产品不应转成 workflow canvas 克隆。竞品中值得借鉴的是 durable thread、trace、run history、append-only event log、审批恢复和 artifact 生命周期；AgentHub 的用户对象仍是 Agent Profile、Execution Target、Thread、Run、RunEvent、Approval 和 Artifact。

## 功能矩阵

| bytedance.md 范围 | 当前状态 | 当前证据 | 缺口 / 下一验收 |
|---|---|---|---|
| 会话列表 | 部分完成 | Hub sessions 与 Web thread 查询：`hub-server/internal/handler/session.go`、`app/web/src/api/threadQueries.ts`；IM 列表视图：`app/web/src/views/IMView.tsx` | Pin/archive/search/sort 还没有跨 Web/Desktop 证明。 |
| 单 Agent 聊天 | 部分完成 | Web 先写 Hub message 再触发 `/web/agent-tasks`：`app/web/src/layouts/WebLayout.tsx`；Hub 会选择用户指定 Runtime：`hub-server/internal/service/agent.go` | 需要一次部署态 smoke：Web -> Hub -> Desktop -> Edge -> Codex/Claude Code/OpenCode -> Hub message。 |
| 群聊与 @Agent | 部分完成 | Hub group session、agent instance 和邀请链路存在；Desktop/Web 有 mention-facing UI | 需要一个 Hub group session 内两个真实 Runtime Profile 的 E2E transcript。 |
| 文本/代码/diff/文件/预览/部署消息 | 部分完成 | Hub message model 有 text/code/diff/file/link/deploy card 常量：`hub-server/internal/model/message.go`；Web ChatView 渲染 text/code/tool/file/result block：`app/web/src/components/ChatView.tsx` | 图片/附件 UX、预览卡、部署状态卡和 artifact-specific persistence 仍需产品测试。 |
| 回复/引用/重新生成/复制/apply diff/preview | 部分完成 | Web ChatView 有复制/重试 UI；Hub message service/handler 有 reply/pin/recall/read API | Apply diff、quote UI、regenerate 语义和 preview-open 验收未跨端完成。 |
| 上下文连续性与 pinned context | 部分完成 | Hub message history、Edge thread/run model 和 Desktop 本地 chat reducer 都存在 | 需要证明 Hub thread history 与 pinned messages 会被一致送入各 runtime 的 context builder。 |
| Orchestrator 拆解与聚合 | 部分完成 | Orchestrator adapter 和 sub-agent task 类型存在：`edge-server/internal/adapters/adapter.go`、`edge-server/internal/adapters/orchestrator.go` | 需要真实多 Agent 编排 smoke：dispatch、aggregation、fallback、conflict handling。 |
| Claude Code adapter | 已实现，有 caveat | `edge-server/internal/adapters/claude_code.go`；live smoke 记录在 `docs/handoff/STATE.md` | 阻塞式 human-in-the-loop stdin `can_use_tool` 回写仍是单独安全验收。 |
| Codex adapter | 已实现，有 caveat | `edge-server/internal/adapters/codex.go`；消费 `codex exec --json` 风格 JSONL 事件 | streaming app-server 模式和 resume/session UX 仍是后续工作。 |
| OpenCode adapter | 已实现，有 caveat | `edge-server/internal/adapters/opencode.go`；OpenCode JSON 输出映射到 text/tool/file/result events | OpenCode server/SSE 模式尚未成为主适配路径。 |
| 用户自建 Agent | 部分完成 | Hub CustomAgent model/service 和 Web profile mapping 存在 | 对话式创建、版本、市场审核、安装统计仍在规划。 |
| Agent 联系人头像/名称/能力标签 | 部分完成 | Settings surfaces 和 Hub agent profile API 存在 | Contacts-style 跨端 UX 与 capability tag 编辑未完成。 |
| Artifact 预览/编辑 | 部分完成 | Diff 与 RunDetail 组件存在；Desktop/Web 能显示 output/tool/file blocks | 全屏编辑器、iframe preview、版本历史、本地 apply/discard workflow 需要 E2E 证明。 |
| 部署发布 | 规划中 | deploy card content type 存在 | 静态/容器/package deploy flow 和 preview URL cards 未端到端实现。 |
| Web 完整 IM + editor | 部分完成 | Web Hub-only shell、Hub chat、settings/profile/task surfaces 已存在 | Web 还缺 artifact editor、durable run history panel 和 production auth smoke。 |
| Desktop 本地文件/进程管理 | 部分完成 | Desktop -> Local Edge -> Runtime adapters 是当前最强实现链路 | Packaged TokenDance ID login/logout/reconnect 与截图证据仍未关闭。 |
| Mobile 轻量 IM/approval/preview | 规划中 | 部分 Web/mobile 响应式 surface 有测试 | Native/light mobile approval 与 preview flow 尚不是实现产品面。 |
| TokenDance ID 真实身份 | 部分完成 | Hub OIDC authorize/callback/session gate：`hub-server/internal/service/oidc.go`、`hub-server/internal/middleware/auth.go`；Web/Desktop 登录入口存在 | 需要部署态真实登录 smoke：login -> Hub callback -> Hub session -> WebSocket auth -> logout/reconnect。 |
| Runtime 事件显示 | 部分完成，本轮增强 | Web 在 `app/web/src/utils/hubAdapters.ts` 解析 runtime payload；RunDetail projection 已消费 text/tool/file blocks；Hub 已新增最小 typed RunEvent 持久化、`GET /web/agent-tasks/{id}/events` 和 `agent.stream` 消费；Desktop bridge 已按 `event_type + payload` 回传结构化 runtime event | 还需要把 token/step/elapsed/approval/artifact 摘要从文本投影提升为一等 UI，并补真实 live E2E 截图。两个 Home 仍保持 product/docs 站点边界，不作为 runtime 控制台。 |

## 竞品方向参考

- OpenHands 最接近 AgentHub 下一阶段需要的事件架构：append-only、类型化事件既是 agent memory，也是 service integration point。AgentHub 应借鉴原则，而不是照搬对象模型：Hub 要持久化 typed RunEvent，再投影到聊天、timeline、审计和 artifact。
- Dify workflow logs/events 证明 replay/resume 是产品能力，不只是调试能力。AgentHub Web 重连后应能恢复 run stream，而不是只看到最终 chat message。
- LangGraph threads/checkpoints 证明 thread state 与 run execution 要分层。AgentHub 应让 Hub Thread 成为 durable conversation container，让 Edge RunEvent/Artifact 成为执行证据。
- OpenCode server 暴露 sessions、status、diffs、permissions、tools、MCP、agents 和 SSE events。AgentHub Edge 仍要保持 Hub-safe protocol，但下一轮 adapter 可以参考 server mode，而不是只依赖 CLI batch parsing。

公开参考入口：`https://github.com/All-Hands-AI/OpenHands`、`https://github.com/langgenius/dify`、`https://github.com/langchain-ai/langgraph`、`https://github.com/sst/opencode`。

## 下一批 P0/P1 交付顺序

1. 部署态 TokenDance ID smoke：真实登录 Hub、Hub session、WebSocket auth、logout/reconnect；仓库只保存脱敏证据。
2. Runtime history UI：在 Web 已消费 Hub typed RunEvent 的基础上，补状态筛选、token/step/elapsed/approval/artifact 摘要；Home 站点只保留登录态入口和深链。
3. Runtime UI parity：Web/Desktop RunDetail 和 ChatView 使用同一套 text/tool/file/result/usage/approval projection，并补 live E2E 截图。
4. 多 Agent group smoke：一个 Hub group session，两个真实 Runtime Profile，Orchestrator dispatch，可见聚合 transcript。
5. Artifact lifecycle：diff/file/artifact cards 支持 open preview、apply/discard、version history 和安全路径边界。
