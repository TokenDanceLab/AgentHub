# Reference Workspace Index

最后更新：2026-06-27

`reference/` stores local third-party source checkouts for research only. The cloned source trees are not part of the AgentHub product source, are usually untracked, and must not become active architecture truth.

Current written research entry: [../docs/reference/README.md](../docs/reference/README.md). Historical third-party reports live under [../docs/archive/reference-projects/](../docs/archive/reference-projects/) and related archive folders.

## Tier 0 References

| Repo | Path | Use |
|---|---|---|
| Multica | `reference/multica/` | Product shape, frontend command-center feel, runtime lifecycle |
| OpenAI Codex | `reference/codex/` | Local agent loop, app server, worktree, approval, diff |
| Claude Code source | `reference/claude-code-source/` | Runtime behavior, permissions, hooks, tool calls |

## Other Known Checkouts

| Repo | Path |
|---|---|
| AionUi | `reference/aionui/` |
| aider | `reference/aider/` |
| ChatDev | `reference/ChatDev/` |
| claude-code-viewer | `reference/claude-code-viewer/` |
| claude-code-webui | `reference/claude-code-webui/` |
| claudecodeui | `reference/claudecodeui/` |
| cline | `reference/cline/` |
| continue | `reference/continue/` |
| crush | `reference/crush/` |
| dify | `reference/dify/` |
| eca | `reference/eca/` |
| emdash | `reference/emdash/` |
| Flowise | `reference/Flowise/` |
| goose | `reference/goose/` |
| kanna | `reference/kanna/` |
| langflow | `reference/langflow/` |
| LibreChat | `reference/LibreChat/` |
| opcode | `reference/opcode/` |
| opencode | `reference/opencode/` |
| OpenHands | `reference/OpenHands/` |
| Roo-Code | `reference/Roo-Code/` |

## Sync

```powershell
.\scripts\setup.ps1 -Reference core
.\scripts\sync-reference.ps1 -Tier all
```

If a reference finding affects current implementation, write the conclusion into the owning active doc (`docs/architecture.md`, `api/`, or `AGENTS.md`) and archive long research notes under `docs/archive/`; do not expand this index into a research report.
