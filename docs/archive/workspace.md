> 📦 已归档

# AgentHub Workspace 和 Worktree

日期：2026-05-21

## 原则

每个 AgentRun 应使用独立的 worktree。

这可以防止多个 agent 同时修改主 workspace 或互相覆盖对方的变更。

## 运行时布局

```text
.agenthub-runtime/
  projects/
    project_x/
      repo/
      worktrees/
        run_001_claude/
        run_002_codex/
        run_003_opencode/
      patches/
        run_001.patch
      logs/
        run_001.stdout.jsonl
        run_001.stderr.jsonl
      previews/
        run_001.json
```

## Run 流程

1. Edge 创建 AgentRun。
2. Runner 创建 git worktree。
3. Agent CLI 在 worktree 内运行。
4. Runner 检测文件变更。
5. Runner 生成 unified diff。
6. UI 展示 Diff artifact。
7. 用户选择 Apply 或 Discard。
8. Apply 将 patch 合并/应用到目标 workspace。
9. Discard 删除 worktree 和 patch。

## P0 要求

- 创建 worktree。
- 检测文件变更。
- 生成 diff。
- 应用 patch。
- 丢弃 worktree。
- 记录日志路径。

## 归属

Runner 拥有 worktree 生命周期。Edge 拥有元数据和用户可见状态。

Hub 只同步 artifact 元数据，除非用户显式上传/缓存 artifact 内容。
