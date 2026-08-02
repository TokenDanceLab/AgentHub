# Post-Polish Module Inventory (residual)

> last-updated: 2026-07-21
> focus: residual hotspots after strangler peels + Visual QA polish
> status: Phase 79–80 **delivered** — table reflects post-#1341 state

## S.U.P.E.R Snapshot (post residual)

| Module | S | U | P | E | R | Band | Residual |
|---|---|---|---|---|---|---|---|
| Hub overall | 🟢 | 🟢 | 🟡 | 🟡 | 🟡 | B+ | agentteam 仍浓 |
| Edge handlers | 🟡 | 🟢 | 🟡 | 🟢 | 🟡 | B | handlers.go ~503 LOC（已从 ~2.3k 削薄） |
| Edge lifecycle | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | A- | process_executor.go ~77 LOC 壳 |
| Shared hubClient | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A | Desktop/Web/Mobile thin over SSOT |
| Mobile hubClient | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A- | **~342 LOC** Proxy + SecureStore/fixture/WS glue (#1341) |
| Shared workbench | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A- | AgentHubWorkbench.tsx ~108 LOC |
| CI path-filter | 🟢 | — | 🟢 | 🟢 | 🟢 | A | unified `changes` |
| Backend perf gates | 🟢 | — | 🟢 | 🟢 | 🟢 | A | `verify-backend-perf-leak-gates.ps1` **ok** |
| Docs plan/* | 🟢 | — | 🟢 | 🟢 | 🟢 | A | HISTORICAL banners; MASTER sole index (#1340) |

## LOC Residuals (prod only, 2026-07-21)

| LOC | Path | Note |
|---:|---|---|
| 342 | `app/mobile-rn/src/api/hubClient.ts` | thin shell; REST via shared Proxy |
| 542 | `hub-server/.../agentteam/agent_team_approval.go` | 业务浓，非 god-file 紧急 |
| 536 | `agent_team_run.go` | 同上 |
| 503 | `edge-server/internal/api/handlers.go` | 已可接受；继续拆分收益递减 |
| 307 | `app/shared/src/hubClient.ts` | SSOT 聚合壳，OK |

### Historical vs now (important)

| Historical hotspot (cleanup analysis) | Now |
|---|---|
| handlers.go ~2375 | ~503 |
| process_executor.go ~2280 | ~77 |
| AgentHubWorkbench ~1768 | ~108 |
| 三份完整 hubClient fork | Desktop/Web/**Mobile** **thin** over shared |

## Test Giants (not product surface)

Largest files are mostly `*_test.go` / vitest (2.7k–3.2k lines). Cleanup optional for maintainability; not blocking product.

## Recommended Workstreams (next — not residual program)

1. ~~Mobile hubClient thin + RN-safe contract~~ **done #1341**
2. ~~Docs authority hygiene~~ **done #1340**
3. **Security residual inventory** — only in-repo actionable items; deploy-only explicitly deferred
4. **API/OpenAPI hygiene** — optional P1 if route drift found
5. **Visual residual** — Empty multi-state / Type CJK — only if interactive methodology adopted
6. Roadmap P0: real E2E contract · chat flow Playwright reliability
