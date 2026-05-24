# AgentHub Security Risk Register

Last reviewed: 2026-05-25

This register tracks security, privacy, reliability, network, disk, and logic risks for AgentHub. It is a living queue for audit loops; update status and evidence when a finding is fixed or intentionally accepted.

## Scope

- Hub Server: `hub-server/`
- Edge Server: `edge-server/`
- Desktop/Web clients: `app/desktop/`, `app/web/`, `app/shared/`
- API and deployment docs: `api/`, `docs/`, `hub-server/deployments/`

## Findings

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-001 | High | Open | Hub REST auth accepts TokenDance ID RS256 bearer tokens, but the parser comment and current claim struct show issuer/expiry coverage while audience validation is not visibly enforced in the same path. A valid token for another relying party could be accepted if downstream user mapping does not constrain audience. | `hub-server/internal/jwtutil/tokendance.go:16`, `hub-server/internal/jwtutil/tokendance.go:132`, `hub-server/internal/middleware/auth.go:29` | Add explicit `aud` policy for Hub Server, tests for wrong audience, and document the accepted audience in `../docs/identity-auth.md`. |
| AH-SR-002 | High | Open | Hub WebSocket authentication still validates only Hub-local HS256 tokens, while REST supports TokenDance ID tokens. This creates an auth split-brain where a browser login path can succeed for REST but fail or force token fallback for live WS. | `hub-server/internal/handler/ws.go:93`, `hub-server/internal/handler/ws.go:101`, `hub-server/internal/middleware/auth.go:15` | Decide whether WS must accept Hub session tokens only or also TokenDance ID tokens. If Hub-only, ensure login callback always exchanges TokenDance ID into Hub access/refresh before opening WS. |
| AH-SR-003 | Medium | Open | Desktop stores Hub access and refresh tokens in browser `localStorage`. In a Tauri desktop shell this is lower exposure than a public browser app, but any renderer XSS or compromised plugin path can read long-lived refresh credentials. | `app/desktop/src/api/hubAuth.ts:11`, `app/desktop/src/api/hubAuth.ts:130`, `app/desktop/src/api/hubAuth.ts:156` | Move refresh tokens to Tauri secure storage or OS keychain before treating desktop login as production-grade. Keep access token in memory where practical. |
| AH-SR-004 | Medium | Verify | Edge Server is intended to be loopback-only and origin-gated, but it allows requests with no `Origin`. This is useful for non-browser clients, but it means local malware or another local process can call the Edge API if it can reach the bound port. | `edge-server/internal/httpserver/server.go:35`, `edge-server/internal/httpserver/server.go:164`, `edge-server/internal/httpserver/server.go:166` | Add a local bearer/session token or signed desktop handshake for state-changing Edge endpoints before enabling any non-local bind or sensitive workspace operations. |
| AH-SR-005 | Medium | Open | Edge HTTP server leaves `WriteTimeout` at zero for long-lived WebSocket support. This is intentional for WS, but it also applies to short REST responses on the same server unless route-level deadlines cover them. | `edge-server/internal/httpserver/server.go:50`, `edge-server/internal/httpserver/server.go:52` | Split WS and REST timeout handling or add per-handler response deadlines for REST endpoints. |
| AH-SR-006 | Low | Verify | Production env example includes localhost origins for CORS. The compose default is stricter, but copying `.env.production.example` as-is could leave local dev origins allowed in production. | `hub-server/deployments/.env.production.example:37`, `hub-server/deployments/docker-compose.prod.yml:116` | Keep production `.env` generated from a deployment-specific allowlist and add a preflight check that rejects `localhost` in production CORS. |
| AH-SR-007 | Low | Verify | Admin pprof/metrics is protected by Basic Auth and loopback publishing in compose, but the runtime still depends on correct bind/publish behavior. This should stay in the recurring runtime checklist. | `hub-server/internal/app/app.go:471`, `hub-server/internal/app/app.go:477`, `hub-server/deployments/docker-compose.prod.yml:119` | Verify externally that `/debug/pprof/` and `/metrics` are unreachable except through the intended local/admin path. |

## Verification Queue

Run these from `D:\Code\TokenDance\AgentHub`:

```powershell
go test ./hub-server/internal/jwtutil ./hub-server/internal/middleware ./hub-server/internal/handler
go test ./edge-server/internal/httpserver
rg -n "AGENTHUB_CORS_ORIGINS=.*localhost|0\.0\.0\.0:6060|debug/pprof" hub-server deployments docs
rg -n "localStorage\.setItem\(.*token|localStorage\.setItem\(.*refresh" app
```

## Loop Notes

- Keep this file focused on active risks and verification decisions.
- When a finding becomes a design decision, link the ADR or architecture section and mark it `Accepted`.
- When a code fix lands, include the test command and commit/PR in the status note.
