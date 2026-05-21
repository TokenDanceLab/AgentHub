# AgentHub Agent Identity & Contact System Design

> Date: 2026-05-21
> Based on: cross-repo analysis of LibreChat (Agent Marketplace), OpenCode (8 built-in agents), ChatDev (role-based team model), design-desktop-ux.md (sidebar+chat UI), design-cli-wizard.md (agent config)

---

## 1. Agent Identity Metadata Schema

Each Agent in AgentHub has a unified identity card that drives both runtime behavior and UI representation.

### 1.1 Core Identity Fields

```yaml
agent:
  id: "claude-code-build"          # Unique slug (kebab-case)
  display_name: "Claude Build"     # Human-readable name
  avatar:                          # Visual identifier (3-tier fallback)
    type: "emoji"                   # emoji | initials | icon | image_url
    value: "\u{1F527}"             # Depends on type: emoji char, initials string, icon name, URL
  color: "#D97706"                 # Accent color for avatar ring and authority stripe
  description: "Full-capability coding agent for implementation tasks."
  classification: "executor"       # executor | reviewer | orchestrator | explorer | custom
  hidden: false                    # Hidden agents don't appear in picker/marketplace

  # Persona (structured role description)
  persona:
    tagline: "Builds, edits, and ships code across the full stack."
    tone: "direct, technical, concise"
    domain: ["software-engineering", "devops", "data-engineering"]
    constraints:                     # Hard behavioral boundaries
      - "Always confirm before running destructive commands"

  # Capability tags (for search/browse/filter)
  capabilities:
    - code-generation
    - file-editing
    - command-execution
    - git-operations
    - multi-step-planning

  # System prompt template (go template syntax)
  system_prompt_template: |
    You are {{.DisplayName}}, an {{.Classification}} agent.
    Your role: {{.Persona.Tagline}}
    Tone: {{.Persona.Tone}}
    {{range .Persona.Constraints}}- {{.}}
    {{end}}
    Available tools: {{join .Tools ", "}}
    Current workspace: {{.Workspace}}

  # Task affinity hints (for auto-routing)
  affinity:
    strengths: ["complex refactoring", "greenfield implementation", "debugging"]
    weaknesses: ["frontend design review", "accessibility auditing"]

  # Model & provider binding
  backend:
    adapter: "claude-code"          # Which CLI adapter powers this agent
    model: "claude-sonnet-4-5"      # Default model (can be overridden at runtime)
    provider: "anthropic"
    temperature: 0.7
    max_turns: 25

  # Toolset
  tools:
    mode: "allowlist"               # allowlist | denylist | inherit
    items:                          # Tool names from adapter's tool registry
      - Read
      - Write
      - Edit
      - Bash
      - Glob
      - Grep
      - Task                         # Subagent spawn capability

  # Permissions
  permissions:
    mode: "default"                 # default | accept-edits | bypass | plan
    rules:                          # Override specific permissions
      - tool: "Bash"
        action: "ask"               # ask | allow | deny
      - tool: "Write"
        paths: ["*.md"]
        action: "allow"

  # Memory attachment
  memories:
    - store: "project-index"        # References a global memory store
      retrieve_stages: ["pre-gen", "gen"]
      top_k: 5
      read: true
      write: true

  # Visibility / sharing (P1+)
  visibility: "workspace"           # private | workspace | public
  created_by: "user:ding"
  created_at: "2026-05-21T10:00:00Z"
  updated_at: "2026-05-21T12:00:00Z"
```

### 1.2 Avatar Rendering Rules

| Priority | `avatar.type` | Render Source | Fallback |
|----------|---------------|---------------|----------|
| 1 | `emoji` | Single emoji character | Color swatch |
| 2 | `initials` | First 1-2 letters of display_name | Color swatch with initials |
| 3 | `icon` | Lucide icon name (mapped to React component) | Color swatch |
| 4 | `image_url` | Remote URL or data URI | Initials fallback |

Avatar is always rendered in a 36px circle (sidebar), 28px circle (inline mention), with a 2px ring in the agent's `color`. Online status dot (8px) is anchored to the bottom-right of the avatar circle.

### 1.3 Capability Tag Taxonomy

Standardized tags for cross-agent search and comparison:

| Category | Tags |
|----------|------|
| **Core** | `code-generation`, `code-review`, `debugging`, `refactoring` |
| **Filesystem** | `file-reading`, `file-editing`, `file-creation`, `file-deletion` |
| **Execution** | `command-execution`, `scripting`, `test-running`, `build-running` |
| **Search** | `code-search`, `web-search`, `dependency-search`, `semantic-search` |
| **Git** | `git-operations`, `commit-generation`, `diff-analysis`, `branch-management` |
| **Coordination** | `task-delegation`, `multi-agent-planning`, `progress-tracking` |
| **Specialty** | `frontend-dev`, `backend-dev`, `devops`, `data-science`, `security-audit` |

