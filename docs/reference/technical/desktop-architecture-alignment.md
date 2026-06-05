# Desktop Architecture Alignment Audit

> Generated: 2026-05-25 | Auditor: Agent 5 — Architecture Alignment Audit

## 1. Architecture Overview (from docs)

The system architecture defines a **Hub-Edge-Runner** three-tier model:

```
UI (Desktop/Web) → Edge Server (local control) → Runner (process execution)
                                        ↕ (reverse WSS)
                                   Hub Server (cloud IM/auth/sync)
```

### 1.1 Four Core Concepts

Per the architecture, there are four distinct entities:

1. **Agent Runtime** — The CLI/SDK adapter (e.g., Claude Code, Codex, OpenCode). This is the execution engine.
2. **Agent Profile** — A composed entity binding a Runtime to: model, configuration, execution target.
3. **Agent Configuration** — Settings bundle: AGENTS.md, memory, context, skills, MCP, approval policy.
4. **Execution Target** — Where the run executes: Local Edge, Hub Relay, SSH/Tailscale, Cloud Edge.

### 1.2 Authority Model

Two explicit authorities per session:
- **Conversation Authority** — who stores messages (Edge or Hub)
- **Execution Authority** — who actually runs the agent (Edge + Runner + Workspace)

---

## 2. Code vs Architecture — Alignment Check

### 2.1 Agent Runtime Display

**Current implementation:** `AgentList.tsx` + `App.tsx:597-614`

The sidebar is labeled "Agent Runtimes" (`agent.title` = "Agent Runtimes") and the list shows agents from `useAgentList(online)`.

**Architecture says:** Agent Runtimes are the raw CLI adapters (Claude Code, Codex, OpenCode). They are NOT user-facing agents — they are execution engines.

**Alignment: PARTIAL**
- The sidebar correctly shows runtime adapters (e.g., "Claude Code", "Codex", "OpenCode")
- Uses `@lobehub/icons` for visual identity (ClaudeCode, Codex, OpenCode icons)
- Status dots show availability (green = available, red = unavailable)
- **But:** The label "Agent Runtimes" is technically correct but confusing to end users who may not understand the Runtime vs Profile distinction

**Gap:** There is no visual distinction between "Runtime adapters" (raw execution engines) and "Agent Profiles" (composed entities). The sidebar treats them as the same thing.

### 2.2 Agent Profile Composition

**Current implementation:** `utils/agentProfile.ts` — `preferredProfileAlias()` function

**Architecture says:** Agent Profiles bind Runtime + Model + Configuration + Execution Target.

**Alignment: MISMATCH**
- The UI does not show composed Agent Profiles as distinct from raw Runtimes
- `preferredProfileAlias()` returns a model alias for the selected agent — this is profile composition at the code level, but invisible to the user
- The settings page has an "Agent Profiles" section with extensive descriptions, but the runtime-to-profile mapping is not visually represented

**Gap:** The architecture defines Agent Profiles as the primary user-facing concept, but the UI still shows raw Runtimes. Users should be composing "My Claude Opus Profile" rather than selecting "Claude Code" raw.

### 2.3 Agent Configuration

**Current implementation:** Settings > Configuration, Settings > Models, Settings > Permissions

**Architecture says:** Configuration = AGENTS.md + memory + context + skills + MCP + approval policy.

**Alignment: SCATTERED**
- Configuration settings are spread across 10+ settings sections
- No unified "Agent Configuration" view that bundles all config for a specific profile
- The concept of "configuration per agent profile" does not exist in the UI

### 2.4 Execution Target

**Current implementation:** Settings > Execution Targets

**Architecture says:** Where the run executes (Local Edge, Hub Relay, SSH/Tailscale, Cloud Edge).

**Alignment: PARTIAL**
- "Local Edge" is the only active target — shown as a tag in AgentList and WelcomeScreen
- Hub Relay, SSH/Tailscale, Cloud Edge are all "reserved" — described in settings but not functional
- The execution target is not shown in the main chat flow — users cannot choose where a run executes

**Gap:** The execution target concept exists only in settings text, not in the actual run flow. The WelcomeScreen mentions "Local Edge execution" but this is static text.

---

## 3. TokenDance ID Login Flow

### 3.1 Architecture Description

> "TokenDance ID is the unified identity entry point for Hub, devices, agent market, and cross-device sync."

### 3.2 Current Implementation

**Auth flow:**
1. App.tsx shows Hub login indicator (sidebar/rail circle icon)
2. Click → `showAuthModal` = true → AuthPage renders in modal overlay
3. AuthPage has: LoginForm (username/password) + RegisterForm
4. Also: "Continue with TokenDance ID" button (OIDC flow)

**Alignment: INCOMPLETE**
- TokenDance ID OIDC flow exists but is described as "pending" — PKCE state is stored, callback capture is not wired
- The desktop currently uses direct Hub login (username/password to Hub server)
- Multiple i18n keys describe TokenDance ID as "pending" (e.g., `auth.tokenDanceCallbackPending`, `settings.tokenDanceOidcPendingDesc`)

**Gap:** The architecture says TokenDance ID is the PRIMARY identity provider, but the current working flow is direct Hub login. The architecture is aspirational; the implementation is pragmatic but incomplete.

---

## 4. IM Model vs Agent Chat

### 4.1 Architecture Description

> "IM (单聊/群聊/消息路由)" — Hub provides IM services including:
> - Single chat / Group chat / Message routing
> - @mentions for agent collaboration
> - Mixed human + agent rooms

### 4.2 Current Implementation

