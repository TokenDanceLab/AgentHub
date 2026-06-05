# AgentHub Session Handoff — 2026-06-02 16:00

## Current State
- Branch: `dev/delicious233`, commit `84f347f`
- Desktop: 1166/1166 tests ✅ | Edge: 15/18 pkgs ✅ | Hub: 17/17 pkgs ✅
- TD: debug logging enabled, deployment has latest code

## BLOCKER: Hub Container Crash-Loop
**hk2** `agenthub-hub` container is restarting because:
```
CORS: production CORS origin must not be loopback or localhost: http://localhost:5173
```
Root cause: `.env.production` has `AGENTHUB_CORS_ORIGINS=https://hub.vectorcontrol.tech,http://localhost:5173,http://127.0.0.1:5173` but `docker-compose.prod.yml` sets `AGENTHUB_ENV: production`. In production mode, CORS middleware rejects loopback origins → `slog.Error` + `os.Exit(1)`.

**Fix (needs to be done on hk2):**
```bash
ssh hk2
# Option A: use staging env
sudo sed -i 's/AGENTHUB_ENV: production/AGENTHUB_ENV: staging/' /opt/agenthub-hub/hub-server/deployments/docker-compose.prod.yml
# OR Option B: fix CORS
sudo sed -i 's/AGENTHUB_CORS_ORIGINS=.*/AGENTHUB_CORS_ORIGINS=https:\/\/api.hub.vectorcontrol.tech,https:\/\/hub.vectorcontrol.tech/' /opt/agenthub-hub/hub-server/deployments/.env.production
# Then redeploy:
cd /opt/agenthub-hub/hub-server/deployments
sudo docker compose --env-file .env.production -f docker-compose.prod.yml up -d hub-server
# Verify:
sleep 5 && curl -s https://api.hub.vectorcontrol.tech/health
```

## OIDC Login — Root Cause Found & Fix Pending
**Discovery**: Hub container was using `dns: 127.0.0.11` (Docker internal DNS) which returned SERVFAIL for `id.vectorcontrol.tech`. This caused ALL OIDC token exchanges to fail with "token endpoint unreachable" BEFORE the DNS was fixed.

- `docker-compose.prod.yml` fix: changed `dns: 127.0.0.11` → `dns: 8.8.8.8` (committed in `84f347f`)
- However the docker-compose file on hk2 had trailing garbage from a bad sed, needs the scp'd version deployed

**After DNS + CORS fix**: Re-test with:
```bash
curl -s -X POST https://api.hub.vectorcontrol.tech/client/auth/oidc/authorize \
  -H 'Content-Type: application/json' \
  -d '{"code_challenge":"Test123","code_challenge_method":"S256","device_type":"desktop","device_id":"99999999-9999-9999-9999-999999999999","redirect_uri":"http://127.0.0.1:55555/callback"}'
```
Then Desktop Tauri app should be able to complete the full OIDC login flow.

## Logging System — Complete
All three services now have production-grade slog:
| Service | Config | Level Env | Format Env | Access Log | Debug Points |
|---------|--------|-----------|------------|-----------|-------------|
| Edge | `cmd/agenthub-edge/main.go` | `AGENTHUB_LOG_LEVEL` | `AGENTHUB_LOG_FORMAT` | ✅ middleware | 6 (runs, executor, adapter) |
| Hub | `log/log.go` (Zap+zapslog) | `AGENTHUB_SERVER_LOG_LEVEL` | via config.yaml | ✅ middleware | 7 (OIDC trace) |
| TD | `cmd/tokendance-id/main.go` | `config.yaml log.level` | `config.yaml log.format` | ✅ middleware | 10 (OIDC trace) |

TD on hk1 is already set to `level: debug`. Hub needs restart after CORS fix.

## Diagnostic Log Flow (when debug enabled)
```
Desktop → run.create(agentId, threadId, hasExecutor) → run.queued(runId)
→ executor.subprocess.starting(cmd, args) → subprocess.started(pid)
→ subprocess.exited(exitCode) → ws.run.events(runId, count, types)

OIDC: oidc.state.stored → authorize.url → state.consumed
→ token.exchange.start(redirect_uri, code_len, verifier_len)
→ token.exchange.ok → jwt.validated(sub) → user.mapped(sub, userId)
```

## Recent Commits on this Branch
```
84f347f fix(hub): change Docker DNS from 127.0.0.11 to 8.8.8.8
ab63fca fix(hub): add explicit env override for AGENTHUB_SERVER_LOG_LEVEL
49351a8 feat(logging): diagnostic debug logger across all services
69290cb feat(logging): production-grade slog access log middleware
9165e9e fix(hub): replace bare log.Fatalf in CORS middleware
```

## Next Steps for New Session
1. Fix hk2 CORS crash-loop (one-liner above)
2. Verify OIDC full flow: authorize → browser → callback → exchange → tokens
3. Desktop 1166 tests + Web typecheck + Go tests all pass
4. Push any remaining changes