---

## 2. Agent Role Classification System

### 2.1 Five Archetypes

Inspired by OpenCode's built-in agent modes and ChatDev's role-based team model, AgentHub classifies every agent into one of five archetypes:

| Archetype | Symbol | Role | Analogues |
|-----------|--------|------|-----------|
| **executor** | wrench | Builds, edits, runs code. The primary doer. | OpenCode `build`, ChatDev Programmer (all 5 variants) |
| **reviewer** | search-check | Inspects, audits, tests. Quality gate. | OpenCode (none built-in), ChatDev Code Reviewer + Software Test Engineer |
| **orchestrator** | network | Plans, delegates, coordinates multi-agent work. | OpenCode `general` (subagent), ChatDev CEO + CPO |
| **explorer** | compass | Searches, discovers, reports. Read-only by default. | OpenCode `explore` + `scout`, ChatDev (none built-in) |
| **custom** | user | User-defined role, freeform configuration. | User-created agents, plugin-provided agents |

### 2.2 Classification-Driven Defaults

| Property | executor | reviewer | orchestrator | explorer | custom |
|----------|----------|----------|--------------|----------|--------|
| **Default permissions** | allow-edit, ask-bash | read-only, allow-run-tests | allow-all, allow-subagent-spawn | read-only, deny-edit | user-configured |
| **Default toolset** | Read/Write/Edit/Bash/Task/Grep/Glob | Read/Bash(test)/Grep/Glob/Task(review) | Read/Write/Edit/Bash/Task/Grep/Glob | Read/Grep/Glob/WebFetch/WebSearch | user-configured |
| **Max turns** | 25 | 15 | 30 | 10 | user-configured |
| **Temperature** | 0.7 | 0.3 | 0.8 | 0.5 | user-configured |
| **System prompt tone** | Direct, action-oriented | Critical, thorough | Strategic, coordinating | Curious, exhaustive | user-configured |
| **Subagent spawn** | Allow (as needed) | Deny | Allow (primary role) | Deny | user-configured |
| **Avatar default emoji** | wrench | microscope | sitemap | magnifying-glass | bot |

### 2.3 Classification State Machine

```
                    ┌──────────┐
                    │  custom   │  (user-defined, always mutable)
                    └────┬─────┘
                         │ user promotes classification
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
┌──────────┐      ┌──────────┐        ┌──────────┐
│ executor │      │ reviewer │        │ explorer │
└────┬─────┘      └────┬─────┘        └──────────┘
     │                  │
     │   orchestrated   │  reporting
     │   by             │  to
     ▼                  ▼
┌─────────────────────────────────┐
│        orchestrator              │
│  (coordinates executors +        │
│   reviewers + explorers)         │
└─────────────────────────────────┘
```

Orchestrators can spawn executor/reviewer/explorer subagents. Reviewers report findings to the orchestrator or directly to the user. Explorers feed search results to any archetype.

---

## 3. Default Persona Templates

### 3.1 Template Architecture

Personas are defined as parameterized templates. A template is instantiated by binding it to a backend adapter + model, producing a concrete Agent identity card. Templates are stored in `~/.agenthub/personas/` (YAML) and can be shared via the AgentHub marketplace (P1+).

```yaml
# ~/.agenthub/personas/senior-backend-dev.yaml
template:
  id: "senior-backend-dev"
  display_name: "Senior Backend Developer"
  classification: "executor"
  avatar: { type: "emoji", value: "\u{1F40D}" }  # snake
  color: "#059669"
  description: "Experienced backend engineer specializing in API design, database optimization, and system architecture."
  persona:
    tagline: "Designs robust APIs, optimizes queries, and builds scalable backend systems."
    tone: "pragmatic, performance-conscious, pattern-aware"
    domain: ["backend", "api-design", "databases", "system-architecture"]
    constraints:
      - "Always add error handling and input validation"
      - "Prefer standard library over third-party deps unless justified"
      - "Include tests for new functionality"
  capabilities:
    - code-generation, file-editing, command-execution
    - code-search, git-operations, multi-step-planning
  tools:
    mode: "allowlist"
    items: [Read, Write, Edit, Bash, Grep, Glob, Task]
  permissions:
    mode: "default"
  affinity:
    strengths: ["API development", "database schema design", "performance profiling"]
    weaknesses: ["CSS/frontend styling", "mobile development"]
  system_prompt_template: |
    You are {{.DisplayName}}, a {{.Classification}} agent.
    {{.Persona.Tagline}}
    Tone: {{.Persona.Tone}}
    {{range .Persona.Constraints}}
    - {{.}}
    {{end}}
    Before writing code, understand the existing patterns in the codebase.
    Follow the project's conventions. When in doubt, read existing files first.
```