**Two separate views:**
1. **Agent View** (main) — Agent selection → prompt → run → output
2. **IM View** (toggle) — IMContactList + IMMessageView + IMMessageInput

**Toggled via:** `MessageSquareText` icon in workspace header (`App.tsx:678-684`)

**Alignment: DISCONNECTED**
- The architecture describes IM as the PRIMARY communication model (agents as contacts in IM)
- The current UI inverts this: agent chat is primary, IM is secondary (hidden behind a toggle)
- The IM view doesn't support @mentions for agent dispatch
- The agent view doesn't feel like IM at all — it's a traditional prompt-input → run-output chat

**Fundamental tension:** The architecture envisions agents as contacts in an IM-style interface. The current implementation has agents as "execution targets" selected from a sidebar, with chat as the interaction surface. These are two different mental models.

**Recommendation:** Either:
1. Commit to the IM model — make the IM view the primary interface, with agents as contacts
2. Or acknowledge a dual-mode approach — IM for collaboration, Agent Chat for execution

### 4.3 @Mention Implementation

**Current:** `useMention` hook + `MentionPopover` component — allows `@AgentName` in the prompt input

**Architecture says:** @mentions should trigger agent dispatch in group chats

**Alignment: PARTIAL**
- @mention in agent view just selects the agent as a target
- IM view doesn't use @mention at all
- No support for @mention in group chat context (multiple agents responding)

---

## 5. Left Sidebar Structure

### 5.1 Current Implementation

```
Sidebar:
  ┌─────────────────┐
  │ [Search]        │
  ├─────────────────┤
  │ Agent Runtimes  │  ← Primary section
  │  - Claude Code  │
  │  - Codex        │
  │  - OpenCode     │
  ├─────────────────┤
  │ Threads         │  ← Secondary section
  │  - Thread 1     │
  │  - Thread 2     │
  ├─────────────────┤
  │ [Footer icons]  │
  └─────────────────┘
```

### 5.2 Architecture Expectation

Based on the architecture docs, the navigation should reflect:
- **Threads/Conversations** → primary (conversation authority)
- **Agent Profiles** → secondary (execution authority)
- **Settings/Config** → tertiary

### 5.3 Assessment: PARTIALLY ALIGNED

- Threads ARE in the sidebar, but they're secondary to Agent Runtimes
- The architecture describes threads as "first-class" but the UI treats them as an afterthought (below agents, smaller section)
- Agent Runtimes (raw adapters) are given more prominence than they deserve per the architecture

**Recommendation:** Restructure sidebar:
```
Sidebar:
  ┌─────────────────┐
  │ [Search]        │
  ├─────────────────┤
  │ Threads         │  ← Primary (conversation history)
  │  - Thread 1     │
  │  - Thread 2     │
  │  [+ New Thread] │
  ├─────────────────┤
  │ Active Profiles │  ← Secondary (which agents are available)
  │  - Claude Opus  │     (composed profiles, not raw runtimes)
  │  - Codex Fast   │
  ├─────────────────┤
  │ [Settings/etc]  │
  └─────────────────┘
```

---

## 6. Welcome Screen Alignment

### 6.1 Current Implementation

`WelcomeScreen` shows:
- "Which Agent should run today?" headline
- Runtime list (raw adapters)
- Execution target ("Local Edge")
- Task suggestions
- Command input ("Describe the task...")

### 6.2 Architecture Expectation

The welcome screen should present:
- Agent Profiles (composed entities, not raw runtimes)
- Execution Target selection
- Option to create a new thread/workspace

### 6.3 Assessment: PARTIALLY ALIGNED

- The welcome screen uses "Agent Profile" language (`welcome.profile`) but actually shows Runtime adapters
- "Local Edge" execution target is shown but not configurable
- The "Agent dispatch mode" label is confusing — it suggests a mode selection but it's actually runtime selection

---

## 7. Settings Page Alignment

### 7.1 Current: 30+ Settings Sections

The settings page covers EVERYTHING the architecture mentions, but many are placeholders:
- Agent Profiles: Described in detail, but implementation is placeholder
- Execution Targets: Described, but only Local Edge is real
- IM, Group Chat, Agent Scheduling, Agent Market: Extensive descriptions, all reserved

### 7.2 Assessment: OVER-ALIGNED

The settings page over-implements the architecture spec. It front-loads every planned feature as a visible (but empty) section. This creates user confusion and makes the product feel incomplete.

**Recommendation:** Hide placeholder sections behind a "Labs" or "Coming Soon" toggle. Only show active/functional sections by default.

---

## 8. Summary — Architecture Gaps

| # | Gap | Architecture Expectation | Current Reality | Severity |
|---|---|---|---|---|
| 1 | Agent Profile vs Runtime confusion | Profiles are user-facing; Runtimes are infrastructure | UI shows Runtimes as user-facing agents | **High** |
| 2 | IM as primary model | IM is the communication paradigm | IM is a hidden toggle, not primary | **High** |
| 3 | Thread-first navigation | Threads are the primary organizing concept | Agent Runtimes dominate the sidebar | Medium |
| 4 | Execution Target invisibility | Users should choose where runs execute | Only Local Edge shown; no choice offered | Medium |
| 5 | TokenDance ID incomplete | Primary identity provider | Direct Hub login works; OIDC is pending | Medium |
| 6 | Scattered configuration | Configuration per profile | Settings spread across 30+ sections | Medium |
| 7 | Over-aligned settings | Progressive disclosure | All planned features visible as placeholders | Low |

**Total actionable items: 7**
