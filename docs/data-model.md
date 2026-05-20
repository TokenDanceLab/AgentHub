# AgentHub Data Model

Date: 2026-05-21

## Core Shape

AgentHub should not model coding-agent work as plain chat messages only. It uses a richer model:

```text
Project
  -> Conversation
      -> Thread
          -> Turn / AgentRun
              -> Item
                  -> Artifact
```

## Concepts

| Concept | Meaning |
|---|---|
| Project | Local or remote workspace root |
| Conversation | IM shell: direct/group conversation and authority boundary |
| Thread | Task branch inside a conversation |
| Turn | One user/agent execution round |
| AgentRun | Runtime execution of an agent turn |
| Item | Streamed unit inside a turn |
| Artifact | Durable output such as diff, log, preview, file |

## Type Sketch

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

## Mapping

```text
Conversation = IM shell
Thread       = task branch
Turn         = one interaction/execution round
Item         = streamed event inside the turn
Artifact     = durable output addressable from UI
```

This supports IM-style interaction while preserving coding-agent execution detail.
