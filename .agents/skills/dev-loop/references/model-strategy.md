# Capability Routing

Use this file only as a routing aid. Do not encode vendor promises, private model aliases, or expected context sizes in project tasks.

## Routing Table

| Need | Preferred route | Notes |
|---|---|---|
| Architecture/security decision | strongest reasoning agent available | Keep the write scope with the main agent unless explicitly delegated. |
| Narrow Go/TypeScript implementation | focused coding agent | Provide exact files, tests, and forbidden paths. |
| Large read-only survey | long-context read-only agent | Ask for findings with file references, not patches. |
| UI/UX or Visual QA | browser/screenshot-capable agent | Pair screenshots with Playwright/geometry checks. |
| Fast sanity check | lightweight review agent | Use for logs, docs, small diffs, and naming consistency. |

## Rules

- State capabilities and task scope, not fixed model identities or local aliases.
- Subagents must receive allowed paths, forbidden paths, verification commands, and a concise report format.
- Main agent reviews every diff before commit.
