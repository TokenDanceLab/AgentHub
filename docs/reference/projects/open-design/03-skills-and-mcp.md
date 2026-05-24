# Open Design Skill System & MCP Server -- Comprehensive Analysis

> Report date: 2026-05-24
> Source codebase: `D:\Code\AgentHub\reference\open-design\`
> Comparison target: `D:\Code\AgentHub\`

---

## 1. Skill System: Architecture Deep Dive

### 1.1 Frontmatter Format

Open Design (OD) adopts the Claude Code `SKILL.md` convention as its base format, then layers
OD-specific extensions under the `od:` key. Every skill lives in a folder containing a `SKILL.md`
manifest plus optional `assets/`, `references/`, `examples/`, and `tests/` directories.

**Base fields** (unchanged from Claude Code):

```yaml
---
name: deck-swiss-international       # canonical skill id
zh_name: "瑞士国际主义 Deck"          # localized picker title
en_name: "Swiss International Deck"
description: "16-column grid, one saturated accent..."  # agent reads this to match briefs
zh_description: "16 列网格 + 单一饱和 accent..."
triggers:                             # natural-language trigger phrases (unused in daemon)
  - "swiss deck"
---
```

Reference: `skills/deck-swiss-international/SKILL.md:1-20`

**OD extensions** (`od:` block) -- all fields optional, graceful defaults:

| Field | Type | Purpose | Source |
|-------|------|---------|--------|
| `od.mode` | enum | Routes skill into correct picker tab: `prototype`, `deck`, `template`, `design-system`, `image`, `video`, `audio` | `skills-protocol.md:65` |
| `od.surface` | enum | Output surface: `web`, `image`, `video`, `audio` | `skills.ts:30` |
| `od.platform` | enum | Target device: `desktop`, `mobile`, null | `skills.ts:31` |
| `od.scenario` | string | Free-form grouping tag (marketing, engineering, finance...) | `skills.ts:635-685` |
| `od.category` | string | UI filter pill slug (image-generation, design-systems, slides...) | `skills.ts:660-666` |
| `od.upstream` | string | URL to upstream GitHub repo (for curated stubs) | `skills.ts:199-200` |
| `od.featured` | number | Priority in Showcase gallery (lower = higher) | `skills.ts:569-577` |
| `od.fidelity` | enum | Prototype fidelity hint: `wireframe` or `high-fidelity` | `skills.ts:506-508` |
| `od.example_prompt` | string | Copy-pastable starter prompt for the "Use this" CTA | `skills.ts:583-592` |
| `od.example_prompt_i18n` | map | Localized example prompts (e.g. `zh-CN`) | `skills.ts:212` |
| `od.preview.type` | enum | Iframe renderer: `html`, `jsx`, `pptx`, `markdown` | `skills.ts:201-204` |
| `od.preview.entry` | string | Which file the iframe loads | protocol `2.1` |
| `od.preview.reload` | string | Refresh strategy: `debounce-100` | protocol `2.1` |
| `od.design_system.requires` | boolean | Whether active DESIGN.md is injected into prompt | `skills.ts:195-198` |
| `od.design_system.sections` | array | Which DESIGN.md sections to inject (token savings) | protocol `2.1` |
| `od.craft.requires` | array | Brand-agnostic craft refs: `[typography, color, anti-ai-slop]` | `skills.ts:482-495` |
| `od.critique.policy` | enum | Critique theater gate: `required`, `opt-in`, `opt-out` | `skills.ts:558-563` |
| `od.speaker_notes` | boolean | Whether deck generates speaker notes | `skills.ts:514-521` |
| `od.animations` | boolean | Whether output includes animations | `skills.ts:514-521` |
| `od.default_for` | array | This skill is the default for these modes | `skills.ts:497-501` |

**Mode normalization** (`skills.ts:606-612`): When a skill omits `od.mode`, the daemon infers it
from the description and body via keyword matching:
- Matches `image|poster|illustration` -> `image`
- Matches `video|motion|animation` -> `video`
- Matches `audio|music|tts` -> `audio`
- Matches `ppt|deck|slide|presentation` -> `deck`
- Matches `design-system|design.md|design tokens` -> `design-system`
- Matches `template` -> `template`
- Fallback -> `prototype`

This means a plain Claude Code skill with no `od:` block at all will still work in OD.

### 1.2 Prompt Composition Pipeline

The daemon composes the system prompt for each agent invocation through a layered pipeline
(`apps/daemon/src/prompts/system.ts`, referenced in `skills.ts:256`):

```
[DESIGN.md sections] → [Craft references] → [Skill body with root preamble] → [User brief]
```

**Skill root preamble** (`skills.ts:400-453`): When a skill ships side files (assets, references),
the daemon prepends a header advertising two paths the agent can use:
1. **CWD-relative alias**: `.od-skills/<folder>/` -- the primary path, always inside the agent's
   working directory, never blocked by directory-access policies (issue #430).
2. **Absolute repo path** -- fallback for non-project contexts.

The daemon also lists all known side files (e.g., `assets/template.html`, `references/checklist.md`)
so the agent knows what exists without probing.

**Craft references** (`skills.ts:482-495`, protocol `5.5`): Universal brand-agnostic design rules
(e.g., "ALL CAPS always needs >=0.06em letter-spacing", "#6366f1 is the AI-default tell")
shipped as `<projectRoot>/craft/<slug>.md`. Skills opt in with `od.craft.requires: [typography, color, anti-ai-slop]`.
Injected between DESIGN.md and skill body -- brand tokens win on conflict.

**CWD staging** (`skills.ts:406-408`): Before spawning the agent, the chat handler copies the
active skill's entire directory tree into `<cwd>/.od-skills/<folder>/` so all paths are
project-relative and work under every agent's directory-access policy.

### 1.3 Tool Registration

Skills do not register tools directly. Instead, the daemon dispatches generation tasks to the
active agent (Claude Code, Codex, Cursor, etc.) via a spawn layer:

1. User picks a skill in the web UI and types a prompt.
2. Daemon composes the system prompt (DESIGN.md + craft refs + skill body + user prompt).
3. Daemon spawns the agent with that system prompt and a project-scoped CWD.
4. Agent runs the skill's workflow (read files, write HTML, etc.).
5. Daemon streams tool calls as UI events; preview iframe refreshes on file changes.

Skills can declare `od.capabilities_required` (e.g., `surgical_edit`, `file_write`) to gate
features like comment mode when the active agent lacks the required capability.

### 1.4 User Skill Import/Edit/Delete

The daemon supports user-owned skills via `POST /api/skills/import` and `PUT /api/skills/:id`
(`skills.ts:787-925`). Key behaviors:

- User skills live under `<runtimeData>/user-skills/<slug>/SKILL.md`.
- User skills **shadow** built-in skills of the same `name` -- the first root wins on id collision
  (`skills.ts:150-179`).
- Editing a built-in skill creates a "shadow" copy under user-skills. On first shadow creation,
  all side files (assets/, references/, scripts/, examples/) are cloned from the built-in source
  so downstream resolvers keep finding the bundled tree (`skills.ts:900-925`).
- Slug is derived from `name` via alphanumeric+dash sanitization (`skills.ts:718-727`).
- YAML names are always quoted to prevent coercion (`skills.ts:746` -- PR #955).

---

## 2. How 132 Skills Are Organized by Mode

The `skills/` directory contains 132 skill folders (verified via `Get-ChildItem` count).
Each mode dictates what artifact the skill produces and how it renders in the preview pane.

### 2.1 Mode Taxonomy

| Mode | Count (approx) | Artifact | Preview | Example |
|------|---------------|----------|---------|---------|
| `prototype` | ~40 | Single-screen interactive HTML/JSX | iframe (html/jsx) | `saas-landing`, `dashboard`, `faq-page` |
| `deck` | ~12 | Multi-slide HTML presentation with keyboard nav | iframe (html) | `deck-swiss-international`, `deck-guizang-editorial` |
| `image` | ~35 | PNG/PDF poster, illustration, or visual art | image | `canvas-design`, `fal-generate`, `profile-avatar-*` |
| `video` | ~10 | Short-form video reel, animation | video | `8-bit-orbit-video-template`, `fal-kling-o3` |
| `audio` | ~3 | Jingle, TTS, music | audio player | `ai-music-album` |
| `design-system` | ~20 | DESIGN.md document | markdown | `design-md`, `brand-guidelines`, `figma-*` |
| `template` | ~12 | Populated copy of a pre-built template | html | `digits-fintech-swiss-template`, `after-hours-editorial-template` |

### 2.2 Dual-Nature Skills: Full vs. Catalog Stub

OD ships two kinds of skill entries:

**Full skills** (fully bundled): Include `SKILL.md` + `assets/` + `references/` + `example.html`.
The agent has everything it needs to produce an artifact. Examples: `deck-swiss-international`
(5+ files including `example.html`, `example.md`), `digits-fintech-swiss-template` (with
`assets/template.html`, `references/checklist.md`).

**Catalog stubs** (discovery-only): Only a `SKILL.md` with `od.upstream` pointing to the real repo.
These populate the Settings -> Skills picker so the agent discovers them during planning, but
the actual workflow assets are not vendored. Examples: `canvas-design` (`skills/canvas-design/SKILL.md:11`),
`ui-ux-pro-max` (`skills/ui-ux-pro-max/SKILL.md:6-7`). The stub body explicitly says
"install the upstream bundle into your active agent's skills directory" and provides the
`git clone` command.

This split keeps the OD repo lean while surfacing a rich catalogue. A seed script
(`scripts/seed-curated-design-skills.ts`) is idempotent -- re-running only creates folders
that don't exist, so hand-edited stubs are never overwritten (`skills/AGENTS.md:47-50`).

### 2.3 Category System

Stubs carry `od.category` tags that power the filter pills in Settings -> Skills. The canonical
categories from the curated catalogue (`skills/AGENTS.md:42-46`):

- `image-generation` -- `canvas-design`, `fal-generate`, `fal-realtime`
- `video-generation` -- `fal-kling-o3`, `fal-lip-sync`
- `audio-music` -- `ai-music-album`
- `slides` -- `deck-guizang-editorial`, `deck-swiss-international`
- `documents` -- `doc`, `docx`
- `design-systems` -- `design-md`, `brand-guidelines`, `ui-ux-pro-max`
- `figma` -- `figma-code-connect-components`, `figma-use`
- `animation-motion` -- `flutter-animating-apps`
- `3d-shaders` -- `fal-3d`
- `diagrams` -- `d3-visualization`
- `creative-direction` -- `creative-director`, `design-brief`
- `marketing-creative` -- `ad-creative`, `copywriting`
- `screenshots` -- `agent-browser`
- `web-artifacts` -- `artifacts-builder`

### 2.4 Derived Examples (Gallery Cards)

A skill can ship multiple hand-crafted examples under `examples/*.html`. The daemon surfaces
each as its own gallery card with a synthetic id `<parent>:<child>` (`skills.ts:267-305`).
For example, a `live-artifact` skill might ship `examples/dashboard.html`, `examples/landing.html`,
`examples/checkout.html` -- each showing a different use of the same skill template.

Derived cards inherit the parent's mode, platform, scenario, design_system config, critique
policy, and SKILL.md body. They deliberately do NOT inherit `featured` so they never crowd
the magazine row (`skills.ts:288`).

### 2.5 Prompt Templates (Separate System)

Prompt templates are distinct from skills. Stored under `prompt-templates/{image,video}/*.json`,
each is a reusable prompt with title, summary, category, tags, model hint, aspect ratio,
and full prompt text with Mustache-style `{argument}` placeholders (`prompt-templates.ts:17-30`).

Example: `prompt-templates/image/3d-stone-staircase-evolution-infographic.json` -- a 40+ line
JSON with detailed layout specs, CSS-level positioning, and 25 numbered visual elements.
These are discovered by the daemon via `listPromptTemplates()` (`prompt-templates.ts:36-71`)
and surfaced in the prompt gallery alongside skills.

The two systems complement each other: skills are workflows (how to produce), templates are
starting prompts (what to ask for).

---

## 3. MCP Server: Tool Exposure & Connection Model

### 3.1 Architecture

The `od mcp` command launches a **stdio MCP server** (`apps/daemon/src/mcp.ts`) that proxies
tool calls to the running daemon's HTTP API. The server itself is stateless and filesystem-free --
every tool resolves to a `fetch()` against `OD_DAEMON_URL`.

```
Coding agent (Claude Code / Cursor / Zed)
        |  stdio (MCP protocol)
        v
   od mcp server (mcp.ts)
        |  HTTP fetch()
        v
   OD daemon (Express on localhost:7456)
        |  filesystem
        v
   Project directories (.od/projects/<id>/)
```

### 3.2 Tools Exposed

All 10 tools defined at `mcp.ts:85-312`:

| Tool | Type | Description |
|------|------|-------------|
| `list_projects` | Read | List every OD project on this daemon |
| `get_active_context` | Read | Returns the project+file the user has open in OD right now (~5 min TTL) |
| `get_project` | Read | Single project metadata: name, active skill, entryFile, kind, timestamps |
| `get_artifact` | Read | **Preferred over get_file.** Entry file + all referenced siblings (BFS depth 3). Modes: `auto` (default), `all`, `shallow` |
| `get_file` | Read | Read one project file with offset/limit paging. `[od:file-window]` marker for large files |
| `search_files` | Read | Case-insensitive literal-substring search across project files |
| `list_files` | Read | File metadata: name, path, mime, kind, size, mtime. `since=<unix-ms>` for change polling |
| `create_artifact` | Write | Create an artifact entry file (rejects existing targets, can accept ArtifactManifest) |
| `write_file` | Write | Write/overwrite any project file (no manifest needed -- for iteration) |
| `delete_file` | Write | Delete one project file (nested paths supported) |
| `delete_project` | Write | Irreversible -- requires explicit project + `confirm:true` |

**Design decisions** (`mcp.ts:75-79`):
- Project arg is optional on most tools; defaults to the active context (~5 min TTL).
  This enables "just pull what I'm looking at" workflows without the agent asking "which project?"
- The active-context fallback is intentionally **disabled** for `delete_project` -- it requires
  explicit project arg + `confirm:true` (`mcp.ts:626-651`).
- Catalog tools (list skills, list design systems) are intentionally NOT exposed as MCP tools.
  Skills are recipes OD itself uses to generate; an external coding agent consuming OD's output
  can't run them (`mcp.ts:305-311`).

### 3.3 MCP Resources

OD exposes reference material as MCP resources (not tools), so agents pay zero tool-description
tokens unless they actually read a resource:

- `od://focus/active` -- the active project/file context as JSON
- `od://skills/<id>/SKILL.md` -- full skill body (one per registered skill)
- `od://design-systems/<id>/DESIGN.md` -- brand spec (palette, typography, voice)

These are populated at `ListResourcesRequestSchema` handler time by fetching `/api/skills` and
`/api/design-systems` from the daemon (`mcp.ts:383-413`).

### 3.4 Active Context System

The daemon tracks which project+file the user has open in the OD web UI. This "active context"
expires ~5 minutes after the last user interaction (`mcp.ts:94-98`). When an MCP tool is called
without a project argument, `resolveProjectArg()` (`mcp.ts:736-755`) fetches `/api/active`:

- If active context exists: returns that project id + stamps `usedActiveContext` on the response.
- If expired or null: returns a clear error telling the agent to ask the user to interact with OD.

This eliminates the "which project?" back-and-forth for the common case.

### 3.5 External MCP Server Configuration (OD as MCP Client)

OD also acts as an MCP **client** to external servers. Configuration stored at
`<dataDir>/mcp-config.json` (`mcp-config.ts:100-103`), modeled after Claude Code's `.mcp.json`.

**Built-in template catalogue** (`mcp-config.ts:494-1170`): 30 predefined MCP server templates
grouped by category:

| Category | Servers |
|----------|---------|
| `image-generation` | Higgsfield OpenClaw, Pollinations, Allyson, AWS Bedrock, Prompt-to-Asset, Nano Banana, Seedream, fal.ai |
| `image-editing` | Imagician, ImageSorcery, Photopea, Topaz Labs, Transloadit |
| `web-capture` | Screenshot Website Fast, ScreenshotOne, Pagecast |
| `design-systems` | Figma Context, Design Token Bridge, Design System Extractor, figma-use, Aesthetics Wiki |
| `ui-components` | 21st.dev Magic, shadcn/ui, FlyonUI |
| `data-viz` | AntV Chart, Mermaid diagrams, MCP Dashboards, Excalidraw Architect |
| `publishing` | EdgeOne Pages, PageDrop, PDFSpark, OGForge, QRMint, Slideshot, Deckrun |
| `utilities` | Filesystem, GitHub, Fetch, A11y |

Each template includes: transport (stdio/sse/http), command/args/URL, env fields with secret
markers, auth mode (none/oauth), example prompt, and homepage URL.

**OAuth flow** (`mcp-routes.ts:115-243`): For HTTP/SSE servers with `authMode: oauth`, the daemon
runs a server-side OAuth PKCE flow. Tokens are stored in `<dataDir>/mcp-tokens.json` and injected
as `Authorization: Bearer <token>` into the `.mcp.json` written at spawn time. This eliminates
the per-spawn `mcp-remote` dance.

**Multi-agent spawning** (`mcp-config.ts:287-486`):
- `buildClaudeMcpJson()` -- generates `.mcp.json` for Claude Code
- `buildOpenCodeMcpConfigContent()` -- generates `OPENCODE_CONFIG_CONTENT` env var for OpenCode
- `buildAcpMcpServers()` -- generates ACP format for Hermes/Kimi agents

All three merge daemon-issued OAuth tokens into server headers, with user-supplied headers
always winning on conflict (`mergeAuthHeader()` at `mcp-config.ts:348-369`).

---

## 4. Comparison: Open Design vs. AgentHub Skill Systems

### 4.1 Structural Comparison

| Dimension | Open Design | AgentHub |
|-----------|-------------|----------|
| **Skill count** | 132 (full + stubs) | 5 |
| **Skill directory** | `skills/` (repo root) | `.agents/skills/` |
| **Manifest format** | `SKILL.md` with YAML frontmatter | `SKILL.md` with YAML frontmatter |
| **Agent instructions** | `skills/AGENTS.md` | `AGENTS.md` (section 2: 三人分工) |
| **Discovery** | Daemon auto-scans; no rebuild needed | Manual; `AGENTS.md` enumerates whitelist |
| **Mode/category** | 7 modes, 14+ categories | None (all are development workflow skills) |
| **Prompt composition** | Multi-layer (DESIGN.md -> craft -> skill -> brief) | Direct (AGENTS.md -> skill body) |
| **User editing** | Full CRUD via API + UI panel | Direct file editing |
| **Shadow/custom** | User skills shadow built-ins | N/A |
| **Derived examples** | `examples/*.html` auto-surfaced as gallery cards | None |
| **Prompt templates** | `prompt-templates/{image,video}/*.json` (50+ templates) | None |
| **Testing** | `tests/*.prompt` + `*.expected.manifest.json` | None |
| **MCP integration** | Full stdio MCP server (10 tools + resources) | None |

### 4.2 Skill Purpose Comparison

**Open Design skills** are **artifact recipes** -- each produces one kind of design output
(deck, prototype, image, video, DESIGN.md). They are user-facing, surfaced in a web UI picker,
and consumed by end users who want to generate designs.

**AgentHub skills** are **development workflow engines** -- each governs how agents collaborate
on code. They are developer-facing, triggered by the dev team during implementation:
- `dev-loop` -- autonomous development engine with model allocation, parallel subagents,
  cross-review, and document sync (`AGENTS.md:87-88`)
- `test-coverage` -- test coverage enforcement
- `pre-push` -- pre-push validation checklist
- `integration-test` -- integration test patterns
- `env-sandbox` -- subprocess environment isolation (`env-sandbox/SKILL.md:1-4`)
- `adapter-dev` -- adapter development guidelines

### 4.3 Frontmatter Comparison

**Open Design** (rich, design-specific):
```yaml
name: deck-swiss-international
zh_name: "..."
description: "..."
triggers: [...]
od:
  mode: deck
  surface: web
  scenario: marketing
  featured: 0.001
  preview: { type: html, entry: index.html }
  design_system: { requires: false }
  example_prompt: "..."
  example_prompt_i18n: { zh-CN: "..." }
  upstream: "https://..."
```

**AgentHub** (minimal, workflow-specific):
```yaml
name: dev-loop
description: "自主开发推进引擎..."
---
```

AgentHub skills: (`dev-loop/SKILL.md:1-4`, `env-sandbox/SKILL.md:1-4`)
- Only `name` and `description` in frontmatter
- No `triggers`, no `od:` extensions, no mode classification
- Body is direct workflow instructions in Markdown
- Each skill references specific Go/Python/TypeScript source files by path

### 4.4 MCP Comparison

| Dimension | Open Design MCP | AgentHub |
|-----------|----------------|----------|
| **Has MCP server** | Yes (`od mcp`) | No |
| **Tools** | 11 (read/write/delete projects, files, search) | N/A |
| **Resources** | Skills + design systems + active context | N/A |
| **Active context** | Yes (~5 min TTL, auto-fallback) | N/A |
| **External MCP client** | Yes (30+ templates, OAuth flow) | N/A |
| **Multi-agent MCP wiring** | Claude Code + OpenCode + ACP formats | N/A |

---

## 5. What AgentHub Should Adopt

### P0 -- Immediate High Value

**1. Adopt the `od:` frontmatter pattern for AgentHub skills.**
The `name` + `description` + Markdown body convention is identical between the two systems.
What AgentHub lacks is mode classification. Adding a lightweight frontmatter extension would
enable:
- Auto-discovery: daemon or script scans `.agents/skills/` and knows what each skill does
  without reading the full body
- Trigger-based routing: match user intent phrases to the right skill
- Category grouping: separate "dev-workflow" skills from "testing" from "ops"
- Tool to add: `mode: dev-workflow`, `category: testing`, `triggers: [...]`

**2. Skill body preamble (CWD-relative paths).**
OD's `withSkillRootPreamble()` (`skills.ts:417-453`) prepends the skill's on-disk path to the
body so the agent always knows where side files live. AgentHub skills like `env-sandbox` already
reference specific source files (`edge-server/internal/lifecycle/env_sanitizer.go`), but without
a root path preamble, the agent may not resolve them correctly in a worktree context. Adopt the
two-path pattern: relative alias first, absolute fallback second.

**3. AgentHub MCP server.**
Build a minimal stdio MCP server (mirroring `mcp.ts`) that exposes AgentHub project state:
- `get_active_context` -- which project/thread/branch is currently active
- `get_state` -- read `docs/handoff/STATE.md` as a structured resource
- `get_roadmap` -- read current roadmap tasks
- `list_skills` -- enumerate `.agents/skills/`
- `get_skill` -- read a specific SKILL.md body
This would let coding agents in other directories/repos pull AgentHub context without manual
file navigation. The OD pattern of "active context with 5-min TTL" is directly applicable:
track which project the user last interacted with in the dev UI.

### P1 -- Medium Term (1-2 sprints)

**4. Skill registry API.**
Implement a `listSkills()` equivalent (`skills.ts:144-313`) that scans `.agents/skills/` on
demand and returns parsed frontmatter + bodies. Benefits:
- CI can validate skill completeness (every skill has required frontmatter fields)
- A dev UI could show available skills with descriptions
- New team members can discover available workflows without reading all SKILL.md files

**5. Skill shadowing (user overrides).**
The OD pattern of user skills shadowing built-in skills (`skills.ts:150-179`) would let
individual developers customize a shared skill without committing their changes. For example,
a developer could add project-specific model preferences to `dev-loop` without modifying the
committed version. Implemented as: scan `<userData>/skills/` first, then `.agents/skills/`;
first match by `name` wins.

**6. Derived examples for dev-loop.**
The `dev-loop` skill could ship example sessions under `examples/*.md` showing successful
completion patterns: a 3-step bug fix, a cross-file refactor, a multi-agent review cycle.
These would surface as reference cards (like OD's gallery) rather than being buried in
the skill body.

**7. External MCP server templates for AgentHub.**
Adopt the template catalogue pattern from `mcp-config.ts:494-1170` for AgentHub-specific
integrations: GitHub, Cloudflare, Tailscale, PostgreSQL, Redis. Store as a compact JSON
array alongside the daemon config. This gives AgentHub's spawn layer a single source of
truth for wiring external MCP servers into agent subprocesses.

### P2 -- Long Term (3+ sprints)

**8. Prompt composition pipeline.**
OD's multi-layer system prompt (DESIGN.md -> craft -> skill -> brief) is design-specific
but the pattern generalizes. For AgentHub, the layers would be:
```
[AGENTS.md rules] -> [STATE.md context] -> [Skill body] -> [Task card]
```
Each layer prunes to what's relevant for the current task, saving context window tokens.

**9. Skill testing harness.**
OD's `tests/*.prompt` + `expected.manifest.json` pattern (`skills-protocol.md:353-364`)
runs skills with a cheap model and asserts structural outputs. For AgentHub's `integration-test`
skill, this could mean: give it a mock Go package, assert that `*_test.go` files are created
with correct coverage, assert that `go test ./...` passes.

**10. Category taxonomy for development skills.**
OD's 14-category curated catalogue (`skills/AGENTS.md:42-46`) maps well to design domains.
AgentHub could adopt a parallel taxonomy for development skills:
`code-generation`, `testing`, `review`, `deployment`, `security`, `documentation`,
`refactoring`, `debugging`, `performance`.

---

## Summary

Open Design's skill system is a production-grade, multi-mode artifact generation engine built
on top of the Claude Code `SKILL.md` convention. Its key innovations are: (1) the `od:`
frontmatter extension that adds design-specific metadata without breaking compatibility,
(2) a layered prompt composition pipeline that injects design systems, craft rules, and skill
bodies in priority order, (3) a dual catalog/stub model that keeps the repo lean while
surfacing 132 skills, and (4) a full MCP server that bridges the daemon's HTTP API to any
stdio-capable coding agent.

AgentHub's skill system serves a different purpose (development workflow orchestration vs.
artifact generation) but uses the same `SKILL.md` convention. The most impactful adoptions
are: (1) lightweight frontmatter extensions for discovery and routing, (2) a skill registry
with scan+parse logic, (3) an MCP server exposing project state as resources, and (4) the
skill shadowing pattern for per-developer customization.

The two systems are complementary: OD skills produce designs, AgentHub skills orchestrate
the development of the code that produces those designs. Both benefit from the same
underlying `SKILL.md` format and the same MCP integration patterns.
