# AgentHub LLM Wiki

最后更新：2026-07-16

Karpathy-style **compiled knowledge layer** for AgentHub cleanup and day-to-day agent/human orientation.

This wiki is **not** product SSOT. It compresses, cross-links, and surfaces durable facts so agents can load less and act with fewer false starts.

## Purpose

- Give agents a small, stable map of AgentHub seams, hotspots, risks, and cleanup decisions.
- Keep product truth in authoritative sources; keep this tree as a compiled index + synthesis.
- Capture cleanup narrative that would otherwise live only in chat, analysis dumps, or stale workflow comments.
- Make drift visible (especially production LIVE vs CI “decommissioned” wording).

## Layers

| Layer | Role | Authority |
|---|---|---|
| **Sources (SSOT)** | Product rules, architecture, API contracts, governance | `AGENTS.md`, `docs/architecture.md`, `docs/architecture/*`, `api/`, `docs/governance/*`, `docs/progress/MASTER.md`, `docs/roadmap.md`, `docs/decisions.md` |
| **Ops SSOT (external)** | Live host role, deploy state, secrets, rollback evidence | TokenDance server workspace ops docs (pointer-only from this wiki) |
| **Wiki (compiled)** | Summaries, links, hotspots, risks, decisions for cleanup | `wiki/` (this tree) |
| **Raw analysis (ephemeral)** | Lane dumps, temporary investigation notes | `docs/analysis/` during active cleanup only; not long-term SSOT |

Read order for agents:

1. Product rules: `AGENTS.md`
2. Active cleanup progress: `docs/progress/MASTER.md` (if present)
3. Architecture / API as needed
4. This wiki for compressed orientation and cleanup-specific synthesis
5. Ops pointers only when touching production narrative — never copy secrets or private paths here

## Operations

### Ingest

Compile from sources; do not invent product policy here.

```text
source change
  -> decide if wiki page needs update
  -> edit page (frontmatter + body)
  -> update index.md one-liner if title/summary changed
  -> append log.md entry
```

Ingest sources (typical):

- Rules / workflow: `AGENTS.md`
- Architecture seams: `docs/architecture.md`, `docs/architecture/*`
- Contracts: `api/openapi.yaml`, `api/events.md`, `api/conventions.md`
- Risks / governance: `docs/governance/*`
- Decisions: `docs/decisions.md`
- Cleanup analysis: `docs/analysis/*` (filter noise; promote only durable claims)
- Live production role: external ops STATE (pointer only)

### Query

Prefer wiki for “where is X / what is the current narrative / what is hot?” then jump to SSOT for edit authority.

| Question type | Start here | Then open |
|---|---|---|
| Product rules / red lines | `AGENTS.md` | related owner docs |
| Module boundaries | `wiki` module pages | `docs/architecture/*` + code |
| API / events | `api/` | handlers/services |
| Production status | `ops-pointer` pages | external ops SSOT + `deployments/production/` shape |
| Cleanup priority | `hotspot` / `risk` / `decision` pages | `docs/progress/MASTER.md` |

### Lint

Lightweight manual lint before claiming wiki is current:

1. **SSOT non-overwrite** — wiki must not redefine rules that belong in `AGENTS.md` / `api/` / governance.
2. **No secrets / private paths** — no tokens, connection strings, real IPs, or absolute private server paths. Ops is pointer-only.
3. **Live production narrative** — production is **LIVE on hk3**. Any “runtime decommissioned” CI/docs wording is **drift**, not authority.
4. **Wiki-links resolve** — every `[[page-id]]` has a matching page or index entry.
5. **Frontmatter complete** — required fields per `SCHEMA.md`.
6. **Log append** — non-trivial edits get a `log.md` line the same day.
7. **Evidence labels** — do not promote fixture/stub/readiness-only claims into production-ready language.

## Non-goals

- Not a second `AGENTS.md`, architecture SSOT, or OpenAPI home.
- Not a dump of full source files, long audit PDFs, or chat transcripts.
- Not an ops runbook with host paths, secrets, or deploy credentials.
- Not a replacement for `docs/progress/MASTER.md` execution tracking.
- Not a place to declare real login / real model spend / packaged Desktop / production deploy without matching evidence gates.
- Not a rewrite plan for Hub/Edge; cleanup is incremental SSOT alignment and seam hardening.

## Bootstrap scope (cleanup-baseline)

Initial wiki focuses on AgentHub cleanup:

- Hub/Edge/shared workbench map
- Production LIVE (hk3) vs CI decommission drift
- Deploy image-name / template divergence hotspots
- Security/governance risk pointers
- Cleanup decisions that constrain P0/P1 work

See `index.md` for the page catalog and `log.md` for bootstrap history.
