# SPEC — agentteam 子任务实时直播（对标 codeg live subagent transcripts）

> 状态: **Phase A 已合入 master `d4270360`** · Phase B/C DRAFT 待管理员定档 · Issue #1478 · 关联 #1385（投影层）
> 作者: senior-architect agent · 日期: 2026-07-30
> 权威: `docs/progress/MASTER.md` P3 表 · `api/events.md` 事件合同
> 证据: codeg v0.22.1 `c612e6c2` + `D:\Code\Temp\codeg-research\{v0.22.1-DELTA,protocol,frontend,backend}.md`；AgentHub `hub-server/internal/service/agentteam/`、`edge-server/internal/adapters/`、`app/shared/src/hubEvents.ts` 实测

---

## 0. 摘要（先读）

- codeg v0.22.1 用 `subagent-transcript` 客户端能力把子 agent 的流式文本/思考嵌进父 agent 胶囊的「Live activity」区域，全链路 39 文件改造、三处归属边界切割、三处围栏防越界，**让多 agent 编排的内部思考流对用户可见**。
- AgentHub 的 agentteam 编排语义深度（supervisor / delegate / review / approve / compete）领先 codeg，但 UX 仍是「触发子任务 → 等结果 → 回传」的**黑盒**：子 agent 的 `run.agent.*` 流事件已经存在并已落 `agent_run_events` 表，但只投到 `agent.stream`（聊天胶囊），**没有按 assignment/member 维度聚合成「子任务直播卡」投到 team run 视图**。
- 本 SPEC 不新增事件源（edge 已发 `run.agent.text_delta/thinking/tool_call/tool_progress/tool_result/plan_proposed/context_usage/permission_requested/result`），只新增**一条 Edge→Hub→WS 的聚合投影路径**与**一组 team 域 WS 帧类型**，把已有的 per-task 流事件按 `(team_run_id, assignment_id, member_id)` 归属后投递给订阅了该 team run 的前端。
- 实现分三阶段：**Phase A** 事件归属与 bus fan-out（后端，零前端改动可观测）；**Phase B** 投影层抽取 live-stream slice 与重放（`GetTeamRunState` 增字段）；**Phase C** 前端 live activity 卡片与 WS 订阅模型。
- **需管理员 RFC sign-off**：新增 4 个 WS 帧类型 + 1 个 REST 端点属于协议合同变更（`api/events.md` / `openapi.yaml` / `hubEvents.ts` 三处 1:1 同步），且依赖 #1385 投影层已 closed 的前置。

---

## 1. codeg 的 live subagent transcript 设计

### 1.1 触发与能力宣告

codeg v0.22.1 `claude-agent-acp 0.63.0` 引入 `subagent-transcript` 客户端能力（`v0.22.1-DELTA.md §2 信号 1`）。Claude Code 连接在 `initialize` 时宣告此能力，子 agent 的流式 `AgentMessageChunk` / `AgentThoughtChunk` 被打上 `_meta.claudeCode.parentToolUseId`，在父 agent 胶囊内作为「Live activity」区域实时渲染。用户在主会话里看到的是：**主 agent 思考 → 委托给子 agent → 子 agent 的实时输出在主会话里展开**。

### 1.2 事件与粒度

按 `protocol.md §1` 与 `frontend.md` 的 AcpEvent 36 变体，子 agent 直播复用与主 agent **同一套**流式事件，只是带归属标记：

| 流式块（ACP SessionUpdate） | 映射 AcpEvent | 直播用途 |
|---|---|---|
| `AgentMessageChunk(ContentChunk)` | `AgentMessageChunk` | 子 agent 文本增量 |
| `AgentThoughtChunk(ContentChunk)` | `AgentThoughtChunk` | 子 agent 思考增量 |
| `ToolCall` / `ToolCallUpdate` | `ToolCall` / `ToolCallUpdate` | 子 agent 工具调用 |
| `Plan` | `Plan` | 子 agent 计划块 |
| `UsageUpdate` | `UsageUpdate` | 子 agent token 用量 |

