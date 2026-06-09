# Web Deploy OIDC Readiness Audit

Date: 2026-06-09
Branch/worktree: `codex/p0-web-deploy-oidc-readiness` / `.worktrees/p0-web-deploy-oidc-readiness`
Base HEAD: `5690baaf` / `origin/codex/p1-critical-evidence-integration`

This report records the secret-free Web deploy/OIDC configuration readiness pass before public deploy approval. It does not perform a public deploy, upload artifacts, run live TokenDance ID login, or read real client secrets.

## Result

- Root `docker-compose.yml` no longer registers Desktop port `5173` as a Web browser callback.
- Development Web callbacks are explicitly `http://localhost:5174/auth/tokendance/callback` and `http://127.0.0.1:5174/auth/tokendance/callback`.
- Desktop/native callback policy remains the no-port `http://127.0.0.1/callback` loopback registration, which allows dynamic callback ports for Desktop/Tauri.
- Production OAuth redirect defaults now use the public Web browser callback: `https://hub.vectorcontrol.tech/auth/tokendance/callback`.
- Hub code exchange remains a backend API boundary: `POST /client/auth/oidc/callback`.
- The Web deploy readiness gate now checks root compose, production deploy examples, and stale `5173` Web callback regressions.
- A tests wrapper was added for the Web deploy readiness gate.

## Commands Run

Install app workspace dependencies:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p0-web-deploy-oidc-readiness\app
corepack.cmd pnpm install --frozen-lockfile
```

Build local Web artifact with non-secret production endpoint configuration:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p0-web-deploy-oidc-readiness\app\web
$env:VITE_HUB_URL='https://api.hub.vectorcontrol.tech'
$env:VITE_HUB_WS_URL='wss://api.hub.vectorcontrol.tech/client/ws'
corepack.cmd pnpm build
```

Deploy readiness gates:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p0-web-deploy-oidc-readiness
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-web-deploy-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-web-deploy-readiness.ps1 -RepoRoot .
```

OIDC readiness gates:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p0-web-deploy-oidc-readiness
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-oidc-readiness.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-oidc-readiness.ps1
```

## Evidence Boundary

- `app/web/dist` is a local ignored artifact generated only to let the readiness verifier inspect the build output.
- No public deploy, artifact upload, live TokenDance ID login, real OAuth client secret, browser session, or production admin operation was used.
- The readiness checks are static/configuration gates plus local build artifact inspection.
- Existing `tests\scripts\verify-oidc-readiness.ps1 -RepoRoot .` mis-detects workspace docs because that wrapper does not normalize non-empty relative `RepoRoot`; the default invocation above passes and was used for this audit.

## Residual Warning

The Web production build exits 0, but Vite still reports the main bundle chunk is larger than 500 kB after minification. This remains deploy-readiness debt, not a blocker for this configuration readiness slice.
