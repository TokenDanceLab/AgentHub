# AgentTeam 加速实现计划
n> ⚠️ 已归档（2026-06-05）：内容过时/已迁移。当前权威文档见 `docs/architecture.md` 和 `docs/roadmap.md`。

> 驱动：竞品动态追踪 2026-05-27——AionUI 已发布"团战"模式、Claude Code SDK 有 Teams 原语、Teamily AI 3M 用户
> 状态：草案，待确认

## 一、为什么加速

| 竞品 | 能力 | 发布时间 |
|------|------|:--:|
| AionUI | "团战"模式（Leader/Teammate） | 2026-04 |
| Claude Code SDK | Agent Teams（TeammateIdle/TaskCompleted hooks） | 2026-05 |
| Cursor 3.x | 8 并行 Agent + Bugbot | 2026-05 |
| Codex | MultiAgentV2（thread caps, CSV fanout） | 2026-04 |

AgentHub 当前状态：Hub 有 `AgentTeam`/`AgentTeamMember` model + migration + CRUD routes，Edge 有 subagent 原型。但**没有产品级 TeamRun**——用户不能"拉 Builder + Reviewer + Tester 进群然后一键启动协作任务"。

## 二、最小闭环目标

**用户故事**：在 Desktop 群聊中 @ 两个 Agent Profile，选 Runtime + 模型，AgentHub 自动启动两个并行 run，结果汇总到群聊。

不需要：ReactFlow UI、多轮协调、冲突解决。只要**两个 Agent 同时跑、结果可见**。

## 三、三阶段实现

### Phase 1: TeamRun 启动（1-2 天）

文件范围：`hub-server/internal/` + `edge-server/internal/`

1. Hub `StartTeamRun`：接受 `team_id` + `task_prompt` → 找到绑定的 Agent Profiles → 为每个 profile 创建 `agent.dispatch` task
2. Edge 收到多个 dispatch → 并行启动 adapter（复用现有 `POST /v1/runs`）
3. Desktop bridge 转发结果到 Hub → Hub 写入群聊

关键约束：
- 最多 5 个 agent 并行（`MAX_TEAM_MEMBERS=5`）
- 单次 TeamRun 超时 30 分钟
- 复用现有 `agent.dispatch`/`agent.stream`/`agent.done` 协议，不加新事件类型

### Phase 2: 结果汇总（1 天）

1. Hub `TeamRunState` projection：聚合所有 member run 的状态、输出、artifact
2. Desktop 群聊中展示 TeamRun 摘要卡
3. API：`GET /web/agent-teams/{id}/runs/{run_id}/state`

### Phase 3: 审批集成（1 天）

1. TeamRun 中任一 agent 触发审批 → 通知到群聊
2. 群成员（人类）可 Approve/Reject
3. 复用现有 approval 基础设施

## 四、不做的事

- ~~ReactFlow DAG 可视化~~（IM-native，不做 Canvas-first）
- ~~多轮协调/冲突解决~~（Phase 3+ 的事）
- ~~跨 TeamRun 记忆共享~~（独立功能，P2）
- ~~Cloud Agent 远程执行~~（P3，先本地验证）

## 五、验收

```bash
# Hub: TeamRun 单元测试
go test ./internal/service -run TestStartTeamRun -count=1
go test ./internal/app -run TestTeamRunE2E -count=1

# Edge: 并行 adapter 测试
go test ./internal/lifecycle -run TestParallelRun -count=1

# End-to-end: 两个 mock runtime 同时跑
./scripts/integration-smoke.ps1 -TeamRun
```
