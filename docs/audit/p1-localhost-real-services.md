# P1 Localhost Real Services Smoke Gate

This slice keeps the existing localhost product-loop fixture as fixture evidence and adds a separate opt-in real-services readiness verifier. No real TokenDanceID login, live Hub registration/dispatch observation, CLI/model adapter run, public deploy, signing, or release upload is performed by this gate.

## Scope

- Existing fixture harness: `scripts/verify-localhost-product-loop.ps1`.
- New opt-in verifier: `scripts/verify-localhost-real-services.ps1`.
- Script tests: `tests/scripts/verify-localhost-product-loop.ps1` and `tests/scripts/verify-localhost-real-services.ps1`.

## Evidence Boundary

| Check | Evidence | Status |
|---|---|---|
| Fixture loop preserved | `verify-localhost-product-loop.ps1` still writes `mode=LocalhostFixture` and `real_tested=false`. | Fixture-only |
| Real-service opt-in | `verify-localhost-real-services.ps1` exits with `BLOCKED_OPT_IN_REQUIRED` and writes `real_tested=false` unless `-RealServices` is provided. | Enforced |
| Missing service output | The real-services verifier records each missing localhost health endpoint and keeps `real_tested=false`. | Enforced |
| Identity markers | Web, Hub, Desktop bridge, and Local Edge probes require caller-supplied explicit marker regexes; broad defaults are not used. | Readiness-only |
| Registered target route hints | Caller-supplied route hints are checked for internal consistency only. They cannot prove live Hub dispatch and cannot set `real_tested=true`. | Readiness-only |
| RealTested boundary | The verifier always writes `mode=ReadinessOnly` and `real_tested=false` in `-RealServices` mode. | Enforced |
| No spend/login/deploy | The verifier records no TokenDanceID login and no public deploy/signing/release upload. If `-StartServices` runs operator commands, CLI/model spend is operator-attested rather than asserted by the verifier. | Enforced |

## Real-Service Probe Contract

The real-services gate can probe already-running localhost services:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-real-services.ps1 `
  -RepoRoot . `
  -RealServices `
  -WebUrl http://127.0.0.1:5174 `
  -HubUrl http://127.0.0.1:8080 `
  -DesktopBridgeUrl http://127.0.0.1:5173 `
  -LocalEdgeUrl http://127.0.0.1:3210 `
  -ExpectedWebMarker "agenthub-web-real-service-marker" `
  -ExpectedHubMarker "agenthub-hub-real-service-marker" `
  -ExpectedDesktopMarker "agenthub-desktop-bridge-real-service-marker" `
  -ExpectedEdgeMarker "agenthub-local-edge-real-service-marker" `
  -RegisteredTargetUrl http://127.0.0.1:5173 `
  -HubDispatchTargetUrl http://127.0.0.1:5173
```

Passing this command means `READINESS_ONLY_PASSED`, not `RealTested`. The `RegisteredTargetUrl` and `HubDispatchTargetUrl` parameters are topology hints supplied by the caller; they are useful for catching a direct Web-to-Edge or Hub-to-Edge configuration mistake, but they are not observed Hub dispatch evidence.

If an operator wants the verifier to start services, `-StartServices` requires an explicit JSON start plan through `-StartServicePlanPath`. The script does not implicitly run `scripts/dev-start.ps1` or any long-lived development command. Because a start plan can run arbitrary operator-supplied commands, the verifier does not assert `no_real_cli_or_model_spend=true` when `-StartServices` is used; that claim remains operator-attested.

## Future Real Evidence

Observed dispatch proof is now handled by `scripts/verify-observed-localhost-dispatch.ps1`. That verifier requires a no-secret Hub/Desktop evidence manifest or loopback evidence endpoint with target registration, Hub dispatch, Desktop bridge accept, Edge run id, and Hub replay refs. Caller-supplied URL parameters remain insufficient for real dispatch proof.

A future `RealTested=true` promotion still requires explicit operator approval and an approval-gated observed manifest. Without that gate, observed-dispatch reports keep `real_tested=false`.

## Non-Goals

- Real TokenDanceID browser login.
- Real Codex, Claude Code, OpenCode, SDK, model, or API-budget execution.
- Certifying live Hub registration/dispatch from caller-supplied URL parameters.
- Public deploy, signing, release upload, installer build, or package publication.
- Web, Desktop UI, Edge adapter implementation, or roadmap edits.