粒度是 **chunk 级**（per-token 文本 / per-thought 思考 / per-tool-call 工具），不是「等子 agent 完成」才回传。

### 1.3 归属边界与围栏

`v0.22.1-DELTA.md` 记录的三处切割与三处围栏：

- **三处归属切割**（在归属边界处把子 agent 块与主 agent 块分开）：backend append、reducer merge、RAF pre-coalesce。主线程和子 agent 的 prose 永不合并。
- **三处围栏防越界**：
  1. reducer 的 `prompting / parent-presence gate`——只有父 agent 在 prompting 状态时子 agent 块才嵌进父胶囊；
  2. `Prompting-only backend append`——backend 只在父 prompting 阶段才把 chunk 归到父；
  3. `store 的 agent-id 检查`——runtime-store 按归属 agent id 路由，防错投。
- 中程重连能重建相同胶囊路由（基于 `parentToolUseId` + seq）。

### 1.4 前端 UX

`frontend.md:105`：`computeTimeline` Phase 4 由 `buildStreamingTurnsFromLiveMessage` 把 liveMessage 切成多轮 turn；**子代理 tool call 用 `parentToolUseId` 精确嵌套，位置启发式兜底**。子 agent overlay 可折叠成圆形图标 chip（`product.md:74`）。结论：**子 agent 直播 = 父胶囊内按 parentToolUseId 嵌套的实时子流**，不是独立会话窗口。

---

## 2. AgentHub gap 分析

### 2.1 我们已经有的

| 能力 | 位置 | 状态 |
|---|---|---|
| Edge 流事件源（`run.agent.*` 全套） | `edge-server/internal/adapters/adapter.go:165-214`（`BusEventTextDelta/Thinking/ToolCall/ToolProgress/ToolResult/PlanProposed/ContextUsage/PermissionRequested/Result`） | 已有，chunk 级 |
| Edge→Hub 回调落库 | `hub-server/internal/service/agent_edge_callback.go:145` `HandleTaskStream` → `agent_run_events` 表 | 已有，per-task 落库 + bus `agent.stream` |
| Hub WS `agent.stream` 帧 | `hub-server/internal/ws/frame.go:50` + `app/shared/src/hubEvents.ts:49` | 已有，投到 `runEvent.SessionID` |
| Team run 投影层 #1385 | `hub-server/internal/service/agentteam/agent_team_projection.go` | **closed**，从 `agent_run_events` 投影 approvals/artifacts/budget |
| Team run 状态 REST | `agent_team_run.go:274` `GetTeamRunState` → `TeamRunState.RunEvents` | 已有，但**只有终态快照，无实时流** |
| Team 域 WS 帧 | `frame.go:57-60`（`team.run.started / team.event / team.assignment.done/failed`） | 已有，但**只覆盖生命周期，不含子任务思考流** |
| 子任务派单 | `agent_team_routing.go:460` `TriggerAgentTask` → 子 agent 共享 `run.SessionID` | 已有，子 agent 与 supervisor 同 session |

### 2.2 缺的（gap）

| 缺口 | 说明 | 影响 |
|---|---|---|
| **G1. 子任务流事件无 team 归属** | `HandleTaskStream` 把 `runEvent` 投到 `agent.stream`（聊天胶囊），bus 事件只有 `task_id/session_id/agent_instance_id`，**没有 `team_run_id / assignment_id / member_id`**。前端在 team run 视图里收不到子任务流。 | 用户在 team run 详情页看不到子 agent 实时思考 |
| **G2. team 域 WS 无子任务直播帧** | `team.event` 是离散生命周期事件（route/assignment/task），**没有 `team.subagent.stream` 这类聚合流帧**。 | 前端只能轮询 `getTeamRunState`（8s 间隔），不是直播 |
| **G3. 投影层无 live-stream slice** | `GetTeamRunState` 返回 `RunEvents []TeamRunEventState`（终态全量），但**没有「按 assignment 分组的流式片段」**字段，前端无法按子任务卡渲染。 | team run 视图只有「任务列表 + 终态」，无「正在跑的子任务在输出什么」 |
| **G4. 前端无 live activity 卡** | `webHubRealtime.ts` 只处理 `agent.stream`（聊天胶囊）+ `team.*`（RQ invalidation），**没有按 `(team_run_id, assignment_id)` 订阅子任务流的模型**。 | team run 详情页是静态刷新，不是直播 |
| **G5. 无重连 watermark** | codeg 用 `parentToolUseId` + seq 重建胶囊路由；AgentHub 的 `agent_run_events` 有 `event_seq`（per-task 单调），但 team 视图重连后**没有「从哪个 seq 接续」的订阅协议**。 | 重连后要么全量重拉、要么丢中段 |

