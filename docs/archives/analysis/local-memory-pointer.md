# Local agent memory pointer policy

> pending external archive — see docs/history.md

最后更新：2026-07-16
Issue: #428 (T2.2)

## Decision

`.agenthub/memory/**` is **gitignored local scratch**, not SSOT.

Operators/agents that still read `.agenthub/memory/project.md` should find only:

- pointers to `AGENTS.md`, `docs/progress/MASTER.md`, GitHub `cleanup-baseline` issues
- production pointer to server STATE (LIVE)
- explicit **no SUPER phase / no competing backlog**

## Actions taken

- Rewrote local `project.md` content on developer machines/worktree to pointer form (not committed; ignored).
- Tracked this policy in `docs/analysis/local-memory-pointer.md`.

## Non-goals

- Does not commit secrets or host paths
- Does not replace Claude native project memory
