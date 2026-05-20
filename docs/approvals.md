# AgentHub Approvals

Date: 2026-05-21

## Principle

Approval is both a safety mechanism and a product affordance.

AgentHub should surface risky actions as inline approval cards in the Thread.

## Approval Request

```ts
type ApprovalRequest = {
  id: string
  turnId: string
  runId: string
  kind: "shell_command" | "file_write" | "network" | "deploy"
  title: string
  detail: string
  riskLevel: "low" | "medium" | "high"
  status: "pending" | "accepted" | "declined" | "cancelled"
}

type ApprovalDecision =
  | { type: "accept" }
  | { type: "acceptForThread" }
  | { type: "acceptForSession" }
  | { type: "decline"; reason?: string }
  | { type: "cancel" }
```

## P0 Scope

P0 supports command approvals:

```text
[Claude Code requests command]
pnpm install && pnpm test

[Allow once] [Allow for Thread] [Decline] [Edit command]
```

## Risk Rules

High-risk actions include:

- `sudo`
- `rm -rf`
- `curl | sh`
- reading `.env`
- reading `~/.ssh`
- `git push`
- deploy commands
- writing outside workspace root

## Authority

Edge evaluates approval policy and records decisions. Runner pauses execution while waiting for approval and resumes only after Edge returns an accepted decision.
