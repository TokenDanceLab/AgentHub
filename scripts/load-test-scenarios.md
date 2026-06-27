# Load Test Scope

最后更新：2026-06-27

This file is the active companion to `scripts/load-test.sh`. The old multi-scenario planning catalog is archived at [../docs/archive/performance/load-test-scenarios-full-2026-06-27.md](../docs/archive/performance/load-test-scenarios-full-2026-06-27.md).

## Current Scope

`scripts/load-test.sh` is a small Bash/curl health-endpoint stress tool:

```bash
./scripts/load-test.sh
./scripts/load-test.sh -n 5000 -c 100
./scripts/load-test.sh -url http://127.0.0.1:3210/v1/health
```

It proves basic reachability, latency percentiles, throughput, and non-2xx error rate for one HTTP endpoint. It does not prove OIDC login, WebSocket fanout, message ordering, agent dispatch concurrency, process leaks, database contention, or production capacity.

## Evidence Boundary

| Claim | Required evidence |
|---|---|
| Health endpoint regression | `scripts/load-test.sh` output with target URL, request count, concurrency, latency, and error rate |
| API or WS performance | Focused benchmark/load harness for that API/WS path |
| Goroutine/process leak | Go test/pprof/leak evidence on the touched path |
| Real production capacity | Approved-real run against an approved environment, with `real_tested=true` manifest |

Keep performance/load claims tied to the command that actually ran. Stub, fixture, dry, or readiness checks must not be described as real capacity proof.
