# Wiki Log

Append-only. Newest entries at the top of each day section is optional; prefer chronological within a day.

Format:

```text
- YYYY-MM-DD — <verb> <id-or-file>: <one-line why>
```

---

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
