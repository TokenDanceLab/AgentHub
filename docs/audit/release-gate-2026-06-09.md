# AgentHub Release Gate Evidence - 2026-06-09

Scope: `origin/dev/delicious233` to `master` preflight and the next AgentHub RC release. This is a release gate record only; it does not push `master`, create tags, sign binaries, notarize macOS artifacts, publish updater metadata, or upload a GitHub Release.

## Current gate decision

Status: blocked for public release, ready for Windows unsigned dry evidence.

Ready:

- `dev/delicious233` carries desktop metadata version `0.3.0-rc.7`; the matching RC tag convention is `v0.3.0-rc.7`.
- The Windows unsigned dry path builds the Local Edge Windows sidecar, places the Tauri sidecar at `app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe`, builds the unsigned NSIS installer, creates a portable zip, and writes `artifact-manifest.json` with SHA-256 hashes.
- The release-readiness workflow exposes manual dry inputs for Windows packaging and macOS future policy. It uploads dry evidence only as workflow artifacts and does not sign, notarize, staple, tag, or upload a GitHub Release.
- The release workflow remains tag-triggered on `v*`; hyphenated semver tags such as `v0.3.0-rc.7` become GitHub prereleases through `contains(github.ref_name, '-')`.

Blockers before public release:

- Open Critical/High security risks in `docs/governance/security-risk-register.md` block release by policy, including AH-SR-035, AH-SR-036, AH-SR-037, AH-SR-042, AH-SR-045, AH-SR-046, AH-SR-047, and AH-SR-049.
- Windows artifacts are intentionally unsigned. Production updater metadata is not approved until signed `latest.json` and installer signatures are produced under an explicit signing slice.
- macOS packaging is policy-only in release-readiness. Developer ID signing, notarization, stapling, and real macOS artifact publication require a later approval slice.
- GitHub Release upload is present only in the real tag workflow. Do not run it until the release blockers above are closed or explicitly accepted by the release owner.

## Commands

Refresh refs and inspect dev to master:

```powershell
git fetch origin master dev/delicious233
git rev-list --count origin/master..origin/dev/delicious233
git rev-list --count origin/dev/delicious233..origin/master
```

Static release and packaging gates:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release-gate.ps1 -RepoRoot . -BaseRef origin/master -DevRef origin/dev/delicious233
```

Windows unsigned installer and portable dry artifacts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-dry.ps1 -RepoRoot . -ArtifactsRoot .tmp\tauri-package-release-20260609 -RunWindowsBundle -StrictToolchain
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-sidecar-runtime-evidence.ps1 -RepoRoot . -BuiltArtifactsRoot .tmp\tauri-package-release-20260609 -RequireBuiltArtifacts
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release-gate.ps1 -RepoRoot . -BaseRef origin/master -DevRef origin/dev/delicious233 -ArtifactsRoot .tmp\tauri-package-release-20260609
```

GitHub Actions dry evidence, without creating a release:

```powershell
gh workflow run "Release Readiness" --ref dev/delicious233 -f run_windows_package_dry=true -f run_macos_unsigned_dry_policy=true
gh run list --workflow "Release Readiness" --branch dev/delicious233 --limit 5
```

RC tag and release commands are intentionally deferred until the blockers are closed. The expected command shape after approval is:

```powershell
git checkout master
git merge --ff-only origin/dev/delicious233
git tag -a v0.3.0-rc.7 -m "AgentHub v0.3.0-rc.7"
git push origin master v0.3.0-rc.7
```

Do not run those commands from this gate pass.
