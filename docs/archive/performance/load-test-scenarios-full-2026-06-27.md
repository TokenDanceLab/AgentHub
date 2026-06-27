# AgentHub Load Test Scenarios

> Companion to `scripts/load-test.sh`. Documents key scenarios for future
> load testing beyond the basic `/health` baseline. Each scenario describes
> the target endpoint(s), expected concurrency model, success criteria, and
> what to watch for under load.

---

## Scenario 1: Auth Flow (OIDC Login + Token Refresh)

**Endpoint(s):**

| Step | Method | Path | Notes |
|------|--------|------|-------|
| Initiate login | GET | `/api/auth/login` | Redirect to TokenDance ID |
| Code exchange | POST | `/api/auth/callback` | Hub exchanges code for ID token |
| Token refresh | POST | `/api/auth/refresh` | Refresh Hub-local session |
| Session validate | GET | `/api/auth/session` | Validate current session |

**Concurrency model:**
- Simulate N users logging in simultaneously (100–500 concurrent).
- Each virtual user completes the full flow: initiate → callback → session → refresh.

**Success criteria:**
- P95 code-exchange latency < 1s.
- Token refresh must not fail under sustained load.
- No leaked sessions or cross-user session contamination.

**What to watch for:**
- TokenDance ID upstream latency dominates code-exchange time.
- Hub-local token signing (JWT) CPU usage under burst.
- Refresh storm: many clients with short-lived tokens refreshing at once.

**Dependencies:**
- TokenDance ID must be running (real or mock).
- Hub Server with valid OIDC client registration.

---

## Scenario 2: WebSocket Connect + Sustained Connection

**Endpoint(s):**

| Step | Method | Path | Notes |
|------|--------|------|-------|
| Upgrade | GET | `/v1/events` | WebSocket upgrade with auth |
| Heartbeat | WS frame | `ping` | Client/server keepalive |
| Subscribe | WS message | `{"type":"subscribe","topics":[...]}` | Topic subscription |

**Concurrency model:**
- Open N persistent WebSocket connections (500–2000).
- Hold connections for duration of test (30s–5min).
- Measure connection establishment latency and reconnection success.

**Success criteria:**
- P95 connection establishment < 500ms.
- Zero dropped connections under steady load (no server-side close without client intent).
- Heartbeat round-trip < 100ms.

**What to watch for:**
- File descriptor exhaustion on the server.
- Goroutine leak — connection count should return to zero after test.
- Memory per connection (buffer sizes, read/write goroutines).
- TLS handshake overhead when using wss://.

**Dependencies:**
- A WebSocket-capable load generator (e.g., `websocat` for smoke, or a custom Go/Node script for real load).
- Edge Server or Hub Server with WebSocket endpoint enabled.

---

## Scenario 3: Message Send Throughput

**Endpoint(s):**

| Step | Method | Path | Notes |
|------|--------|------|-------|
| Send message | POST | `/v1/threads/{id}/messages` | REST message send |
| Receive via WS | WS frame | Event `thread.message.created` | Real-time delivery |
| List messages | GET | `/v1/threads/{id}/messages` | Paginated history |

**Concurrency model:**
- N concurrent users each sending M messages into the same or different threads.
- Vary message size: tiny (10B), typical (1KB), large (100KB).
- Measure end-to-end latency: REST POST → WebSocket event receipt.

**Success criteria:**
- P95 send-to-receive latency < 500ms for typical messages.
- Message ordering preserved within each thread.
- No duplicate deliveries.
- Paginated list returns consistent view after send burst.

**What to watch for:**
- Database write contention on the messages table.
- WebSocket fan-out: many subscribers to the same thread.
- Large message payload impact on serialization/deserialization.
- Backpressure: if WS client is slow, does the server buffer or drop?

**Dependencies:**
- Hub Server + Edge Server running.
- At least one thread created for message routing.
- WS client subscribed to the target thread.

---

## Scenario 4: Agent Dispatch (Profile → Run → Poll)

**Endpoint(s):**

| Step | Method | Path | Notes |
|------|--------|------|-------|
| List profiles | GET | `/v1/profiles` | Available agent profiles |
| Start run | POST | `/v1/runs` | Dispatch agent with prompt |
| Run status | GET | `/v1/runs/{id}` | Poll for completion |
| Run events | WS | Event `run.status.changed` | Real-time progress |
| Cancel run | POST | `/v1/runs/{id}/cancel` | Abort running agent |

**Concurrency model:**
- N users each dispatching an agent run (10–100 concurrent runs).
- Each run may take 5–30 seconds (mock adapter or lightweight real task).
- Polling: each client polls status every 500ms until completion.

**Success criteria:**
- P95 run-start latency (POST → first status change event) < 2s.
- Status polling does not degrade under concurrent runs.
- Cancel reliably stops the agent within 5s.
- No orphaned agent processes after test completes.

**What to watch for:**
- Agent process (subprocess) management under concurrency — process leak.
- Edge Server memory and CPU per active run.
- Database row contention on run status updates.
- Polling storm: many clients polling many runs creates quadratic load.
- Queue depth: if runs queue up, latency grows linearly.

**Dependencies:**
- Edge Server with at least one mock/real Agent Runtime adapter registered.
- Hub Server routing runs to the correct Edge.
- Sufficient filesystem space for agent workspace isolation.

---

## Scenario 5: Combined Workload (Realistic Traffic Mix)

**Description:**
A mixed workload simulating real user behavior: some users logging in, some
connecting WebSockets, some sending messages, some dispatching agents, and a
baseline of health checks (simulated monitoring).

**Mix ratios (suggested):**
| Traffic type | % of total |
|-------------|-----------|
| Health check | 30% |
| Message send | 30% |
| Agent dispatch | 15% |
| WebSocket connect | 15% |
| Auth flow | 10% |

**Concurrency:** 200–500 concurrent virtual users.

**Success criteria:**
- Overall error rate < 1%.
- No scenario's P95 latency more than 2x its isolated baseline.
- No service restart or crash during 5-minute sustained run.

---

## General Load Test Notes

### Tools
- **Baseline** (`load-test.sh`): Pure bash + curl, zero external deps. Good for quick health checks and CI.
- **Medium scale**: `hey` (Go), `wrk`/`wrk2` (C), or `oha` (Rust) for REST endpoints. Good for 10k–1M requests.
- **WebSocket scale**: Custom Go (`gorilla/websocket`) or Node.js (`ws`) script. No single CLI tool covers all WS scenarios well.
- **Full simulation**: `k6` (Grafana) for scripted multi-step user journeys with metrics.

### Metrics to Always Collect
- **Latency**: p50, p90, p95, p99, max.
- **Error rate**: % of non-2xx responses, connection timeouts, TLS failures.
- **Throughput**: requests per second sustained.
- **Server metrics**: CPU, memory, goroutine count (Go), file descriptors.
- **Database metrics**: connection pool utilization, query latency, lock waits.

### Baseline Values (for regression detection)
Record these after the first clean load test run on a known-good build:
- P50 health check latency
- P99 health check latency
- Error rate at 1000 req / 50 concurrent
- Max concurrent connections before degradation

### CI Integration
The `load-test.sh` script exits non-zero when error rate > 0%, making it suitable
for CI gating. For CI, consider using the mock server targets to avoid depending
on real TokenDance ID:

```bash
# In CI workflow
./scripts/load-test.sh -n 500 -c 25 -url http://127.0.0.1:8080/health
```