### 3.2 Built-in Template Catalog

AgentHub ships with 9 default persona templates, covering OpenCode's 5 active modes plus ChatDev's proven team roles:

| Template ID | Display Name | Classification | Source Inspiration |
|-------------|--------------|----------------|--------------------|
| `build` | Build Agent | executor | OpenCode `build` -- full-capability coder |
| `plan` | Planning Agent | orchestrator | OpenCode `plan` -- read-only strategist |
| `review` | Code Reviewer | reviewer | ChatDev Code Reviewer -- quality gate |
| `test` | Test Engineer | reviewer | ChatDev Software Test Engineer |
| `explore` | Code Explorer | explorer | OpenCode `explore` -- fast read-only search |
| `scout` | Dependency Scout | explorer | OpenCode `scout` -- repo/docs search |
| `ceo` | Product Manager | orchestrator | ChatDev CEO -- requirement analysis + delegation |
| `programmer` | Full-Stack Programmer | executor | ChatDev Programmer composite -- coding + completion |
| `general` | General Assistant | custom | OpenCode `general` -- complex multi-step tasks |

### 3.3 Template Instantiation Example

```bash
# Create an agent from a template
agenthub config agent create --from-template senior-backend-dev \
  --adapter claude-code \
  --model claude-sonnet-4-5 \
  --name "my-backend-agent"

# List available templates
agenthub config agent templates
```

Instantiation merges template defaults with user overrides, producing a concrete agent entry in `config.yaml`:

```yaml
agents:
  my-backend-agent:
    template: "senior-backend-dev"
    adapter: "claude-code"
    model: "claude-sonnet-4-5"
    # All template fields are inherited; overrides are shallow-merged
    permissions:
      mode: "accept-edits"  # Override: more permissive than template default
```

### 3.4 Hidden Utility Agents

Following OpenCode's pattern, AgentHub reserves three hidden agent types for system use (never shown in contact list or marketplace):

| Agent | Classification | Purpose |
|-------|---------------|---------|
| `_compaction` | hidden | Session context summarization. No tools. |
| `_title` | hidden | Auto-generate conversation titles. temperature=0.5. |
| `_summary` | hidden | Produce conversation summaries for sidebar preview. |

These are instantiated automatically by the Hub/Edge and are not user-configurable.

---

## 4. Agent Contact UI Design

### 4.1 Sidebar Contact List Layout

The left sidebar (280px default, from `design-desktop-ux.md` Section 1) gains an "Agents" section below the ProjectTree. This presents agents as a contact list -- the IM metaphor for agent interaction.

```
┌─────────────────────────────────┐
│ 🔍 Search sessions...           │
│ [All] [Hub] [Edge:us1] [+ New] │
├─────────────────────────────────┤
│ 📂 project-search               │  ← ProjectTree (existing)
│   ├─ auth-refactor              │
│   └─ deploy-k8s                 │
├─────────────────────────────────┤
│ AGENTS                     [⋯]  │  ← Agent contact list header
│ ┌─────────────────────────────┐ │
│ │ 🐍 Senior Backend Dev  🟢  │ │  ← Emoji avatar + name + online dot
│ │ backend, api-design         │ │  ← Capability tags (1-2, truncated)
│ │ Active · 2m ago             │ │  ← status + relative time
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🔨 Build Agent         🟡   │ │  ← Busy (running)
│ │ code-generation, refactor   │ │
│ │ Running auth-refactor       │ │  ← Current task preview
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🔍 Code Explorer        ⚫   │ │  ← Offline (no active session)
│ │ search, codebase-explore    │ │
│ │ Last active · 1h ago        │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🧪 Test Engineer        ⚫   │ │
│ │ testing, debugging          │ │
│ │ Idle                        │ │
│ └─────────────────────────────┘ │
│                                 │
│ [+ Add Agent] [Browse Market]  │  ← Footer actions
└─────────────────────────────────┘
```

### 4.2 Agent Card Component States

Each `AgentCard` in the contact list renders one of five states:

| State | Dot Color | Hover Action | Click Action |
|-------|-----------|-------------|--------------|
| **online** (idle) | green | Show expanded card | Start new conversation |
| **busy** (running) | yellow/pulse | Show current task preview | Jump to active conversation |
| **offline** | gray | Show last-active time | Open agent config |
| **error** | red | Show error reason | Open agent diagnostic |
| **needs_setup** | orange | Show setup hint | Open setup wizard |

### 4.3 Expanded Contact Card (Hovercard)

Hovering a contact card reveals a 300px popover with full agent profile:

```
┌──────────────────────────────────────┐
│  🐍  Senior Backend Developer   🟢   │
│  executor · Claude Sonnet 4.5        │
│                                      │
│  "Designs robust APIs, optimizes     │
│   queries, and builds scalable       │
│   backend systems."                  │
│                                      │
│  Capabilities                        │
│  [code-gen] [file-edit] [cmd-exec]   │
│  [code-search] [git-ops] [planning]  │
│                                      │
│  Affinity                            │
│  ✓ API development                   │
│  ✓ Database schema design            │
│  ✗ CSS/frontend styling              │
│                                      │
│  Active sessions: 2                  │
│  Total conversations: 47            │
│  Avg. tokens/run: 3.2k              │
│                                      │
│  [Start Chat]    [Edit Agent]        │
│  [Duplicate]     [View Sessions]     │
└──────────────────────────────────────┘
```

### 4.4 In-Chat Agent Representation

When an agent participates in a conversation, it appears in the message flow with its identity card:

**MessageHeader** (existing component from `design-desktop-ux.md`, enhanced):
```
┌─────────────────────────────────────────────────────────────┐
│ 🐍 Senior Backend Developer · [Edge:us1] · 2 min ago       │
│ executor · Claude Sonnet 4.5 · Run #3                       │
├─────────────────────────────────────────────────────────────┤
│ I've analyzed the auth module and found three issues:       │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

The avatar, classification badge, and capability tags are all rendered inline from the agent's identity card.

### 4.5 Agent Selector (Compose Area)

The compose area includes an agent mention picker. Typing `@` opens a fuzzy-search dropdown:

```
┌──────────────────────────────────────────┐
│ @senior                                     │
│ ┌────────────────────────────────────────┐ │
│ │ 🐍 Senior Backend Developer            │ │
│ │    executor · Claude Sonnet 4.5 · 🟢   │ │
│ │    backend, api-design, databases      │ │
│ ├────────────────────────────────────────┤ │
│ │ 🐍 Junior Backend Dev (custom)         │ │
│ │    executor · Claude Sonnet 4.5 · 🟢   │ │
│ │    backend, api-design                 │ │
│ ├────────────────────────────────────────┤ │
│ │ 🔍 Code Explorer                       │ │
│ │    explorer · Claude Haiku 4.5 · ⚫     │ │
│ │    search, codebase-explore            │ │
│ └────────────────────────────────────────┘ │
│                                             │
│ Recent agents: 🐍 Senior BE  🔨 Build      │
└──────────────────────────────────────────────┘
```

Multiple `@mentions` start a group chat. The first `@mention` sets the primary agent (receives the prompt directly). Subsequent `@mentions` add observers or secondary agents (receive context but don't act unless explicitly addressed).

### 4.6 Agent Status Store

```ts
// src/stores/agentContactStore.ts
interface AgentContactState {
  agents: Map<string, AgentContact>
  agentOrder: string[]
  filters: {
    classification: string[]     // ['executor', 'reviewer', ...]
    capability: string[]         // ['code-generation', ...]
    status: ('online' | 'busy' | 'offline' | 'error' | 'needs_setup')[]
  }
}

interface AgentContact {
  // Core identity (from agent config)
  id: string
  displayName: string
  avatar: Avatar
  color: string
  classification: Classification
  capabilities: string[]

  // Runtime status (updated via WS events)
  status: AgentStatus
  activeRunId: string | null
  activeSessionTitle: string | null
  lastActiveAt: string

  // Stats (computed from run history)
  totalConversations: number
  avgTokensPerRun: number
  recentActivity: ActivityEntry[]   // last 5 runs
}

type AgentStatus = 'online' | 'busy' | 'offline' | 'error' | 'needs_setup'