### 2.3 一个关键事实：子 agent 与 supervisor 共享 session

`agent_team_routing.go:423` `ListAgentInstancesBySession(run.SessionID)` 证明：**所有子 agent 实例都挂在 team run 的同一个 `run.SessionID` 下**。这意味着 `HandleTaskStream` 里 `runEvent.SessionID == run.SessionID`，`agent.stream` 帧会被 `PushToSession` 投给所有订阅了该 session 的连接——**前端在 team run 详情页其实能收到子任务流，但混在主胶囊里、没有 assignment/member 归属、无法区分是哪个子 agent**。这是 G1 的根因，也是 Phase A 的最小切入点。

---

## 3. 提议的事件模型

### 3.1 设计原则

1. **不新增 edge 事件源**——`run.agent.*` 全套已够，只加归属。
2. **team 域聚合优先于 chat 域透传**——子任务流在 team run 视图里按 assignment 聚合成卡，不再混进主聊天胶囊（与 codeg「主/子 prose 永不合并」一致）。
3. **event_seq 作为 watermark**——重连用 `(task_id, after_seq)` 续播，复用现有 `GET .../events?after_seq=` 语义。
4. **bus 先、WS 后**——Phase A 在 `HandleTaskStream` 里多发一个 team 域 bus 事件，Phase B/C 再接 WS；任何阶段单独可观测。

### 3.2 新增 team 域 bus 事件

在 `hub-server/internal/bus` 之上（#1385 已抽出的叶子包），`agent_edge_callback.go` 在现有 `agent.stream` 发布之外，**当 `runEvent.SessionID` 对应一个 team run 时**，额外发布：

```go
// hub-server/internal/service/agent_edge_callback.go（Phase A 新增）
type TeamSubagentStreamPayload struct {
    TeamRunID      string          `json:"team_run_id"`
    TeamID         string          `json:"team_id"`
    SessionID      string          `json:"session_id"`
    AssignmentID   string          `json:"assignment_id,omitempty"` // 由 task_id 反查
    TeamTaskID     string          `json:"team_task_id,omitempty"`
    MemberID       string          `json:"member_id,omitempty"`     // assignment.ToMemberID
    AgentTaskID    string          `json:"agent_task_id"`            // == pendingTask.ID
    AgentInstanceID string         `json:"agent_instance_id"`
    EdgeRunID      string          `json:"edge_run_id,omitempty"`
    EventSeq       int64           `json:"event_seq"`
    EventType      string          `json:"event_type"`               // run.agent.text_delta / thinking / ...
    Payload        json.RawMessage `json:"payload"`
    CreatedAt      time.Time       `json:"created_at"`
}

// bus 事件类型常量（加到 bus 或 service 域）
const BusEventTeamSubagentStream = "team.subagent.stream"
```

发布点（`HandleTaskStream` 持久化成功后，与现有 `s.bus.Publish(ctx, Event{Type: ws.TypeAgentStream, ...})` 并列）：

