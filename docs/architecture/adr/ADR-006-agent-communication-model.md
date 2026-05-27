# ADR-006: Agent 间通信模型——结构化委派 vs 自由聊天

状态：已决策（2026-05-26）| 决策者：项目总负责人

## 背景

AgentHub 当前有三块 Agent 相关能力：

1. **Hub IM 层**：`AgentInstance` 能加入群聊，`TriggerAgentTask` 让人点名 Agent 执行任务
2. **Desktop Bridge**：把 Hub 的 `agent.dispatch` 转成 Edge `POST /v1/runs`
3. **Edge Runtime**：本地 `OrchestratorAdapter` 有子 Agent registry、内存 MessageQueue、ResultAggregator

但 Agent 和 Agent 之间**没有产品级的通信通道**。Edge 的 MessageQueue 是进程内存 channel，不持久化、Hub 不可见、崩溃即丢失。

## 核心问题

Agent 之间的交互应该用什么模型？

**选项 A：IM 聊天式** — Agent 像人一样在 session 里发消息
**选项 B：结构化委派式** — Agent 通过 typed TeamAssignment 委派任务

## 决策

**选择 B（结构化委派）作为 Agent 间通信主路径。IM 消息只作为可选的"人可读投影"，不作为 Agent 通信的事实源。**

理由：

1. Agent 之间的交互是**结构化的**——委派任务、返回结果、请求审批——不是自由聊天。把结构化语义硬塞进 chat message 会导致类型丢失和状态机混乱
2. 人需要**审计和恢复**——如果子 Agent 崩溃，需要知道谁委派了什么、完成了什么、链上有谁在等。IM 消息顺序流不适合做这种查询
3. IM 消息模型（send/edit/recall/reply）和 Agent 通信需求（delegate/review/approve/notify）语义不匹配
4. Hub 必须是所有 Agent 通信的 **SSOT**（单一事实源），不能允许 Edge 本地 channel 绕过

## 分层模型

```
┌──────────────────────────────────────────────────────────┐
│                    Hub (SSOT)                             │
│                                                           │
│  AgentTeam → TeamRun → TeamAssignment                    │
│    │           │           │                              │
│    │           │           ├─ type: delegate | review     │
│    │           │           │        | approve | notify    │
│    │           │           ├─ from_member_id              │
│    │           │           ├─ to_member_id                │
│    │           │           ├─ status 状态机               │
│    │           │           └─ result (typed)              │
│    │           │                                          │
│    │           └─ TeamRunEvent (append-only)              │
│    │              ├─ assignment.created                   │
│    │              ├─ assignment.dispatched                │
│    │              ├─ assignment.completed                 │
│    │              ├─ assignment.failed                    │
│    │              └─ agent.message (可选人可读投影)        │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                  Hub Dispatch                             │
│                                                           │
│  Supervisor 输出 delegation 指令                          │
│    → Hub 解析并创建 TeamAssignment                       │
│    → Hub 找到目标 Agent 的 Desktop/Edge                  │
│    → 通过 agent.dispatch 下发（复用现有机制）             │
│    → payload 携带 assignment_id + team_run_id            │
│                                                           │
├──────────────────────────────────────────────────────────┤
│              Edge Runtime (执行)                          │
│                                                           │
│  Desktop 收到 dispatch:                                   │
│    → 启动 Edge Run                                       │
│    → typed RunEvent 回传 Hub                             │
│    → Hub 更新 TeamAssignment.status                      │
│    → Hub notify Supervisor（dispatch 回调或 event）      │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## 委派权限模型

| 角色 | 可以委派给 | 可以被委派 | 可以审批 |
|------|:--:|:--:|:--:|
| **Supervisor** | 任何人 | 无人（最高决策者） | 所有人 |
| **Executor** | 无人 | Supervisor | 无人 |
| **Reviewer** | 无人 | Supervisor | 自己的 review assignment |

规则：
- Supervisor 是唯一可以做跨成员委派的角色
- Executor 只能执行，不能委派。需要帮助时通过 team message 通知 Supervisor
- Reviewer 只做审批，不执行也不委派
- 同一条 assignment 链上禁止循环（通过 ancestor chain 检查）

## 委派生命周期状态机

```
                     ┌──────────┐
                     │ pending  │  ← Hub 创建但尚未 dispatch
                     └────┬─────┘
                          │ agent.dispatch 下发成功
                     ┌────▼─────┐
                     │dispatched│  ← Desktop 已收到
                     └────┬─────┘
                          │ Edge run started
                     ┌────▼─────┐
                     │ running  │
                     └────┬─────┘
                    ╱     │     ╲
                   ╱      │      ╲
          ┌───────┐  ┌────▼────┐  ┌────────┐
          │failed │  │  done   │  │cancelled│
          └───────┘  └─────────┘  └────────┘
```

## 防护规则

| 规则 | 值 | 原因 |
|------|:--:|------|
| 最大委派深度 | 3 层 | 防止无限递归（Supervisor → A → B → C，C 不能再委派） |
| 单 Agent 活跃子任务上限 | 5 | 防止一个 Agent 创建海量子任务 |
| 同链禁止重复 | 是 | 同一条 ancestor chain 上同一 Agent 不能出现两次 |
| 超时 | 30 分钟 | 单个 TeamAssignment 默认超时，超时后标记 failed |
| 预算隔离 | 继承 | 子 Agent 的 token 预算从父 Agent 分配，不能超过 |

## 与现有系统的关系

| 现有组件 | 如何处理 |
|---------|---------|
| `AgentInstance` | 保留，作为 TeamRun 的 session member。TeamAssignment 引用 AgentInstance |
| `PendingAgentTask` | 保留，作为 dispatch 载体。TeamAssignment 触发时创建 PendingAgentTask |
| `agent.dispatch` WS 消息 | 保留并扩展，payload 增加 `team_run_id` 和 `assignment_id` |
| `OrchestratorAdapter` | **重构**：不再自己做子 Agent spawn，改为输出 delegation 指令由 Hub 解析 |
| Edge `MessageQueue` | **弃用**：不再使用进程内存 channel，所有 Agent 通信回 Hub |
| `agent_run_events` | 保留并扩展，每条 TeamAssignment 关联到具体 RunEvent |

## 对 IM 投影的约束

每个 TeamAssignment 的状态变更**可以**投影一条 `message.new` 到 TeamRun 的群聊 session：

```
[Team] Supervisor → Codex: "帮我重构 auth.go 的错误处理"
[Team] Codex → Supervisor: "完成，修改了 4 个文件，见 run_abc123"
```

但这些消息是**只读投影**，Agent 不读取它们来做决策。Agent 只消费 Hub 下发的 typed dispatch payload。

## 拒绝的替代方案

| 方案 | 为什么拒绝 |
|------|-----------|
| Agent 直接写 Hub message 通信 | 结构化语义丢失，状态机混乱，无法审计恢复链 |
| Edge 本地 channel 做主路径 | Hub 不可见，崩溃丢失，无法跨设备 |
| Agent 间 WebSocket 直连 | 绕过 Hub 权限和审计，安全不可控 |
| 固定 YAML 拓扑（ChatDev 模式） | 限制 Agent 动态调度，不适合开放场景 |
| Canvas-first workflow（Flowise 模式） | AgentHub 是 IM-native，画布只做可视化 |
