# External Archive Receiver

## Current State

`D:\Code\TokenDance\docs` is an independent Git repository. Its main checkout is dirty with existing modifications, deletions, and untracked files, so AgentHub archive migration must not write there directly.

## Selected Receiver

| Field | Value |
|---|---|
| Docs repo main checkout | `D:\Code\TokenDance\docs` |
| Receiver worktree | `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive` |
| Receiver branch | `docs/agenthub-archive-receiver` |
| Base | `origin/master` at `775d7f5` |
| Status after creation | clean |
| Archive commit | TokenDanceLab/docs merge commit `8417e00b`; source archive commit `e94cb7d` |
| Archive PR | TokenDanceLab/docs#1, merged |

## Target Layout

Preserve AgentHub source paths under the TokenDance docs archive:

```text
archive/agenthub/repo/docs/archive/
archive/agenthub/repo/docs/archives/
archive/agenthub/repo/docs/adr/
archive/agenthub/repo/root-evidence/
archive/agenthub/README.md
```

This keeps historical paths understandable while allowing the AgentHub source repo to replace those trees with short active indices.

## Migration Rules

1. Copy archive material into the receiver worktree, not the dirty docs main checkout.
2. Commit only AgentHub archive additions in the receiver branch.
3. In AgentHub, use Git-tracked deletes for migrated history trees and leave `docs/history.md` plus, in #363, `docs/decisions.md`.
4. Do not move `scripts/` or `tests/` in the same PR as archive/ADR migration.
5. Record the external docs commit hash in AgentHub progress and PR body before claiming final acceptance.

## Verification Notes

- 173 tracked AgentHub history files were copied and SHA256-verified before external source commit `e94cb7d`.
- The new external archive index passed `git diff --cached --check -- archive/agenthub/README.md`.
- Full external archive whitespace check reports trailing whitespace in preserved historical Markdown. Those copied files were not reformatted in the receiver commit.

## Verification Before Migration PR

```powershell
git -C D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive status --short --branch
git -C D:\Code\TokenDance\docs status --short --branch
```

The receiver must be clean before copying. The main docs checkout may remain dirty, but those changes must not be staged or committed by this SPEC.