```go
// 已有：s.bus.Publish(ctx, Event{Type: ws.TypeAgentStream, Payload: runEvent})
// Phase A 新增：
if teamCtx, ok := s.lookupTeamRunContext(ctx, runEvent.SessionID, taskID); ok {
    s.bus.Publish(ctx, bus.Event{
        Type: "team.subagent.stream",
        Payload: TeamSubagentStreamPayload{
            TeamRunID:    teamCtx.TeamRunID,
            TeamID:       teamCtx.TeamID,
            SessionID:    runEvent.SessionID,
            AssignmentID: teamCtx.AssignmentID,
            TeamTaskID:   teamCtx.TeamTaskID,
            MemberID:     teamCtx.MemberID,
            AgentTaskID:  taskID,
            AgentInstanceID: task.AgentInstanceID,
            EdgeRunID:    runEvent.EdgeRunID,
            EventSeq:     runEvent.EventSeq,
            EventType:    runEvent.EventType,
            Payload:      json.RawMessage(runEvent.Payload),
            CreatedAt:    runEvent.CreatedAt,
        },
    })
}
```

`lookupTeamRunContext` 是 Phase A 唯一新逻辑：`GetTeamRunBySessionID`（`agent_edge_callback.go:267` 已有）+ `ListAssignmentsByTeamRun` + `ListTeamTasksByRun` 反查 `assignment_id / team_task_id / member_id`。加 LRU 缓存（key=task_id，TTL=运行期间）避免每事件查库。

### 3.3 事件类型与 scopes（完整表）

| run.agent.* 事件 | 子任务直播用途 | payload 关键字段 |
|---|---|---|
| `run.agent.text_delta` / `run.agent.text_block` | 子 agent 文本增量 | `text` / `delta` |
| `run.agent.thinking` | 子 agent 思考增量 | `text` |
| `run.agent.tool_call` | 子 agent 工具调用 | `toolName`, `toolUseId`, `input`, `status` |
| `run.agent.tool_progress` | 工具进度 | `toolUseId`, `progress`, `message` |
| `run.agent.tool_result` | 工具结果 | `toolUseId`, `output`, `isError` |
| `run.agent.plan_proposed` | 计划块 | `plan`, `approvalId` |
| `run.agent.context_usage` | token 用量 | `tokensUsed`, `tokenLimit`, `usagePercent` |
| `run.agent.permission_requested` | 审批请求 | `requestId`, `toolName`, `toolUseId` |
| `run.agent.result` | 终态结果 | `content`, `stopReason` |

scope（所有事件统一）：`{ team_run_id, team_id, session_id, assignment_id, team_task_id, member_id, agent_task_id, agent_instance_id, edge_run_id, event_seq }`。

### 3.4 与现有 `agent.stream` 的关系

- `agent.stream`（chat 域）**保留**——子 agent 流仍然进聊天胶囊（用户在 IM 视图里仍能看到子 agent 在说话）。
- `team.subagent.stream`（team 域）**新增**——同一事件、双投递。这与 `team.event` 并存，不替换。
- 去重：`team.subagent.stream` 的幂等键是 `(agent_task_id, event_seq)`，与 `agent.stream` 一致（`api/events.md` 已定义）。

---

## 4. Edge → Hub 传播路径

```
edge-server adapter (ParseStream → emitter.Emit)
   │  run.agent.text_delta / thinking / tool_call / ...   (已有，不改)
   ▼
edge event bus → edge HTTP callback (POST /hub/edge/task/{id}/stream)   (已有)
   ▼
hub-server EdgeCallbackService.HandleTaskStream                       (已有)
   ├─ repository.CreateAgentRunEventWithNextSeqLimited  (已有，落 agent_run_events)
   ├─ bus.Publish("message.new", msg)                   (已有)
   ├─ bus.Publish("agent.stream", runEvent)             (已有 → ws.PushToSession)
   └─ bus.Publish("team.subagent.stream", teamPayload)  ★ Phase A 新增
        ▼
   app.subscribeTeamEvents()  ★ Phase A 新增订阅
        ├─ ws.NewFrame(TypeTeamSubagentStream, payload)
        └─ mgr.PushToSession(teamCtx.SessionID, frame)   (投给订阅 team run session 的连接)
           （或 PushToUser(run.TriggerUserID) — 见 §7 open question 2）
```

