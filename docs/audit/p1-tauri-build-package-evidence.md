# P1 Tauri Build Package Evidence

Date: 2026-06-09
Worktree: `D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-build-package-evidence`
Branch: `codex/p1-tauri-build-package-evidence`
Base: `219cadb0d2a0cc5baeab729a5633686c59492d17`

## Scope

This pass records local Windows Desktop/Tauri package readiness evidence and macOS packaging/signing/notarization gaps. It does not publish release artifacts, create tags, upload updater metadata, add signing certificates, notarize, staple, or change Web/Hub/Edge business code.

## Local Toolchain

- `corepack pnpm --version`: `10.32.1`
- `go version`: `go version go1.26.3 windows/amd64`
- `rustc --version`: `rustc 1.95.0 (59807616e 2026-04-14)`
- `cargo --version`: `cargo 1.95.0 (f2d3ce0bd 2026-03-21)`
- PowerShell hosts: Windows PowerShell 5.1 and PowerShell 7.5.4 available.

## Readiness Gates

Passed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-tauri-installer-smoke.ps1 -RepoRoot . -StrictToolchain
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-tauri-package-dry.ps1 -RepoRoot . -ArtifactsRoot .tmp\tauri-package-dry-light -SkipInstall -SkipExecutableCompile
```

Key results:

- Desktop metadata is aligned at `0.3.0-rc.6` across `app/desktop/package.json`, `app/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.
- Tauri bundle is active and targets `nsis`, not broad `all`.
- Tauri sidecar basename is `binaries/agenthub-edge`; Windows target sidecar path is `app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe`.
- NSIS installer mode is `currentUser`.
- Updater plugin is active with a `latest.json` endpoint and public key.
- Release-readiness workflow keeps full Tauri build behind explicit `workflow_dispatch` input and does not create GitHub Releases.
- macOS unsigned dry policy is policy-only and records later approval gates for Apple signing, notarization, stapling, release upload, and production updater metadata.

## Windows Build Evidence

