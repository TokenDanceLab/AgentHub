# Backend Performance And Leak Gate Scope

最后更新：2026-06-27

This file is the active owner for Hub/Edge backend performance and leak gate classification. The old multi-scenario planning catalog is indexed in [../history.md](../history.md).

## Evidence Classes

| Class | Proves | Does not prove |
|---|---|---|
| Behavior gate | Concurrency, cancellation, TTL, retry, backpressure behavior | Latency baseline, capacity, goroutine/process leak |
| Microbenchmark | Local CPU/alloc regression signal | Production capacity, long-running stability |
| Load smoke | One endpoint reachability, latency, error rate | WS fanout, Agent dispatch, DB contention, leaks |
| Pprof/leak evidence | Path-specific goroutine/heap/process change under stress | Functional correctness without matching behavior tests |

## Current Scope

`scripts/smoke/load-test.sh` is a small Bash/curl health-endpoint stress tool:

```bash
./scripts/smoke/load-test.sh
./scripts/smoke/load-test.sh -n 5000 -c 100
./scripts/smoke/load-test.sh -url http://127.0.0.1:3210/v1/health
```

It proves basic reachability, latency percentiles, throughput, and non-2xx error rate for one HTTP endpoint. It does not prove OIDC login, WebSocket fanout, message ordering, agent dispatch concurrency, process leaks, database contention, or production capacity.

`scripts/verify/verify-backend-perf-leak-gates.ps1` runs the current focused behavior gates and short microbenchmarks:

```powershell
pwsh ./scripts/verify/verify-backend-perf-leak-gates.ps1 -Benchtime 100ms
```

## Evidence Boundary

| Claim | Required evidence |
|---|---|
| Health endpoint regression | `scripts/smoke/load-test.sh` output with target URL, request count, concurrency, latency, and error rate |
| API or WS performance | Focused benchmark/load harness for that API/WS path |
| Goroutine/process leak | Go test/pprof/leak evidence on the touched path |
| Real production capacity | Approved-real run against an approved environment, with `real_tested=true` manifest |

Keep performance/load claims tied to the command that actually ran. Stub, fixture, dry, or readiness checks must not be described as real capacity proof.

## Gate Matrix

| Path | Default behavior gate | Benchmark/load gate | Boundary |
|---|---|---|---|
| Hub EventBus | `cd hub-server; go test ./internal/service -run "TestBus" -short -count=1` | `BenchmarkEventBus` | fanout behavior + microbenchmark, not leak proof |
| Hub delivery outbox | `cd hub-server; go test ./internal/service -run "TestOutbox" -short -count=1` | Blocked until DB/Redis load or pprof run exists | retry/backoff/cleanup behavior only |
| Hub scheduler timeout | `cd hub-server; go test ./internal/app -run TestPublishExpiredTaskTimeout -short -count=1` | Blocked until scheduler lifecycle or pprof gate exists | stale timeout behavior only |
| Hub Redis TTL/rate limit | `cd hub-server; go test ./internal/service ./internal/middleware -run "TestGenerateAuthorizationURL|TestHandleCallback_(StateExpired|RejectsStaleStateEntryBeforeTokenExchange)|Test(GlobalRateLimit|RateLimit|WSIPRateLimit|WSUserConnLimiter)" -short -count=1` | Blocked until Redis load/latency gate exists | TTL/fail-open/fail-closed behavior only |
| Hub WS frame/manager | `cd hub-server; go test ./internal/ws -run "Test(Manager|Frame)" -short -count=1` | `BenchmarkFrame` | frame microbenchmark, not WS fanout capacity |
| Edge EventBus | `cd edge-server; go test ./internal/events -run TestBus -short -count=1` | `BenchmarkBus` | event bus behavior + microbenchmark, not leak proof |
| Edge lifecycle | `cd edge-server; go test ./internal/lifecycle -run "TestProcessExecutor(StartCancelRace|TooManyConcurrentRuns|ContextCancellationMidRun|StartWithRunTimeoutCancelsSlowRun)|TestResultAggregator" -short -count=1` | `BenchmarkSanitizeSubAgentResult` | cancellation/concurrency behavior; pprof needed for child-process leaks |
| Edge store | `cd edge-server; go test ./internal/store -run "Test(SQLite|Store)" -short -count=1` | Blocked until store benchmark or persistence stress exists | store behavior only |
| Edge adapters | `cd edge-server; go test ./internal/adapters -run TestSDKAdapterLatencyBaseline -short -count=1` | `Benchmark(SDKAdapterLatency|ClassifyComplexity)` | adapter microbenchmark, not real CLI/model/API |

## Do Not Claim

- Functional Go tests alone are not leak proof.
- A `100ms` benchmark is a regression smoke, not production capacity evidence.
- `scripts/smoke/load-test.sh` against `/health` does not prove WS, Agent dispatch, DB contention, or process lifecycle behavior.
- Stubbed, fixture, readiness-only, or local microbenchmark evidence must not be described as approved-real, production, or real model/API execution.