**关键：edge 侧零改动**。`run.agent.*` 全套事件已经在 `HandleTaskStream` 入口汇聚，Phase A 只在 hub 侧加一条 bus 发布 + 一条 WS 订阅。这是本 SPEC 最小侵入性的保证。

---

## 5. WebSocket 帧设计

### 5.1 新增帧类型

`hub-server/internal/ws/frame.go`（与 `app/shared/src/hubEvents.ts` 1:1 同步，与 `api/events.md` 语义表同步）：

```go
// Team 子任务直播家族：UPSERT by (agent_task_id, event_seq)；水位 event_seq。
TypeTeamSubagentStream      = "team.subagent.stream"      // 单条流事件
TypeTeamSubagentActivity    = "team.subagent.activity"    // 聚合状态卡（thinking/streaming/done/failed）
TypeTeamSubagentBatch       = "team.subagent.batch"       // 微批（见 §5.3）
TypeTeamSubagentSubscription = "team.subagent.subscribe"  // C→S 订阅 / 重连 watermark（见 §5.4）
```

幂等语义（写入 `api/events.md` 表）：

| type | 方向 | 幂等键 | 重复投递语义 | 备注 |
|---|---|---|---|---|
| `team.subagent.stream` | S→C | `(agent_task_id, event_seq)` | **UPSERT** + **水位** | 与 `agent.stream` 同语义，team 域聚合 |
| `team.subagent.activity` | S→C | `assignment_id` | **UPSERT by id** | 状态卡（thinking/streaming/done） |
| `team.subagent.batch` | S→C | `(agent_task_id, from_seq, to_seq)` | **idempotent on apply** | 微批续播 |
| `team.subagent.subscribe` | C→S | — | — | 订阅 / 重连 watermark 请求 |

### 5.2 `team.subagent.stream` 帧结构

```json
{
  "type": "team.subagent.stream",
  "seq_id": 42,
  "payload": {
    "team_run_id": "01HX...",
    "team_id": "01HX...",
    "session_id": "01HX...",
    "assignment_id": "01HX...",
    "team_task_id": "01HX...",
    "member_id": "01HX...",
    "agent_task_id": "01HX...",
    "agent_instance_id": "01HX...",
    "edge_run_id": "run_1",
    "event_seq": 17,
    "event_type": "run.agent.text_delta",
    "payload": { "text": "正在重构" },
    "created_at": "2026-07-30T12:00:00Z"
  }
}
```

### 5.3 微批（`team.subagent.batch`）

子任务高频流（`text_delta` per token）直接逐帧投递会放大 WS 负载。复用 `webHubRealtime.ts` 已有的 `AGENT_STREAM_LIVE_BATCH_WINDOW_MS = 16` 微批模式：hub 侧在 `subscribeTeamEvents` 里对 `team.subagent.stream` 做 16ms 窗口聚合，发 `team.subagent.batch`（payload.events 数组）。前端按 `(agent_task_id, event_seq)` 顺序 apply，watermark 取 max。

### 5.4 订阅 / 重连模型

新增 C→S 帧 `team.subagent.subscribe`：

```json
{
  "type": "team.subagent.subscribe",
  "payload": {
    "team_run_id": "01HX...",
    "after_seq": { "agent_task_id_1": 16, "agent_task_id_2": 7 }
  }
}
```

服务端响应：对每个 `agent_task_id`，从 `agent_run_events` 表按 `after_seq` 续播（复用 `ListAgentRunEventsByTaskIDFiltered`），然后切到实时 bus。这与 `api/events.md` 的 Edge `EventEnvelope.seq` cursor 语义对称。**重连不丢中段**。

### 5.5 投递目标

`PushToSession(teamCtx.SessionID, frame)`——子 agent 与 supervisor 共享 `run.SessionID`，所有订阅该 session 的连接都收到。**不新增路由**。team run 详情页前端按 `assignment_id` 分组渲染即可。（`PushToUser` 备选见 §7。）