The full scripted bundle attempt:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-tauri-package-dry.ps1 -RepoRoot . -ArtifactsRoot .tmp\tauri-package-dry-windows-bundle -RunWindowsBundle
```

Result:

- Dependency install passed from `app/pnpm-lock.yaml`.
- Windows Local Edge sidecar build passed.
- Tauri `--no-bundle` executable compile passed and produced `agenthub-desktop.exe`.
- The subsequent scripted full NSIS package pass failed during the second `beforeBuildCommand` with:

```text
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
ELIFECYCLE Command failed with exit code 3221226505.
beforeBuildCommand `corepack pnpm build` failed with exit code -1073740791
```

Direct workflow-equivalent retry after the sidecar was prepared:

```powershell
cd app\desktop
corepack pnpm tauri build
```

Result: passed. Tauri compiled `agenthub-desktop.exe`, patched it for `nsis`, ran `makensis`, and produced:

```text
app\desktop\src-tauri\target\release\bundle\nsis\AgentHub_0.3.0-rc.6_x64-setup.exe
```

Warnings observed during successful builds:

- Vite circular/manual chunk warning: `vendor-react -> vendor-tanstack -> vendor-react`.
- Vite dynamic import/static import chunk warnings for `@tauri-apps/api` and `@tauri-apps/plugin-shell`.
- Rust warning: `function replace_workspace_roots_from_store is never used` in `src\commands.rs:126`.

These warnings did not block the direct NSIS package build.

## Local Evidence Artifacts

Artifacts are local ignored outputs only and are not committed.

Evidence root:

```text
D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-build-package-evidence\.tmp\tauri-package-direct-windows
```

Files:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `AgentHub_0.3.0-rc.6_x64-setup.exe` | 12130056 | `ADD3F19C2FEE82722BAB8D350C5B781EBD2DCBA4F21B0513DB28E37DFF5AA19E` |
| `AgentHub_0.3.0-rc.6_x64-portable.zip` | 16667381 | `06CD9FBD208CC701A8131D420E4571AF373D75DA08F47A77C16C4DE6089A1F1D` |
| `agenthub-desktop.exe` | 19184640 | `74E414B0DD8F094733A81A707575CDCC5ECB963BAE5EFB2D7193A76E18B1315F` |
| `agenthub-edge-windows-amd64.exe` | 25499136 | `986DEB22C4A2BD9A16FD2481748DCBA2BEA39A521B42AD065E74A114C7958377` |
| `package-direct-report.json` | 1020 | `8D5ED6F3D4FF1AD39A13EA4615EDD7F1D324537AE7C1DBD5A12C835AC67B28E9` |

Portable zip contents:

```text
AgentHub.exe        19184640
agenthub-edge.exe   25499136
README.txt          121
```

Manifest:

```text
D:\Code\TokenDance\AgentHub\.worktrees\p1-tauri-build-package-evidence\.tmp\tauri-package-direct-windows\artifact-manifest.json
```

## Updater Metadata Gap

The successful unsigned Windows NSIS build produced the setup executable only. No `latest.json` or `.sig` was present under `app/desktop/src-tauri/target/release/bundle`.

Current config has the updater plugin enabled, endpoint configured, and public key configured, but does not set `bundle.createUpdaterArtifacts`. Official Tauri updater docs say update signatures cannot be disabled, `TAURI_SIGNING_PRIVATE_KEY` must be present while building update artifacts, and `bundle.createUpdaterArtifacts` controls generation of updater bundles/signatures.

Implication:

- Windows installer readiness without secrets is evidenced by the direct NSIS build.
- Release/updater readiness is not complete until a later approved slice sets the updater artifact policy and supplies the updater signing private key in CI or another secret store.
- The current `windows-package-dry` workflow collection expects `latest.json` and `.sig`; based on this local build, that opt-in job would fail at artifact collection unless updater artifact generation/signing is enabled or the dry job policy is changed.

I did not change `tauri.conf.json` because enabling updater artifact creation without a signing private key would introduce a new build requirement that this no-secret local pass cannot satisfy.

## macOS Repo-Level Compatibility

Repo/config observations:

- `app/desktop/src-tauri/tauri.conf.json` is not Windows-only except for the selected `nsis` bundle target and Windows NSIS settings. It has no macOS `dmg` customization block yet.
- `.github/workflows/release.yml` already has a macOS desktop job on `macos-latest`, prepares the future arm64 sidecar as `app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin`, runs `pnpm tauri build`, and expects `dist/AgentHub_${ver}_aarch64.dmg`.
- Tauri CLI help confirms `--target aarch64-apple-darwin` / `universal-apple-darwin` are supported targets and `--skip-stapling` is available for notarization/stapling workflow control.

Remaining macOS work:

- Add/verify a macOS bundle target or build command that explicitly requests DMG, for example `pnpm tauri build --bundles dmg`, on a macOS runner.
- Build and stage the arm64 Local Edge sidecar at `app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin`.
- Decide whether to add a `bundle.macOS.dmg` block for DMG background/window/icon positioning. The current repo can attempt a default DMG, but no product-specific DMG layout is configured.
- Configure Apple Developer signing for outside-App-Store distribution: Developer ID Application certificate, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and CI keychain handling.
- Configure notarization credentials through either App Store Connect API (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or Apple ID credentials (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- Decide stapling policy. Tauri supports `--skip-stapling` for the initial notarization pass, but production distribution should staple once notarization succeeds.
- Review entitlements if new macOS capabilities are introduced. No custom entitlement change was made in this pass.
- If updater artifacts are required for macOS, enable `bundle.createUpdaterArtifacts`, provide `TAURI_SIGNING_PRIVATE_KEY`, and collect the app tarball/signature artifacts expected by Tauri updater v2.

Official references used:

- Tauri updater docs: https://v2.tauri.app/plugin/updater/
- Tauri macOS code signing docs: https://v2.tauri.app/distribute/sign/macos/
- Tauri DMG docs: https://v2.tauri.app/distribute/dmg/

## Non-Goals Preserved

- No signing certificate or updater signing private key was added.
- No notarization or stapling was run.
- No updater metadata was published.
- No GitHub Release, tag, upload, merge, push, or deployment was performed.
- No Web/Hub/Edge business code or mobile code was changed.
