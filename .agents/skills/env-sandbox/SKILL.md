---
name: env-sandbox
description: "Safely manage subprocess environments for AI agent CLIs — whitelist-based env filtering, runtime vars injection, and sensitive key detection."
---

# Env Sandbox — Agent Subprocess Environment Isolation

> Every time an agent subprocess is spawned, its environment is filtered. This
> skill documents the whitelist pattern, the single point of injection, and how
> to add new variables safely.

## When to Use

- When adding environment variables to agent subprocesses
- When debugging "agent CLI fails to start" issues through Edge Server
- When auditing or extending the whitelist

## Architecture

| File | Role |
|---|---|
| `edge-server/internal/lifecycle/env_sanitizer.go` | `SanitizedEnv()`, `IsSensitiveEnvKey()`, `isWhitelistedEnvKey()` |
| `edge-server/internal/lifecycle/process_executor.go` | `envForRun()` — single point where AGENTHUB_* runtime vars are appended |
| `edge-server/internal/runnerctx/context_budget.go` | `ContextBudget` model for token-tracking in stream parsers |

## Key Principles

1. **Whitelist, not blacklist** — Start from empty, only pass through known-safe variables.
2. **Single source of truth** — `envForRun` is the ONLY place `AGENTHUB_RUN_ID`, `AGENTHUB_PROJECT_ID`, and `AGENTHUB_THREAD_ID` are added. Adapters must never set these.
3. **Adapter env is nil** — Adapters return nil/empty env slice; no per-adapter env logic.
4. **Cross-platform** — Use `runtime.GOOS` for platform-specific whitelists (Windows vs Unix/macOS).
5. **Sensitive key detection** — `IsSensitiveEnvKey` catches `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD` suffixes plus exact-match well-known secrets.
6. **XDG compliance** — Prefix-match `XDG_*` and `LC_*` for Unix desktop standards.

## Whitelist Categories

- **Cross-platform**: `HOME`, `USER`, `PATH`, `LANG`, `SHELL`, `TERM`, `EDITOR`, `TMPDIR`, `TEMPDIR`
- **Language ecosystems**: Go (`GOPATH`, `GOROOT`), Node (`NODE_PATH`, `NVM_DIR`), Python (`PYTHONPATH`, `VIRTUAL_ENV`), Java (`JAVA_HOME`), Rust (`CARGO_HOME`)
- **Proxy**: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (both cases)
- **Windows**: `SYSTEMROOT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `COMSPEC`
- **Unix/macOS**: `DISPLAY`, `WAYLAND_DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, `SSH_AUTH_SOCK`
- **AgentHub**: Prefix-match `AGENTHUB_*` always passes

## Adding a New Variable

1. Determine if it is cross-platform or OS-specific.
2. Add to the appropriate slice in `isWhitelistedEnvKey()`.
3. Add a test case in `env_sanitizer_test.go`.
4. If the variable name looks like a secret, add it to `IsSensitiveEnvKey()` instead.

## Testing

- `edge-server/internal/lifecycle/env_sanitizer_test.go` — Whitelist inclusion, sensitive key detection, Windows-specific vars.
- `edge-server/internal/lifecycle/process_executor_test.go` — End-to-end env isolation with a real subprocess.
