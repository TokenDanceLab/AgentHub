# Local agent memory pointer policy

> 活引用保留 — 本文件仍被 AGENTS.md §local memory 引用为指针 SSOT，故保留于 archives/analysis/，未外迁。cleanup-baseline/ 中的字节级重复副本已删除。

最后更新：2026-07-16
Issue: #428 (T2.2)

## Decision

`.agenthub/memory/**` is **gitignored local scratch**, not SSOT.

Operators/agents that still read `.agenthub/memory/project.md` should find only:

- pointers to `AGENTS.md`, `docs/progress/MASTER.md`, GitHub `cleanup-baseline` issues
- production pointer to server STATE (hk3 LIVE)
- explicit **no SUPER phase / no competing backlog**

## Actions taken

- Rewrote local `project.md` content on developer machines/worktree to pointer form (not committed; ignored).
- Tracked this policy in `docs/analysis/local-memory-pointer.md`.

## Non-goals

- Does not commit secrets or host paths
- Does not replace Claude native project memory