---

## 6. 分阶段实施计划

### Phase A — 事件归属与 bus fan-out（后端，可独立验证）

> **状态：已合入 master `d4270360`（2026-07-30）。** 实现与下表差异：A3 只加了 1 个帧常量 `TypeTeamSubagentStream`（activity/batch/subscribe 留待 Phase B/C 有 wire producer 再加，遵守 #1362/#1422 死面禁令）；A2 LRU 缓存自实现（无外部依赖，bounded 1024）；A6 测试落在 `agent_team_subagent_stream_test.go`。edge 零改、前端未改也能观测。

**目标**：`team.subagent.stream` bus 事件落地，WS 帧先发（前端不消费也无妨）。

| 步骤 | 文件 | 改动 |
|---|---|---|
| A1 | `hub-server/internal/service/agent_edge_callback.go` | `HandleTaskStream` 持久化成功后，按 `runEvent.SessionID` 反查 team run context（`GetTeamRunBySessionID` + `ListAssignmentsByTeamRun` + `ListTeamTasksByRun`），发布 `bus.Event{Type: "team.subagent.stream", ...}` |
| A2 | `hub-server/internal/service/agentteam/agent_team_lookup.go`（新） | `lookupTeamRunContext(sessionID, taskID)` + LRU 缓存（key=task_id），返回 `{TeamRunID, TeamID, AssignmentID, TeamTaskID, MemberID}` |
| A3 | `hub-server/internal/ws/frame.go` + `app/shared/src/hubEvents.ts` | 新增 4 个 `TypeTeamSubagent*` 常量（1:1 同步） |
| A4 | `hub-server/internal/app/events.go` | `subscribeTeamEvents` 新增 `team.subagent.stream` 订阅 → `ws.NewFrame(TypeTeamSubagentStream, payload)` → `PushToSession`（先逐帧，微批留 Phase C） |
| A5 | `api/events.md` | 新增 4 行幂等语义表 + owner 行 |
| A6 | 测试 | `teamrun_error_paths_test.go` 扩展：断言 team run 期间 `HandleTaskStream` 发布了 `team.subagent.stream` bus 事件且 WS 收到 `TypeTeamSubagentStream` 帧 |

**验收**：在 team run 详情页开 WS，触发一个 delegate assignment，用 `wscat` 能看到 `team.subagent.stream` 帧流。前端未改也能观测（`agent.stream` 行为不变）。

**风险**：LRU 缓存失效时机——assignment 终态后应失效该 task 的缓存，避免下次同 task_id 复用错归属。在 `CompleteAssignment` / `FailAssignment` 里加 `invalidateTeamRunContext(taskID)`。

### Phase B — 投影层 live-stream slice 与重放

**目标**：`GetTeamRunState` 返回按 assignment 分组的流式片段；REST 重放端点支持 `after_seq`。

| 步骤 | 文件 | 改动 |
|---|---|---|
| B1 | `hub-server/internal/model/agent_team_state.go` | `TeamRunState` 新增 `SubagentStreams []TeamSubagentStreamSlice`；`TeamSubagentStreamSlice{ AssignmentID, MemberID, AgentTaskID, EdgeRunID, LastEventSeq, Events []TeamRunEventState }` |
| B2 | `hub-server/internal/service/agentteam/agent_team_projection.go` | 新增 `projectTeamSubagentStreams(runEvents, taskRefs)`——按 `assignment_id` 分组，每组取最近 N（如 200）事件，返回 slice |
| B3 | `agent_team_run.go` `GetTeamRunState` | 调用 `projectTeamSubagentStreams` 填充 `state.SubagentStreams` |
| B4 | `hub-server/internal/handler/`（新端点） | `GET /web/agent-teams/{teamId}/runs/{runId}/subagent-stream?assignment_id=&after_seq=` → 返回该 assignment 的 `agent_run_events` 续播（复用 `ListAgentRunEventsByTaskIDFiltered`） |
| B5 | `api/openapi.yaml` | 新端点 schema |
| B6 | 测试 | 投影层单测：多 assignment 的 runEvents 正确分组；REST 端点 contract test |

