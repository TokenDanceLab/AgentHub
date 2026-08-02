# Wiki Schema

最后更新：2026-07-16

Schema for the AgentHub lightweight LLM wiki. Keep pages short, link-heavy, and compiled from SSOT.

## Page types

| Type | Purpose | Typical content |
|---|---|---|
| `overview` | System map or cleanup orientation | Product shape, layers, where authority lives |
| `module` | One durable code/product module | Responsibility, boundaries, key paths, SSOT links |
| `flow` | End-to-end data/control path | Step sequence, who owns each hop, failure modes |
| `hotspot` | Cleanup concentration / footgun | Why it matters, evidence pointers, preferred fix direction |
| `risk` | Security, privacy, or release risk | Severity, status, owner SSOT, do-not-claim rules |
| `decision` | Binding cleanup/product decision | Context, decision, consequences, non-goals |
| `ops-pointer` | Production/ops fact pointer | Host role summary only; **no secrets / private absolute paths** |

Allowed values for frontmatter `type` are exactly the set above.

## Frontmatter

Every content page under `wiki/pages/` uses YAML frontmatter:

```yaml
---
id: production-live-hk3
title: Production is LIVE on hk3
type: ops-pointer
status: active
updated: 2026-07-16
sources:
  - deployments/production/docker-compose.yml
  - docs/architecture/05-deployment.md
  - external:server-ops-agenthub-state
tags:
  - production
  - drift
  - cleanup
related:
  - ci-decommission-drift
  - deploy-image-name-divergence
summary: >
  Production Hub is LIVE on hk3. CI/docs “decommissioned” wording is drift.
---
```

### Required fields

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable kebab-case slug; equals filename without `.md` |
| `title` | string | Human title; one line |
| `type` | enum | One of the page types above |
| `status` | enum | `active` \| `draft` \| `stale` \| `archived` |
| `updated` | date | `YYYY-MM-DD` |
| `sources` | string[] | Repo-relative paths and/or `external:<pointer-id>` |
| `summary` | string | One or two sentences; also mirrored in `index.md` |

### Optional fields

| Field | Type | Rules |
|---|---|---|
| `tags` | string[] | Lowercase kebab tokens |
| `related` | string[] | Other page `id`s (no `[[ ]]` here) |
| `owners` | string[] | Module or role labels, not personal private paths |
| `severity` | string | For `risk` / `hotspot`: `p0` \| `p1` \| `p2` |
| `claims` | string[] | Explicit claim labels, e.g. `live-production`, `fixture-only` |

### Root control files

These files have **no** page frontmatter (or only a short header):

- `wiki/README.md` — purpose and operations
- `wiki/SCHEMA.md` — this schema
- `wiki/index.md` — catalog
- `wiki/log.md` — append-only changelog

## Linking rules (`[[wiki-links]]`)

Use double-bracket links for in-wiki navigation:

```md
See [[hub-edge-overview]] and [[production-live-hk3]].
```

Rules:

1. Link target is the page `id` (filename stem), not the title.
2. Prefer `[[id]]`. Optional display form: `[[id|display text]]`.
3. Do **not** use wiki-links for product SSOT files. Use normal markdown links to repo paths:
   - `[AGENTS.md](../AGENTS.md)`
   - `[architecture.md](../docs/architecture.md)`
4. External ops: use pointer ids in prose (`external:server-ops-agenthub-state`) or an `ops-pointer` page. Never paste absolute private server paths or secrets.
5. Broken links are lint failures. Add the page (even as `status: draft`) or remove the link.
6. Bidirectional expectation: if A strongly depends on B, B should list A in `related` or body links when practical.

## Page body conventions

- Lead with the `summary` idea in the first paragraph.
- Prefer tables and short bullet lists over essays.
- Every factual product claim should point at a `sources` entry.
- Distinguish evidence grades: fixture / readiness-only / observed / approved-real / production.
- Mark known drift explicitly with **DRIFT** when sources disagree.
- Keep pages roughly under ~150 lines. Split rather than grow a monolith.

## Directory layout

```text
wiki/
  README.md
  SCHEMA.md
  index.md
  log.md
  pages/
    <id>.md
```

Optional future groupings (only if catalog grows large):

```text
wiki/pages/overview/
wiki/pages/modules/
wiki/pages/flows/
wiki/pages/hotspots/
wiki/pages/risks/
wiki/pages/decisions/
wiki/pages/ops/
```

If grouped later, `id` remains global and unique; `index.md` remains the single catalog.

## When to update

| Event | Wiki action |
|---|---|
| Product rule / red-line change | Update SSOT first (`AGENTS.md` etc.); then adjust affected wiki pages + log |
| Architecture seam change | Update `docs/architecture*`; refresh module/flow pages |
| API contract change | Update `api/*`; refresh only wiki pages that summarize the contract |
| Production role / deploy shape change | Update external ops SSOT + in-repo deploy templates; refresh `ops-pointer` / deploy hotspots |
| CI narrative change | If CI still says decommissioned while prod is LIVE, keep/refresh drift hotspot until fixed |
| Security finding open/close | Update `docs/governance/security-risk-register.md`; mirror summary on risk pages |
| Cleanup decision accepted | Add/update `decision` page; link from index; log entry |
| Analysis-only transient note | Do **not** create a wiki page unless the claim is durable and multi-session useful |
| Page becomes wrong | Set `status: stale` or fix immediately; never leave silent false authority |

### Update checklist

1. Edit page body + frontmatter `updated`.
2. Sync `index.md` one-line summary if changed.
3. Append `log.md`.
4. Run mental lint from `README.md` (SSOT, secrets, LIVE narrative, links).

## Authority conflict rule

If wiki and SSOT disagree:

1. **SSOT wins** for product rules, API, architecture, governance.
2. For live production role, **external ops SSOT + current deploy evidence win**.
3. Wiki must be corrected or marked `stale`.
4. Special case: `.github/workflows/checks.yml` “decommissioned” comments do **not** override LIVE production on hk3 — treat as **DRIFT**.
