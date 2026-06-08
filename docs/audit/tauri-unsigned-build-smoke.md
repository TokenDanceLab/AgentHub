# Tauri Unsigned Build Smoke

Date: 2026-06-09
Branch/worktree: `codex/p1-tauri-unsigned-build-smoke` / `.worktrees/p1-tauri-unsigned-build-smoke`
Base HEAD: `fd94c54d` from `origin/codex/p1-remote-control-integration`

## Result

- Windows Desktop dependency install passed from the app workspace lockfile.
- Windows Local Edge sidecar compiled and was copied to Tauri's external sidecar name.
- Tauri executable compile passed with `pnpm tauri build --no-bundle`.
- Local unsigned Windows NSIS bundle passed and produced `AgentHub_0.3.0-rc.6_x64-setup.exe`.
- Portable dry package was created with `AgentHub.exe`, `agenthub-edge.exe`, and `README.txt`.
- Updater metadata was not produced by the unsigned local build: no `latest.json` or `.sig` appeared. The dry report records this as `not_produced_unsigned_build`.

## Command

Exact smoke command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-dry.ps1 -RepoRoot . -RunWindowsBundle -StrictToolchain
```

Short form:

```powershell
.\scripts\verify-tauri-package-dry.ps1 -RepoRoot . -RunWindowsBundle -StrictToolchain
```

## Artifacts

Artifact root from the successful local run:

`D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry`

| Artifact path | Bytes | SHA-256 |
|---|---:|---|
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\agenthub-edge-windows-amd64.exe` | 25497600 | `230BF4B885A97EDF1B3458C7248E6C81AED41AA7F1D03BF6E557FB8C2DC3086E` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\agenthub-desktop.exe` | 19184640 | `6C920A3029F232BB71F14F909D8ED6962E4C443E9B81589CD32D6410ABC4BECA` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\AgentHub_0.3.0-rc.6_x64-setup.exe` | 12131501 | `7C3F97A5AE9BFC06643D6F1FC0637B00E7A8EB6F43230030B06908EDCD956CE6` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\AgentHub_0.3.0-rc.6_x64-portable.zip` | 16180993 | `F5BC25047858139D60EF06A0B785D5985E0418EED9A89B7A2470433D05248ADB` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\package-dry-report.json` | 1096 | `954D7ADD49CA029CF5EDECF41D5B719A34BFD2F784E76568598066073942BE85` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\.tmp\tauri-package-dry\artifact-manifest.json` | 912 | `AAC68A30A1C6F8C20A787D94009DBE99F131DA6B8B8D194692D29D7C6B91EC2B` |
| `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-unsigned-build-smoke\app\desktop\src-tauri\target\release\bundle\nsis\AgentHub_0.3.0-rc.6_x64-setup.exe` | 12131501 | `7C3F97A5AE9BFC06643D6F1FC0637B00E7A8EB6F43230030B06908EDCD956CE6` |

All listed artifacts are under ignored output paths.

## Verification

- Tauri package readiness gate: passed as part of `verify-tauri-package-dry.ps1`.
- Windows installer smoke preflight with `-StrictToolchain`: passed as part of `verify-tauri-package-dry.ps1`.
- Desktop typecheck: `corepack.cmd pnpm typecheck` in `app\desktop` passed.
- Tauri Rust tests: `cargo test` in `app\desktop\src-tauri` passed with 22 tests, 0 failures.
- Diff hygiene: `git diff --check` passed.

## Boundaries

- This was an unsigned local Windows build smoke only.
- No Authenticode signing key was used or required.
- No macOS Developer ID signing, notarization, or stapling was attempted.
- No GitHub Release was created, uploaded to, edited, or published.
- No tag was created or pushed.
- No updater `latest.json` or `.sig` was produced or published by this unsigned local build.
- No real TokenDance ID, production endpoint, CLI runtime, or model execution was exercised.

## Warnings

- Vite reported chunk-size warnings and dynamic/static import chunk placement warnings around Tauri API imports and plugin imports.
- Vite reported a circular manual chunk warning: `vendor-react -> vendor-tanstack -> vendor-react`.
- Rust reported one dead-code warning: `replace_workspace_roots_from_store` in `app\desktop\src-tauri\src\commands.rs`.

## Next Steps

- For signed Windows release approval, run a separate release slice that explicitly enables Authenticode signing, records secret boundaries, proves `latest.json` and `.sig` generation, and keeps GitHub Release upload behind approval.
- For macOS build proof, run a separate macOS unsigned build slice on a macOS runner or local macOS host, then separately approve Developer ID signing, notarization with `notarytool`, and stapling.
- Keep updater publication as a release approval gate, not as part of unsigned local smoke.