**验收**：`GET /web/agent-teams/{t}/runs/{r}` 返回 `subagent_streams`，每个 assignment 有最近事件。重连用 `GET .../subagent-stream?after_seq=` 续播。

### Phase C — 前端 live activity 卡

**目标**：team run 详情页按 assignment 渲染「子任务直播卡」，WS 订阅 + 微批 + 重连续播。

| 步骤 | 文件 | 改动 |
|---|---|---|
| C1 | `app/shared/src/hubEvents.ts` | 确认 4 个 `TEAM_SUBAGENT_*` 常量（Phase A 已加） |
| C2 | `app/shared/src/transcript/teamSubagentStream.ts`（新） | normalize `team.subagent.stream` / `batch` → per-assignment 流式 block（参考 `normalizeHubRuntimeEvents.ts`） |
| C3 | `app/web/src/platform/webHubRealtime.ts` | 新增 `team.subagent.stream` / `batch` 路由分支 → 写入 per-assignment live store；微批复用 `AGENT_STREAM_LIVE_BATCH_WINDOW_MS` |
| C4 | `app/desktop/src/api/teamRunQueries.ts` | `useTeamRunState` 增 `subagent_streams` 字段；新 `useTeamSubagentStream(teamId, runId, assignmentId, afterSeq)` 重连 hook |
| C5 | team run 详情页组件 | 按 `assignment_id` 渲染 live activity 卡（文本/思考/工具/计划），可折叠成 chip（对标 codeg） |
| C6 | 重连 | 进详情页时发 `team.subagent.subscribe` with `after_seq` = 每个 assignment 的 `last_event_seq` |
| C7 | 测试 | `webHubRealtime.test.ts` 扩展：断言 `team.subagent.stream` 写入 per-assignment store；`teamRunQueries` contract test |

**验收**：用户在 team run 详情页看到子 agent 的实时文本/思考/工具流，按 assignment 分卡；刷新后续播不丢中段；可折叠成 chip。

---

## 7. 风险与开放问题

### 风险

| R | 描述 | 缓解 |
|---|---|---|
| R1 | **双投递放大负载** | 同一事件发 `agent.stream` + `team.subagent.stream`。`agent.stream` 高频（per-token）；team 域走 16ms 微批（`team.subagent.batch`）降频。监控 `EventBusPending` + WS send queue 深度 |
| R2 | **LRU 缓存错归属** | task_id 在 assignment 终态后被复用（理论上 uuidv7 不会复用，但 PendingTask ID 在 retry 时会新建）。在 `CompleteAssignment/FailAssignment` 显式 `invalidateTeamRunContext(taskID)` |
| R3 | **跨连接幂等** | `team.subagent.stream` 幂等键 `(agent_task_id, event_seq)` 与 `agent.stream` 一致，但前端两个 store 都 apply 同一事件——需确保 chat store 与 team store 各自独立 apply（已分离，无交叉） |
| R4 | **协议合同面膨胀** | 新增 4 个帧类型 = `frame.go` ↔ `hubEvents.ts` ↔ `openapi.yaml` 三处 1:1。走 #1362/#1422 死面禁令：禁止写回只在 server 存在的 type |
| R5 | **重连 watermark 复杂度** | per-assignment `after_seq` map 在多 assignment run 下前端要维护。提供 REST `GET .../subagent-stream` 兜底全量重拉 |
| R6 | **子 agent 共享 session 的语义边界** | `PushToSession(teamCtx.SessionID)` 会投给所有订阅该 session 的连接，包括 IM 视图。需确认 IM 视图前端按 `type` 过滤（已按 `agent.stream` vs `team.*` 分流，应安全；Phase C 验证） |

### 开放问题（需管理员/团队裁决）

