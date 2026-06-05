> 📦 已归档

# AgentHub 审批

日期：2026-05-21

## 原则

审批既是安全机制，也是产品能力。

AgentHub 应将风险动作以内联审批卡片的形式展示在 Thread 中。

## 审批请求

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

## P0 范围

P0 支持命令审批：

```text
[Claude Code 请求执行命令]
pnpm install && pnpm test

[允许本次] [允许本 Thread] [拒绝] [编辑命令]
```

## 风险规则

高风险动作包括：

- `sudo`
- `rm -rf`
- `curl | sh`
- 读取 `.env`
- 读取 `~/.ssh`
- `git push`
- 部署命令
- 写入 workspace 根目录之外

## 权威

Edge 评估审批策略并记录决策。Runner 在等待审批时暂停执行，仅在 Edge 返回 accepted 决策后恢复。
