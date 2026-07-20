# Post-Polish Module Inventory (residual)

> last-updated: 2026-07-20  
> focus: residual hotspots after strangler peels + Visual QA polish

## S.U.P.E.R Snapshot (residual)

| Module | S | U | P | E | R | Band | Residual |
|---|---|---|---|---|---|---|---|
| Hub overall | 🟢 | 🟢 | 🟡 | 🟡 | 🟡 | B+ | agentteam 仍浓 |
| Edge handlers | 🟡 | 🟢 | 🟡 | 🟢 | 🟡 | B | handlers.go ~503 LOC（已从 ~2.3k 削薄） |
| Edge lifecycle | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | A- | process_executor.go ~77 LOC 壳 |
| Shared hubClient | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A | Desktop/Web thin re-export |
| Mobile hubClient | 🔴 | 🟡 | 🟡 | 🟡 | 🔴 | C | **~685 LOC**，仍持有兼容/fixture 形状 |
| Shared workbench | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A- | AgentHubWorkbench.tsx ~108 LOC |
| CI path-filter | 🟢 | — | 🟢 | 🟢 | 🟢 | A | unified `changes` |
| Backend perf gates | 🟢 | — | 🟢 | 🟢 | 🟢 | A | `verify-backend-perf-leak-gates.ps1` **ok** |
| Docs plan/* | 🟡 | — | 🟡 | 🟡 | 🟡 | C+ | historical cleanup-baseline 指针仍写 Phase 61/82 |

## LOC Residuals (prod only, 2026-07-20)

| LOC | Path | Note |
|---:|---|---|
| 685 | `app/mobile-rn/src/api/hubClient.ts` | 主前端残差；未 thin 到 shared |
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
| 三份完整 hubClient fork | Desktop/Web **thin**；Mobile **仍厚** |

## Test Giants (not product surface)

Largest files are mostly `*_test.go` / vitest (2.7k–3.2k lines). Cleanup optional for maintainability; not blocking product.

## Recommended Workstreams

1. **Mobile hubClient thin + RN-safe contract** (P0 engineering residual)  
2. **Docs authority hygiene** — archive or banner historical plan; fix MASTER/roadmap cross-links  
3. **Security residual inventory** — only in-repo actionable items; deploy-only explicitly deferred  
4. **API/OpenAPI hygiene** — optional P1 if route drift found  
5. **Visual residual** — Empty multi-state / Type CJK — only if interactive methodology adopted