1. **投递目标是 session 还是 user？** `PushToSession(run.SessionID)` 复用现有路由，但 team run 触发者可能在多端。备选 `PushToUser(run.TriggerUserID)`。倾向 `PushToSession`（与 `team.event` 一致），但如果 team run 详情页不在 team session 上下文里打开，需前端订阅 team session。**建议 A4 用 `PushToSession`，Phase C 验证前端是否需要额外 `PushToUser`**。
2. **`team.subagent.stream` 是否进 `agent_run_events` 表二次落库？** 不需要——`agent_run_events` 已是 SSOT，team 域只读投影。但 REST 重放端点（B4）查的是 `agent_run_events`，需确认 team run 删除时 `agent_run_events` 的级联策略（当前按 task_id 级联，team run 删则 task 删则事件删——已满足）。
3. **是否给 supervisor 自身的流也投 `team.subagent.stream`？** supervisor 也是 `run.SessionID` 下的 agent instance。倾向**投**（supervisor 的思考流也属于 team run 直播），但 `assignment_id` 为空（supervisor 无 assignment）。前端按 `member_id == supervisor` 渲染主卡。
4. **微批窗口 16ms 是否够？** codeg 用 RAF（~16ms）。AgentHub `AGENT_STREAM_LIVE_BATCH_WINDOW_MS=16` 已验证。team 域复用同值，Phase C 实测后调。
5. **是否需要 `team.subagent.activity` 状态卡帧？** 可由前端从 `team.subagent.stream` 的 `event_type` 推导（`text_delta`→streaming、`result`→done）。倾向**先不加**，Phase C 看是否需要服务端聚合状态卡。

---

## 8. 关联

- **#1385**（投影层抽取，closed）：本 SPEC 的 Phase B 直接复用 `agent_team_projection.go` 的 `projectTeamRuntimeSummaries` 模式，新增 `projectTeamSubagentStreams` 与之并列。`GetTeamRunState` 是 #1385 留下的扩展点（注释 `// Follow-up (#1385): StartTeamRun is still a large orchestration function... leave that split out of this projection PR`）。
- **#1478**（本 issue）：agentteam 子任务直播，本 SPEC 即其设计文档。
- **#1404**（ACP spike）：codeg 的 `subagent-transcript` 是 ACP 0.63.0 客户端能力。AgentHub 走 edge 自研 adapter 路线，不依赖 ACP，但若未来 ACP spike 产出 ACP adapter，本 SPEC 的事件模型与 ACP `SessionUpdate` 的映射需对齐（`AgentMessageChunk→run.agent.text_delta` 等已天然对齐）。
- **docs/plan/rfc-A-V1-adapters-lifecycle-split.md §3.1(L)** + **docs/archives/analysis/acp-spike-phase1.md §4**（共享耦合面——failure/permission 分类）：RFC A-V1 §3.1(L) 将 `acp.go` 骨架留在 adapters 根包（等 spike 成熟）；ACP spike §4 的 `AcpAdapter` 未来需处理 permission 阻塞往返（`session/request_permission`）与故障分类恢复，而 RFC A-V1 提议的 `adapters/orchestrator` 叶子包已包含 `orchestrator_failure{,_circuit,_classify,_recovery}.go` 全套 failure 子系统。两条演进路径的 failure type 与 permission 分类共享同一耦合面——提前在此标注，防止未来独立演进时产生重复的 failure type 或 permission 枚举。
- **#1406**（@提及=派单）：本 SPEC 不涉及 @ 派单交互，只涉及派单后的可见性。两者正交。

---

## 9. 一句话结论

**AgentHub 的子 agent 流事件已经从 edge 一路发到 hub 落库，只是缺一条「按 team run / assignment 聚合」的 bus→WS 投递路径和一个前端 live activity 卡。Phase A 只动 hub 侧两个文件就能让 `team.subagent.stream` 帧上线可观测；Phase B/C 把投影层和前端补齐。不新增 edge 事件源、不替换 `agent.stream`、不动 chat 胶囊——这是对标 codeg live subagent transcripts 的最小侵入路径。**
