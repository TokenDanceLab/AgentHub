# Desktop Run Workbench Live Smoke - 2026-05-31

## Scope

This records the Team A live-smoke attempt for the Run Workbench closure round.
The target workflow was Local Edge plus at least one real Runtime, covering run
start, terminal replay, cancel, offline reconnect, and active-run count recovery.

## Environment Probe

- Local Edge health at `http://127.0.0.1:3210/v1/health`: unavailable.
- Local Edge agents at `http://127.0.0.1:3210/v1/agents`: unavailable because Edge was not running.
- Local Edge runs at `http://127.0.0.1:3210/v1/runs`: unavailable because Edge was not running.
- Go toolchain: not available on PATH or common local install locations checked by the smoke pass.
- Prebuilt Edge binary: no `edge-server/*.exe` binary was present in this worktree.
- Runtime CLI availability: Codex and Claude CLIs were discoverable; OpenCode was not discoverable.

## Result

Live Runtime smoke is locked for this machine until Local Edge can be started.
The smoke did not claim success from mock data. Because the Edge process could
not be launched, no real run start, terminal replay, cancel, offline reconnect,
or active-run recovery evidence was produced in this pass.

## Repeatable Next Check

Once Go or a prebuilt Edge binary is available:

```powershell
.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3210
```

For a real Runtime smoke, start Edge with one available Runtime profile instead
of the built-in mock profile, then verify `/v1/agents`, `/v1/runs`, and
`/v1/events` against the same run id.

## Contract Notes

- Do not mark the live Runtime path as passed unless events come from a real
  Runtime adapter.
- If no Runtime is available, Desktop must keep showing the Runtime as
  unavailable or locked, and should not substitute a fake successful run.
