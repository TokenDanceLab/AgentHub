> 📦 已归档

# AgentHub 数据模型

日期：2026-05-21

## 核心形态

AgentHub 不应把 coding-agent 工作建模为纯聊天消息。它使用更丰富的模型：

```text
Project
  -> Conversation
      -> Thread
          -> Turn / AgentRun
              -> Item
                  -> Artifact
```

## 概念

| 概念 | 含义 |
|---|---|
| Project | 本地或远程 workspace 根目录 |
| Conversation | IM 外壳：单聊/群聊会话和权威边界 |
| Thread | 会话内的任务分支 |
| Turn | 一轮用户或 agent 执行 |
| AgentRun | 一次 agent turn 的运行时执行 |
| Item | turn 内的流式单元 |
| Artifact | 持久化产出物，如 diff、日志、preview、文件 |

## 类型速写

```ts
type Project = {
  id: string
  name: string
  rootPath: string
  memoryPath: string
}

type Conversation = {
  id: string
  projectId: string
  type: "direct" | "group"
  title: string
  authority: ConversationAuthority
  executionAuthority?: ExecutionAuthority
}

type Thread = {
  id: string
  conversationId: string
  projectId: string
  title: string
  status: "open" | "running" | "blocked" | "done" | "archived"
  rootMessageId?: string
  currentRunId?: string
}

type Turn = {
  id: string
  threadId: string
  runId?: string
  actorId: string
  status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled"
  startedAt: string
  endedAt?: string
}

type Item = {
  id: string
  threadId: string
  turnId: string
  type:
    | "user_message"
    | "agent_message"
    | "reasoning_summary"
    | "shell_command"
    | "command_output"
    | "file_change"
    | "diff"
    | "preview"
    | "approval_request"
    | "approval_decision"
    | "error"
  payload: unknown
  createdAt: string
}
```

## 映射

```text
Conversation = IM 外壳
Thread       = 任务分支
Turn         = 一次交互/执行轮次
Item         = turn 内的流式事件
Artifact     = 可从 UI 寻址的持久化产出物
```

这套模型在保留 coding-agent 执行细节的同时，支持 IM 风格的交互。
