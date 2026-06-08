# P0 Desktop Packaging Dry Proof

Date: 2026-06-09
Branch/worktree: `codex/p0-desktop-packaging-dry` / `.worktrees/p0-desktop-packaging-dry`
Starting baseline: `codex/p0-remote-control-integration @ 55c4d99c20b563bf761de6c97453740543287a7d`

Coordinator note: the unified baseline later advanced to `cdd2272f` with roadmap-only competition evidence mapping. This branch did not rebase because it does not touch `docs/roadmap.md`.

## Result

- Windows Desktop dependency install passed from the app workspace lockfile.
- Windows Local Edge sidecar compiled and was copied to Tauri's external sidecar name.
- Tauri executable compile passed with `pnpm tauri build --no-bundle`.
- Local unsigned Windows NSIS bundle passed and produced `AgentHub_0.2.0_x64-setup.exe`.
- Portable dry package was created with `AgentHub.exe`, `agenthub-edge.exe`, and `README.txt`.
- SQLite app-data policy is gated by source inspection: packaged Local Edge uses `--store-backend sqlite --store-db <app-data>/agenthub-edge.sqlite`, and readiness does not expose direct CLI spawn inputs.
- Updater metadata was not produced by the unsigned local build: no `latest.json` or `.sig` appeared. The new dry gate records this as `not_produced_unsigned_build`; requiring updater metadata is a separate signing/release gate.
- macOS remains policy-only in this branch.

## Repeatable Gate

New local gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-dry.ps1 -RepoRoot . -SkipInstall -RunWindowsBundle
```

Use `-RequireUpdaterMetadata` only when a signing/release slice is expected to produce `latest.json` and `.sig`. Signing, notarization, stapling, GitHub Release upload, real TokenDanceID, and real CLI/model execution remain out of scope.

## Artifacts

Artifact root from the successful local run:

`D:\Code\TokenDance\AgentHub\.worktrees\p0-desktop-packaging-dry\.tmp\tauri-package-dry`

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `AgentHub_0.2.0_x64-setup.exe` | 12092559 | `057D377C49781D50A269D89FDA10C9B15AF3D45763F3F61931C696F9642AD1F0` |
| `AgentHub_0.2.0_x64-portable.zip` | 16110481 | `7D208AF30A4B7835B9B0AB761D74373B90C0AE67E5F27CCA0CE287694E5E1E00` |
| `agenthub-desktop.exe` | 18962432 | `DC66B8271338E0DE00AE41C33B42503D8920A6FB73D2746D5D5135611FC0A46E` |
| `agenthub-edge-windows-amd64.exe` | 25489920 | `A3BC290A363F29FCB750600839D4FA17689C047354C33C67980B71BE51B511E1` |
| `package-dry-report.json` | 1082 | `7D915629D882DB82EE87E779F337FAC46E821DAA7AF7FD655A6C81721E03E2BA` |

The generated `artifact-manifest.json` also records these hashes and sizes. All artifacts are under ignored output paths.

## Blockers And Boundaries

- Updater metadata is not proven locally without signing/release metadata output.
- macOS package proof is still policy-only.
- Bundle size/manual chunk warnings still appear during Desktop Vite builds and remain release debt.
- Tauri builds touched `app/desktop/src-tauri/Cargo.toml` and generated schema files through line-ending churn only; those changes were reverted because they are not necessary for this packaging proof.
