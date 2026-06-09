# P0 Dev Script Root Resolution

## Scope

This audit covers the Windows-local stack entry scripts:

- `scripts/dev-start.ps1`
- `scripts/dev-down.ps1`
- `scripts/dev-up.ps1`

The contract is that each script resolves the AgentHub repository root from
its own `scripts/` directory without drifting to the parent workspace
directory.

## Regression Guard

`tests/scripts/verify-dev-stack-root-resolution.ps1` is a no-side-effect
wrapper that:

- copies the current script files into a temporary `AgentHub/` layout;
- injects fake `Start-Process`, `docker`, `go`, and `pnpm` commands;
- opens fake localhost listeners for `dev-start.ps1` readiness checks;
- asserts all derived working directories remain anchored at the temporary
  AgentHub repo root;
- never starts real services, Docker containers, logins, or model/CLI flows.

Run it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/verify-dev-stack-root-resolution.ps1 -RepoRoot .
```

## Expected Behavior

- `dev-start.ps1` starts Edge, Hub, and Desktop from `<repo>\edge-server`,
  `<repo>\hub-server`, and `<repo>\app\desktop`.
- `dev-down.ps1` runs `docker compose down` from `<repo>`.
- `dev-up.ps1` keeps `docker compose` and `go run` anchored at `<repo>`.
- `dev-start.ps1` cleanup must not reuse the read-only `$PID` automatic
  variable name for loop state.
