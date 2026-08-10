# Post-Polish Risk Assessment

> pending external archive — see docs/history.md
> last-updated: 2026-07-21
> security SSOT remains `docs/governance/security-risk-register.md`
> residual program Phases 79–80: **closed** (#1340–#1342)

## 1. Executive Judgment

1. **Visual/product chrome is Ship-ready (gate 89).** Further glass/CSS polish is diminishing returns.
2. **Architecture peels already landed** (handlers/lifecycle/workbench/hubClient Desktop+Web+**Mobile**).
3. **In-repo residual program (docs + mobile hubClient) delivered.**
4. **Highest product risk overall**: security items needing **deploy/client** evidence (OIDC, Desktop login, adapter logs) — not pure PR work.
5. **Backend perf gate script is green** — do not re-litigate as missing infrastructure.

## 2. Security Residual (actionability split)

### Code / fixture in-repo (possible)

| ID | Status | In-repo lever |
|---|---|---|
| AH-SR-050 | Open foundation | Keep TerminalPort allowlist rules; no free-form shell |
| AH-SR-043 residual | Mitigated web | Optional Desktop demo seed de-default |
| AH-SR-044 residual | Mitigated | Optional settings copy cleanup |
| AH-SR-045 optional | Mitigated | capability model expansion (large; separate SPEC) |

### Deploy / client only (defer)

| ID | Needs |
|---|---|
| AH-SR-028 | Secret rotation on all deploy instances |
| AH-SR-035 / 036 | Live OIDC browser + Desktop login evidence |
| AH-SR-001–005, 020, 029, 032, 042 | Live topology / remote Edge / Mobile device proof |
| AH-SR-048 | Real adapter smoke log review |

## 3. Testing / Performance Residual

| Item | State | Next |
|---|---|---|
| `verify-backend-perf-leak-gates.ps1` | **PASS** | Keep in CI narrative / optional workflow_dispatch job |
| `backend-performance-gates.md` | Exists (dated 2026-06-27) | Touch only if matrix paths change |
| Chat flow Playwright | Roadmap P0 | Maintain; no rewrite |
| Packaged Desktop boundary | Roadmap P1 | Clarify `real_tested=false` vs gate |
| TODO/FIXME in service/lifecycle | **0** hits | Clean |

## 4. Docs / Governance Residual

| Risk | Impact | Status |
|---|---|---|
| `docs/plan/*` live Phase 61/82 pointers | Agents resume wrong backlog | **Fixed** #1340 HISTORICAL banners |
| Multiple residual analysis files pre-polish | Noise | Keep post-polish trio as closed-program analysis |
| Visual rescores archived | OK | scorecard + rescore-17-final active |

## 5. Top 5 In-Repo SDD Tasks — disposition

| # | Task | Disposition |
|---|---|---|
| T1 | Mobile hubClient thin re-export | **Done** #1341 |
| T2 | RN Hub-only boundary note | **Done** #1341 (AGENTS + mobile README) |
| T3 | Docs hygiene plan/* + MASTER | **Done** #1340 / #1342 |
| T4 | Optional: Desktop demo seed fail-closed | **Open optional** (AH-SR-043 residual) |
| T5 | Optional: perf-gate workflow_dispatch | **Done** — `backend-perf-leak-gates` job in checks.yml (dispatch-only) |

## 6. Explicit Out of Scope

- Live Hub OIDC / Desktop packaged signing evidence
- Production secret rotation
- Full Mobile UI redesign
- Static Visual QA gate chase past 89 without interactive methodology
- Edge handlers further split unless a concrete API change needs it
