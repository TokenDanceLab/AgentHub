# AgentHub 权威模型

日期：2026-05-21

## 原则

AgentHub 将会话、执行、产物和 memory 的归属分离。

```text
Conversation Authority = 谁拥有消息/群组/thread 的主序列
Execution Authority    = 任务实际在哪里运行
Artifact Authority     = artifact 字节存在哪里、谁有权提供
Memory Authority       = 持久化项目/agent/会话 memory 写到哪里
```

这避免了 Hub 会话触发远程 Desktop Edge 或 Cloud Edge 上的工作时出现双重写入。

## Conversation Authority

```ts
type ConversationAuthority =
  | { type: "edge"; edgeId: string }
  | { type: "hub"; hubId: string }
```

Conversation Authority 拥有：

- 消息追加顺序
- 群组成员变更
- thread 创建
- 消息 ID
- 会话摘要检查点

### IM 写入规则

#### 1. `authority = edge`

```text
Desktop UI -> Edge -> 追加消息
Edge -> EdgeEvent(message.created)
Edge -> Hub 同步副本（在线时）
```

规则：

- Desktop UI 只向 Edge 写入消息。
- Edge 生成权威的本地消息序列。
- Hub 接收同步副本。
- Hub 不得重写主消息序列。

#### 2. `authority = hub`

```text
Web/Mobile/Desktop -> Hub -> 追加消息
Hub -> message.deliver -> Edge 缓存/执行
```

规则：

- Web、Mobile 和 Desktop 向 Hub 写入消息。
- Hub 生成全局消息序列。
- Edge 接收 `message.deliver` 用于本地缓存和执行。
- Edge 不得为同一会话追加竞争的主消息。

#### 3. Hub 控制的远程执行

```text
Hub 会话 -> Hub 消息序列
Hub -> run.start -> target Edge
Edge -> RunnerCommand
Edge -> RunnerEvent -> Hub
Hub -> 追加状态/artifact 消息
```

规则：

- Hub 持有消息主序列。
- Edge 执行命令并返回事件。
- Edge 可以存储本地 run 缓存，但 Hub 拥有用户可见的消息顺序。

## Execution Authority

```ts
type ExecutionAuthority = {
  edgeId: string
  runnerId: string
  workspaceId: string
}
```

Execution Authority 拥有：

- workspace 根目录选择
- 进程生命周期
- 命令审批边界
- runner 健康状态
- 原始 stdout/stderr 采集
- 本地 preview 进程

Execution Authority 不拥有 IM 消息序列，除非同一 Edge 同时也是 Conversation Authority。

## Artifact Authority

```ts
type ArtifactAuthority =
  | { type: "edge"; edgeId: string }
  | { type: "hub-cache"; hubId: string }
  | { type: "object-storage"; bucket: string }
```

Artifact Authority 拥有 artifact 字节。Artifact 元数据可以复制到 Hub，但大内容应留在执行节点附近，除非显式缓存。

规则：

- Runner 创建原始日志、diff、preview 引用和文件。
- Edge 索引 artifact 元数据并拥有本地 artifact 提供。
- Hub 可以缓存小型/高价值 artifact。
- Workspace 内容默认不上传。

## Memory Authority

```ts
type MemoryAuthority =
  | { type: "project-edge"; edgeId: string; projectId: string }
  | { type: "agent-edge"; edgeId: string; agentId: string }
  | { type: "hub"; hubId: string; scope: "team" | "global" }
```

规则：

- `.agenthub/` 下的项目 memory 由拥有项目 workspace 的 Edge 拥有。
- Agent memory 可以本地于 Edge，也可以同步到 Hub，取决于 agent 类型。
- Hub 拥有团队/全局 memory 和同步索引。
- 自动 memory 写入应先产生建议卡片；确认后的写入更新权威所有者。

## 权威矩阵

| 场景 | Conversation Authority | Execution Authority | Artifact Authority | Memory Authority |
|---|---|---|---|---|
| Desktop 本地离线 | Local Edge | Local Edge + Runner | Local Edge | Project Edge |
| Desktop 本地在线 | Local Edge, Hub sync copy | Local Edge + Runner | Local Edge, optional Hub cache | Project Edge, Hub index |
| Desktop 直连远程 | Local Edge | Remote Edge + Runner | Remote Edge | Remote Project Edge |
| Desktop 中继远程 | Local Edge or Hub | Remote Edge + Runner | Remote Edge, Hub proxy | Remote Project Edge |
| Web 中继 Desktop | Hub | Desktop Edge + Runner | Desktop Edge, Hub proxy/cache | Desktop Project Edge + Hub index |
| Web 中继 Cloud | Hub | Cloud Edge + Runner | Cloud Edge or object storage | Cloud Project Edge / Hub |

## 实现规则

每个 `Conversation` 应携带 `authority`。每个 `Run` 应携带 `executionAuthority`。每个 `Artifact` 应携带 `location` 和 `authority`。

没有这些字段，远程执行和同步最终会变得模糊不清。
