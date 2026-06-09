# P1 Tauri Package Runtime Evidence

Date: 2026-06-09
Worktree: `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-package-runtime-evidence`
Branch: `codex/p1-tauri-package-runtime-evidence`
Base: `56d0da1d1f13f1a4daf682c8d914ec2dd43fef97`

## Scope

This pass tightens Desktop package/install readiness evidence after the existing unsigned Windows build proof. It focuses on the installed Local Edge sidecar boundary: packaged sidecar name, current-user installer scope, app-data SQLite path, stdout/stderr logs, startup/readiness command surface, workspace permission fail-closed behavior, and macOS executable gates.

No signing, notarization, stapling, updater metadata publication, release upload, tag, push, merge, real TokenDance ID login, real CLI runtime, or model execution was performed.

## Added Gate

New checker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-sidecar-runtime-evidence.ps1 -RepoRoot .
```

Test wrapper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-sidecar-runtime-evidence.ps1 -RepoRoot .
```

The checker is static by default and has an optional artifact mode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-sidecar-runtime-evidence.ps1 `
  -RepoRoot . `
  -BuiltArtifactsRoot .tmp\tauri-package-dry `
  -RequireBuiltArtifacts
```

Artifact mode inspects the unsigned Windows setup, portable zip, Windows sidecar dry artifact, package dry report, and artifact manifest. It requires `AgentHub.exe`, `agenthub-edge.exe`, and `README.txt` inside the portable zip, but it does not require updater `latest.json` or `.sig` because unsigned local builds currently do not produce updater metadata.

## Windows Runtime Readiness

Verified by the new static gate:

- Tauri package metadata remains aligned and `com.agenthub.desktop` is stable.
- Windows package target remains NSIS, scoped to `currentUser`.
- Tauri `externalBin` declares `binaries/agenthub-edge`.
- Windows sidecar output path is ignored: `app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe`.
- Local Edge runtime uses sidecar name `agenthub-edge`.
- Packaged Local Edge state resolves under Tauri app data as `<app-data>/agenthub-edge.sqlite`.
- Local Edge launch args use `--store-backend sqlite --store-db <app-data>/agenthub-edge.sqlite --addr 127.0.0.1:3210 --runner-profile claude-code`.
- Runtime readiness exposes `health_url` at `http://127.0.0.1:3210/v1/health`.
- stdout/stderr diagnostics are written to `<app-data>/edge-logs/local-edge.stdout.log` and `<app-data>/edge-logs/local-edge.stderr.log`.
- Sidecar stdout/stderr events are captured through `CommandEvent::Stdout` / `CommandEvent::Stderr`.
- Token generation failure keeps Local Edge startup blocked instead of starting without auth.
- Desktop host readiness keeps `direct_cli_spawn=false`; renderer state does not receive raw CLI command/path controls.
- Workspace file access fails closed before native host picker authorization and rejects path/symlink escapes.

## macOS Gates

Current macOS status remains policy-only until a macOS runner or host executes an unsigned package pass.

Executable gates recorded by scripts/docs:

1. Build macOS arm64 Local Edge sidecar as `app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin`.
2. Run macOS unsigned package proof on macOS with explicit app/DMG expectations: `AgentHub.app` and `AgentHub_${version}_aarch64.dmg`.
3. Keep unsigned proof as workflow artifacts only.
4. Keep Apple Developer ID signing as a separate approval slice.
5. Keep `notarytool` notarization and `stapler staple` as separate approval slices.
6. Keep GitHub Release upload and production updater metadata publication as separate approval slices.

The existing readiness checker rejects `codesign`, `notarytool`, `stapler`, GitHub Release upload, and updater publication actions inside the macOS unsigned dry policy job.

## Verification

Commands run in this worktree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-sidecar-runtime-evidence.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-sidecar-runtime-evidence.ps1 -RepoRoot .
```

The broader Tauri readiness and dry gates remain:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-dry.ps1 -RepoRoot .
```

## Remaining Blockers

- The local repository object store has unrelated corruption/noise: `git fetch` completed the target branch update, but automatic gc/repack failed on `bad tree object fff550960821b6454a476d755465c71d9deaa258`; `git fsck --connectivity-only --no-dangling` reports many missing blobs. This pass did not repair shared object-store state.
- Unsigned Windows build proof exists from prior integrated evidence, but this pass did not rerun a full NSIS build.
- Updater metadata remains unproven for unsigned local builds because no `latest.json` or `.sig` is produced without the later signing/updater artifact policy.
- macOS package proof remains policy-only until executed on macOS.

## Non-Goals

- No signing certificate or updater signing private key.
- No Apple notarization or stapling.
- No updater metadata publication.
- No GitHub Release upload.
- No tag, push, merge, or release approval action.
- No real TokenDance ID login.
- No real CLI/model execution.