interface ActivityEntry {
  runId: string
  action: string
  threadTitle: string
  timestamp: string
  tokensUsed: number
}
```

**WebSocket Events -> AgentContactStore mapping**:

| WS Event | Store Action | Effect |
|----------|-------------|--------|
| `run.started` | `setAgentStatus(id, 'busy')` | Yellow dot + task preview |
| `run.completed` | `setAgentStatus(id, 'online')` | Green dot + update lastActiveAt + push ActivityEntry |
| `run.failed` | `setAgentStatus(id, 'error')` | Red dot + error reason |
| `agent.registered` | `addAgent(contact)` | New card appears |
| `agent.unregistered` | `removeAgent(id)` | Card removed |
| `agent.config_updated` | `updateAgent(id, patch)` | Refresh card metadata |

### 4.7 Agent Quick Actions (Context Menu)

Right-clicking an AgentCard opens a context menu:

| Action | Behavior |
|--------|----------|
| **Start Chat** | Create new conversation with this agent as primary |
| **Add to Current Chat** | @mention this agent in the active conversation |
| **View Active Sessions** | Filter sidebar to show only this agent's conversations |
| **Duplicate Agent** | Clone config with new name (e.g., "Senior BE - Strict") |
| **Edit Agent** | Open agent config panel (SidePanel) |
| **Set Offline** | Mark agent as unavailable (stops auto-routing) |
| **Remove Agent** | Delete agent config and archive conversations |

### 4.8 Integration with Existing Sidebar

The Agent Contact list integrates into the existing `LeftSidebar` component tree from `design-desktop-ux.md`:

```
LeftSidebar
├── SidebarToolbar
│   ├── NewThreadButton
│   ├── ToggleArchiveButton
│   └── SettingsGear
├── SearchBar
├── ProjectTree              (existing)
│   └── ThreadCard[]
├── AgentContactList         (NEW)
│   ├── AgentContactHeader   ("AGENTS" label + filter dropdown + collapse chevron)
│   └── AgentCard[]          (virtualized list, 36px rows)
│       ├── Avatar (36px circle + 2px color ring + status dot)
│       ├── AgentName + ClassificationBadge
│       ├── CapabilityTags (max 2, truncated with "+N")
│       └── ActivityLine (status text or task preview)
├── SidebarPluginSlot
└── SidebarFooter
```

The AgentContactList can be collapsed/expanded independently from ProjectTree. Default state: collapsed when no agents are active, auto-expands when any agent is busy.

---

## 5. Persona Template Sharing (P1+ Marketplace)

### 5.1 Template Package Format

```
my-agent-team/
├── manifest.yaml           # Template metadata + version
├── personas/
│   ├── senior-backend.yaml
│   ├── frontend-reviewer.yaml
│   └── devops-engineer.yaml
└── README.md               # Usage guide
```

### 5.2 Marketplace Integration

- Templates are published to AgentHub Marketplace (P1+)
- Discovery via search + capability tags + classification filter
- One-click install: `agenthub config agent install <template-id>`
- Versioning: templates follow semver; installed agents can opt into auto-update

---

## 6. Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity model | Single YAML card + template instantiation | ChatDev's FIELD_SPECS-driven form + OpenCode's Agent Info Schema combined |
| Classification | 5 archetypes (executor/reviewer/orchestrator/explorer/custom) | Covers OpenCode's 5 active modes + ChatDev's team roles without over-fragmentation |
| Avatar system | 4-tier fallback (emoji > initials > icon > image) | No external dependency; works fully offline |
| Capability tags | Standardized taxonomy of 7 categories | Enables cross-agent search and auto-routing |
| Persona templates | Parameterized YAML + go template syntax | ChatDev's yaml_instance pattern + AgentHub's adapter-binding model |
| Contact UI | Sidebar section with 5-state status dots | IM metaphor; consistent with design-desktop-ux.md sidebar component tree |
| Agent mention | @ fuzzy-search dropdown in compose area | Familiar IM UX pattern; supports group chat initiation |
| Hidden agents | `_compaction`, `_title`, `_summary` reserved | Matches OpenCode's compaction/title/summary hidden agents |
| Template sharing | Manifest + personas/ directory + marketplace | Extensible for P1+ without changing P0 sidebar/contact model |

---

## 7. References

- `librechat.md` -- Agent Marketplace grid + CategoryTabs + AgentDetail panels
- `opencode.md` -- 8 built-in agents, Agent Info Schema, `generateObject()` dynamic generation
- `chatdev.md` -- ChatDev role-based team model, FIELD_SPECS + child_routes config system, yaml_instance templates
- `design-desktop-ux.md` -- LeftSidebar component tree, ThreadCard with AgentIcon, MessageHeader with ActorAvatar
- `design-cli-wizard.md` -- `agenthub config agent` CRUD commands, agent detection flow
- `cross-analysis-im-ux.md` -- Sidebar session list design, Authority badge pattern, AgentHub positioning

---

*Design complete. 2026-05-21.*
