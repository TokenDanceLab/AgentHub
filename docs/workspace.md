# AgentHub Workspace And Worktree

Date: 2026-05-21

## Principle

Every AgentRun should use its own worktree.

This prevents multiple agents from mutating the main workspace or each other's changes.

## Runtime Layout

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

## Run Flow

1. Edge creates AgentRun.
2. Runner creates git worktree.
3. Agent CLI runs inside the worktree.
4. Runner detects changed files.
5. Runner generates unified diff.
6. UI shows Diff artifact.
7. User chooses Apply or Discard.
8. Apply merges/applies patch to the target workspace.
9. Discard removes the worktree and patch.

## P0 Requirements

- Create worktree.
- Detect changed files.
- Generate diff.
- Apply patch.
- Discard worktree.
- Record log paths.

## Ownership

Runner owns the worktree lifecycle. Edge owns metadata and user-visible state.

Hub only syncs artifact metadata unless a user explicitly uploads/caches artifact content.
