# Dirty Tree Policy (AgentHub)

最后更新：2026-07-16  
Issue: #427 (T2.1)  
Branch: `chore/cleanup-baseline`

## Goal

防止本地构建产物与 Tauri 生成物把工作区 / PR 变成噪音，同时不误删真正需要的生成 schema。

## Rules

| Path | Policy | Rationale |
|---|---|---|
| `hub-server/server-hub` | **Never commit**. Ignored. | Local `go build` artifact. Use `go build -o bin/...` or CI artifacts. |
| `edge-server/agenthub-edge` / `agenthub-edge-*` | **Never commit**. Ignored. | Same as above. |
| `app/desktop/src-tauri/gen/android/**` | **Never commit**. Ignored; untracked if present. | Mobile product mainline is `app/mobile-rn` (AGENTS.md). Android Tauri gen is residual noise. |
| `app/desktop/src-tauri/gen/schemas/**` | **May remain tracked** if referenced by `src-tauri/capabilities/*.json` `$schema`. | Needed for Tauri capability schema validation; regenerate with Tauri tooling when needed. |
| `*.exe`, `*.test`, `*.out`, coverage | Already ignored | Standard |

## Operator actions

```bash
# If binary reappears:
rm -f hub-server/server-hub edge-server/agenthub-edge

# If android gen reappears locally after tauri gen:
# already gitignored; do not force-add

# Verify clean policy on a fresh clone after merge:
git status --short
```

## Non-goals

- Does not delete Mobile RN (`app/mobile-rn`)
- Does not rewrite Tauri packaging pipeline
- Does not force-remove `gen/schemas` while capabilities still point at them
