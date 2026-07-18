# Wiki Log

Append-only. Newest entries at the top of each day section is optional; prefer chronological within a day.

Format:

```text
- YYYY-MM-DD — <verb> <id-or-file>: <one-line why>
```

---

## 2026-07-18

- 2026-07-18 — Phase 64 open-set hygiene: MASTER/roadmap/wiki → Phase 64 / ms 85; residual band payloadRequests/transport/codex/mcp tools; P63 closed (#1093–#1100).

- 2026-07-18 — Phase 63 open-set hygiene: MASTER/roadmap/wiki live pointers → Phase 63 / ms 84; residual band store query / payload utils / orchestrator_failure; ms 83 closed.

- 2026-07-18 — MASTER tip/PR-list align to HEAD `a26a2828` (#1077): open peels #1067–#1069 only; hygiene/design-token closed via #1072–#1076.
- 2026-07-18 — progress baseline hygiene: tip `96588ea1` after #1070/#1073; open peels #1067–#1069 only; finished worktrees pruned (keep super-governance-baseline); MASTER/entry/wiki live pointers Phase 61 / ms 82.
- 2026-07-18 — sync live pointers to Phase 61 / milestone 82 after MASTER self-heal (tip `7ef83beb`; open #1067–#1071; #1070 → PR #1073): `wiki/pages/overview.md`, entry docs, residual LOC band process_executor 1126 · agent_dispatch 786 · sqlite_store 709 · hubClient 526 · delivery_outbox 469.

## 2026-07-16

- 2026-07-16 — rename wiki risk slugs to avoid secret-guard API-key false positives (#453): `risk-evid-grade-confusion`, `risk-session-secret-boundary` (break ri+sk-hyphen token shape).
- 2026-07-16 — create `flow-control-event`: compiled wiki page covering all four core data flows (control, event, evidence, sync) with protocol boundaries, event families, cross-flow constraints, and links to SSOT. Compiled from `docs/architecture.md`, `docs/architecture/01-06`, `docs/decisions.md`, `api/events.md`, `docs/governance/security-risk-register.md`, `AGENTS.md`.
- 2026-07-16 — bootstrap wiki root: create `README.md` defining purpose, SSOT vs compiled layers, ingest/query/lint ops, and non-goals for AgentHub cleanup.
- 2026-07-16 — bootstrap schema: create `SCHEMA.md` with page types (`overview|module|flow|hotspot|risk|decision|ops-pointer`), frontmatter, `[[wiki-links]]` rules, and update triggers.
- 2026-07-16 — bootstrap catalog: create `index.md` with initial cleanup page catalog and one-line summaries (bodies may still be draft backlog).
- 2026-07-16 — narrative lock: record production **LIVE on hk3** as authoritative cleanup fact; mark CI/docs “decommissioned” wording as **DRIFT** (`[[ci-decommission-drift]]`, `[[production-live-hk3]]`, `[[decision-production-live-narrative]]`).
- 2026-07-16 — boundary lock: wiki is compiled knowledge only; product SSOT remains `AGENTS.md`, `docs/architecture.md`, `api/`, `docs/governance/*` (`[[decision-wiki-is-compiled]]`, `[[ssot-map]]`).
- 2026-07-16 — privacy lock: ops pages are pointer-only; do not copy secrets or absolute private server paths into wiki (`[[ops-evidence-boundary]]`).
- 2026-07-16 — create [[architecture-seams]]: compile six non-negotiable boundaries, five-layer seams, platform contract, auth boundary stitches, and evidence gates from `docs/architecture.md`, `AGENTS.md`, `docs/decisions.md`, and `docs/governance/security-risk-register.md`.
- 2026-07-16 — seed complete `wiki/pages/`: all 10 page bodies compiled (overview, architecture-seams, cleanup-playbook, module-hub, module-edge, module-frontend, flow-control-event, hotspots, risks-open, ops-hk3). Refresh `wiki/index.md` to list actual pages with one-line summaries from body frontmatter; bootstrap draft entries mapped to covering pages.

## [2026-07-16] lint | index realign + partial risk labels
- Rebuilt wiki/index.md to match seeded page basenames.
- Aligned AH-SR-046/049 labels with risk register Partial mitigated.

## [2026-07-16] lint | risk label partial for 046/049
- risks-open headings aligned with security-risk-register Partial mitigated.
## 2026-07-19

- Phase 64 closed (ms 85; PRs #1106–#1110): payloadRequests/transport/codex/mcp peels + hygiene.
- Phase 65 open (ms 86; #1111–#1115): orchestrator / surfacing / parser_ndjson / httpserver + MASTER hygiene.
## 2026-07-19 (P66)

- Phase 65 closed (ms 86; PRs #1116–#1120): orchestrator/surfacing/parser_ndjson/httpserver peels + hygiene.
- Phase 66 open (ms 87; #1121–#1125): process_executor_pure / sdk_fixture_mapper / cache client / edgeEventMappers + MASTER hygiene.
## 2026-07-19 (P67)

- Phase 66 closed (ms 87; PRs #1126–#1130).
- Phase 67 open (ms 88; #1131–#1135): workbenchDemo / chatviewFixtures / model_catalog / hub config + MASTER hygiene.

