# Agent Permission Models: Cross-Repository Deep Comparison

> Sources: `01-learn/deep-dive/04-claude-code-tool-security.md` (23 checks + 5-layer pipeline),
> `01-learn/repos/06-opencode.md` (allow-by-default + hierarchical merge),
> `01-learn/repos/08-openhands.md` (SecurityAnalyzer + Docker sandbox),
> `03-build/backend/08-error-handling.md` (approval state machine),
> `03-build/frontend/13-plugin-marketplace.md` (5×20 plugin permission categories)
> Date: 2026-05-21

---

## 1. Executive Summary

Four reference implementations span a spectrum from **allow-by-default with pipeline gates** (Claude Code) to **container-boundary deny-by-default** (OpenHands Docker sandbox). AgentHub's target domain -- multi-agent orchestration, plugin extensibility, and course-assignment automation -- requires a **deny-by-default + tiered authorization** model that none of the references individually provides. This document analyses the tradeoffs and recommends a synthesized design.

---

## 2. Permission Model Spectrum

### 2.1 Allow-by-Default End

**Claude Code** operates on a trust-but-verify model:

| Operation | Default | Gate |
|-----------|---------|------|
| Read-only tools (Glob, Grep, Read) | Auto-allow | None |
| Write tools (Write, Edit) | Auto-allow | `acceptEdits` mode toggle |
| Bash commands | Ask user | 23-validator security pipeline |
| Misparsing patterns | Block (no override) | Pipeline gate |
| Non-misparsing patterns | Ask (allowlist-able) | Standard permission flow |

Key characteristic: the agent is trusted to request tools; security is a **command-content filter**, not a permission deny-by-default. The `bypassPermissions` mode completely disables approval prompts for write tools.

**OpenCode** is agent-type-dependent:

| Agent | Stance | Write Tools | Special Controls |
|-------|--------|-------------|-----------------|
| `build` (primary) | Allow-by-default | Allowed | question/plan_enter=allow |
| `plan` (primary) | Deny-by-default for writes | Blocked | plan_exit=allow, read-only |
| `general` (subagent) | Allow-by-default | Allowed | todowrite=deny |
| `explore` (subagent) | Explicit allowlist | Only grep/glob/read/bash/webfetch | Minimal set |
| `scout` (experimental) | Explicit allowlist | Only repo_clone/repo_overview | Experimental |

Key characteristic: permission is **coupled to agent identity**, not a universal policy engine. The `permission.ask` hook allows plugins to intercept and override decisions.

### 2.2 Deny-by-Default End

**OpenHands** implements the strongest model via OS-level isolation:

| Boundary | Mechanism | Default |
|----------|-----------|---------|
| Filesystem | Docker volume mounts | Only explicitly mounted paths visible |
| Network | Docker bridge/host networking | Only exposed ports reachable |
| Process | Container cgroup/namespace | No host process visibility |
| Environment | Explicit env var injection | Only `OH_*` and `LLM_*` vars forwarded |
| Auth | Session API Key (32-byte random) | Bearer token required for agent-server |

Key characteristic: security is **spatial** (within/outside container), not behavioral. Inside the sandbox, the agent has full freedom. The sandbox wall is the only permission check.

### 2.3 Spectrum Visualization

```
Allow-by-Default ◄────────────────────────────────────────► Deny-by-Default

OpenCode           Claude Code          AgentHub Plugin      OpenHands
(build agent:      (pipeline gate:      (intersection:       (container wall:
 most tools OK,    23 checks filter     manifest ∩ user ∩    nothing crosses
 plan agent:       bash content,        policy; explicit     unless explicitly
 deny writes)      write=ask)           grant required)      mounted/exposed)
```

AgentHub's synthesized position: **right of Claude Code, left of OpenHands** -- deny-by-default for the plugin/sandbox boundary, security-pipeline-gated for intra-sandbox operations.

---

## 3. Permission Granularity Comparison

### 3.1 Four Levels of Granularity

| Level | Claude Code | OpenCode | OpenHands | AgentHub Plugin |
|-------|-------------|----------|-----------|-----------------|
| **Tool-level** | tool_name + isReadOnly boolean | Permission.Ruleset per agent | N/A (inside sandbox) | 6 slot types × permission categories |
| **File-level** | Path pattern in policy rules | GLOB: `read/edit/write` per path, `external_directory` | Volume mount (directory-level) | `fs.read/write/delete` + project-scope enforcement |
| **Command-level** | 23 validators on bash content | N/A | N/A | `fs.exec`, `system.process.spawn` |
| **Network-level** | N/A (no network gate) | N/A | Exposed ports only | `network.http/websocket/listen` |

### 3.2 Detailed Granularity Matrix

**Claude Code -- Policy Rule Match Fields:**

```
ToolPattern: "bash" | "write" | "edit" | glob
ToolInputKey: "command" | "file_path" | "content"
PathPattern: glob on file_path
RiskLevel: low | medium | high | critical
```

A single policy rule can match on any combination of tool name, input key/value regex, file path glob, and declared risk level. This is **coarse-grained** (tool + path) but **flexible** (any input field matchable).

**OpenCode -- Agent Permission Ruleset:**

```ts
permission: {
  "*": "allow" | "deny" | "ask",           // global default
  external_directory: { "**": "ask" },      // path outside workspace
  read: { "*.md": "allow" },                // file-level read
  edit: { "**/*.ts": "allow" },             // file-level edit
  write: { "package.json": "ask" },         // file-level write
  doom_loop: "ask",                         // special control
  question: "allow",                        // special control
}
```

This is **medium-grained**: file-level GLOB with three operation types (read/edit/write), plus named special controls. No command-content-level inspection.

**AgentHub Plugin -- 5 Categories x 20 Sub-permissions:**

```
fs:      read | write | delete | exec
network: http | websocket | listen
agent:   prompt | messages.read | tool.intercept | tool.define | subagent.spawn
system:  env.read | process.spawn | clipboard | notification
ui:      inject | theme | shortcut
user:    identity | secrets
```

This is the **finest-grained model** in the comparison set: 20 sub-permissions across 5 categories, enforced at runtime via intersection (manifest ∩ user config ∩ policy).

### 3.3 Granularity Recommendation for AgentHub

AgentHub should operate at **all four levels simultaneously**, layered:

```
Layer 1 (Coarse):   Sandbox boundary -- workspace isolation (OpenHands pattern)
Layer 2 (Medium):   Tool-level + file-GLOB -- which tools on which paths (OpenCode pattern)
Layer 3 (Fine):     Command-content -- security pipeline on bash/powershell (Claude Code pattern)
Layer 4 (Finest):   Plugin permissions -- 5×20 sub-permission gates (Plugin Marketplace pattern)
```

---

## 4. Permission Persistence & Scope

### 4.1 Persistence Hierarchy

| Scope | Claude Code | OpenCode | OpenHands | AgentHub (Target) |
|-------|-------------|----------|-----------|-------------------|
| **Turn-level** | "Approve once" per tool call | `permission.ask` hook dynamic decision | N/A (no per-turn gate) | Thread-scoped decision cache |
| **Session-level** | "Always allow for this session" | Config in memory until restart | Session API key lifetime | Session-scoped decision cache |
| **Project-level** | `.claude/settings.json` allowlist rules | `opencode.toml` agent config | SandboxSpec template | Project-scoped policy rules |
| **User/Global** | `~/.claude/settings.json` | `~/.config/opencode/` | N/A | `~/.agenthub/settings.json` |
| **Team/Org** | N/A (no multi-user) | Enterprise: identity provider | Organization config | Team/Enterprise policy priority |
| **System/Default** | 9-source priority, lowest=default | Built-in agent defaults | Docker daemon config | Reserved priority bands |

### 4.2 Claude Code's 9-Source Priority System

```
Priority  0: CLI flags       (--dangerously-skip-permissions)
Priority  1: Session rules   ("always allow for this session")
Priority  2: User settings   (~/.claude/settings.json)
Priority  3: Project local   (.claude/settings.json)
Priority  4: Agent config    (per-agent configuration)
Priority  5: Team policy     (enterprise-managed)
Priority  6: Enterprise      (organization-wide)
Priority  7: System default  (built-in high-risk patterns)
Priority  8: Catch-all       (default allow/deny)
```

Lower number = higher priority = checked first. First match wins, evaluation stops. This is the most mature priority system in the comparison set and should be adopted directly by AgentHub.

### 4.3 OpenCode's Hierarchical Merge (Different Approach)

OpenCode does not use priority ordering; it uses **layered merge**:

```
defaults → agent built-in → user config → effective
```

Each layer overrides the previous. There is no "priority" -- the last-defined value wins. This is simpler but less flexible for multi-tenant/team scenarios. AgentHub should prefer the priority model for its conflict resolution clarity.

### 4.4 Persistence Recommendation

AgentHub should adopt Claude Code's 9-source priority, extended with plugin-level rules:

```
Priority  0: CLI flags           (--approve-bash, --dangerously-skip-permissions)
Priority  1: Runtime decisions    (session-scoped "always allow")
Priority  2: User settings        (~/.agenthub/settings.json)
Priority  3: Project local        (.agenthub/rules.json)
Priority  4: Plugin permissions   (manifest.yaml declared ∩ user-approved)
Priority  5: Agent configuration  (per-agent.yaml)
Priority  6: Team policy          (team-level from Hub API)
Priority  7: Enterprise policy    (organization-wide)
Priority  8: System defaults      (built-in high-risk patterns)
Priority  9: Catch-all            (default deny or ask)
```

---

## 5. Enforcement Mechanisms Deep-Dive

### 5.1 Claude Code: Content-Aware Pipeline

The 23-validator pipeline is the deepest enforcement mechanism in the comparison. Its key architectural insight is the **misparsing vs non-misparsing** distinction:

- **Misparsing (21 validators)**: patterns that the security parser itself cannot reliably interpret. Results carry `isBashSecurityCheckForMisparsing: true`. These **bypass all allowlist rules** -- no user-configurable rule can auto-approve a misparsing concern. The user must explicitly approve each instance.

- **Non-misparsing (2 validators)**: `validateNewlines` and `validateRedirections`. Correctly parsed by both shell-quote and bash. These flow through standard permissions: allowlist rules can auto-approve.

- **Deferred non-misparsing**: if a non-misparsing validator fires first, its result is deferred. The pipeline continues checking misparsing validators. Only if no misparsing validator fires is the deferred result used. This prevents a low-severity non-misparsing match from masking a high-severity misparsing concern.

**Six documented attack vectors that the pipeline blocks** (from HackerOne disclosures):

1. Brace expansion obfuscation (validator 21)
2. Backslash-escaped operator double-parse (validator 18)
3. Carriage return parser differential (validator 11)
4. Comment-quote desync (validator 9)
5. Quoted-newline hides args (validator 10)
6. Mid-word hash parser differential (validator 20)

### 5.2 OpenCode: Hook-Based Interception

Enforcement is distributed across three mechanisms:

1. **Agent permission ruleset**: static declaration of allowed/denied tools and paths per agent
2. **`permission.ask` hook**: plugins can dynamically block, allow, or escalate any permission request
3. **`tool.execute.before` hook**: can modify tool arguments or set `block=true` before execution

No content-level inspection of bash commands. The hooks provide extensibility but lack the deep command parsing of Claude Code's pipeline.

### 5.3 OpenHands: Spatial Enforcement

Enforcement is structural, not behavioral:

- **Docker volume mounts**: only explicitly declared host paths are visible inside the sandbox
- **Bridge networking**: no host network access unless `AGENT_SERVER_USE_HOST_NETWORK=true`
- **Environment variable filtering**: only `LLM_*` and `LMNR_*` prefixed vars forwarded unless overridden via `OH_AGENT_SERVER_ENV`
- **Session API Key**: 32-byte random bearer token required for all agent-server communication

This is the strongest isolation but the coarsest granularity. No fine-grained control over what the agent does inside the sandbox.

### 5.4 AgentHub Plugin: Three-Tier Intersection

```
Effective = Manifest ∩ User Config ∩ Policy

Manifest:    what the plugin developer declares as needed
User Config: what the installing user allows
Policy:      organization-enforced allow/deny lists (admin-controlled)
```

Dangerous permissions (`system.process.spawn`, `fs.exec`, `network.listen`) cannot be granted via `--yes` or config defaults -- they require explicit interactive user confirmation at install time.

---

## 6. Approval State Machine Comparison

### 6.1 Claude Code: Security Pipeline → Policy Rules → User Prompt

```
Bash command
  → Control char check (pre-processing)
  → Heredoc stripping
  → Quote extraction → CheckContext
  → Early validators (empty, incomplete, safe heredoc, git commit)
  → Main validators (misparsing first, then deferred non-misparsing)
  → PolicyEngine rule evaluation (priority-ordered, first match wins)
  → Default behavior (tool risk level)
  → User prompt (if ask)
```

**Decision cache**: results cached per-session (`session:tool_name`) and per-thread (`thread:tool_name`).

### 6.2 AgentHub: SecurityPipeline → PolicyEngine → ToolExecutor

```
ToolCall arrives
  → SecurityPipeline.Evaluate(command)
      → ControlCharRe? → DENY (SeverityBlock)
      → Misparsing? → mandatory ask (SeverityHigh)
      → Non-misparsing? → allowlist-checkable (SeverityLow/Medium)
  → PolicyEngine.Evaluate(toolCall, evalCtx)
      → bypassPermissions? → auto-allow
      → plan mode + write? → DENY
      → Rule match (allow) → auto-allow
      → Rule match (deny) → DENY
      → No match → default (ToolDescriptor.riskLevel)
  → ToolExecutor.runWithTimeout()
```

**Security violations as first-class errors**: Severity mapped directly to `AgentHubError.Severity` and `ErrorCode`. No separate error type for security concerns -- the UI treats a security block as an error with `Origin=AgentInternal, Severity=Block, Retryable=false`.

### 6.3 Key Differences

| Aspect | Claude Code | AgentHub (Target) |
|--------|-------------|-------------------|
| Pipeline runs on | Bash commands only | All tool calls (security for bash, policy for others) |
| Misparsing gate | Blocks in the pipeline itself | Returns SecurityViolation, PolicyEngine converts to decision |
| Decision type | ask/passthrough/allow | Accept/Decline with DecidedBy tracking |
| Cache granularity | session + thread | session + thread + (future: plugin-scoped) |
| Admin policy | Enterprise only (closed source) | Team + Enterprise (open architecture) |

---

## 7. Plugin/Extension Permission Models

### 7.1 OpenCode Plugin Hooks

Plugins interact with permissions via the `permission.ask` hook:

```ts
hook("permission.ask", (input: Permission, output: { status: string }) => {
  // input: { tool, session, details }
  // output.status = "allow" | "deny" | "ask"
})
```

This is the only permission hook. Plugins cannot declare their own permissions -- they operate at the agent's privilege level. This is suitable for a single-user desktop tool but insufficient for a multi-tenant hub.

### 7.2 AgentHub Plugin Permissions (Three-Tier)

**Install-time**: user sees declared permissions and explicitly approves each category.

**Runtime**: every permission-sensitive operation is checked against `manifest ∩ user_config ∩ policy`. Violations are logged with `[plugin:<name>]` prefix and surfaced in the Permissions Audit view.

**Dangerous permissions gate**: `system.process.spawn`, `fs.exec`, `network.listen` require explicit interactive confirmation -- not grantable via `--yes` or config defaults.

This is the only model in the comparison set that gives **plugins their own permission identity** separate from the agent's. Claude Code has no plugin concept. OpenCode's plugins inherit the agent's permissions. AgentHub's plugins are independent security principals.

### 7.3 Sandboxing Level by Plugin Type

| Slot Type | Sandbox | Rationale |
|-----------|---------|-----------|
| `tab` / `panel` / `toolbar` | iframe with `sandbox="allow-scripts"` | Prevents DOM access to main app; postMessage bridge for controlled API |
| `tool` | Worker thread (Node.js) or WASM (browser) | No fs/network by default; fs.* permissions gate access |
| `skill` | Prompt-only (no code execution) | Instructions injected as text; no executable surface |
| `theme` | CSS-only (parsed and sanitized) | No `url()` to external resources; no JS execution |
| Server sidecar | Process isolation + localhost-only network | `127.0.0.1` binding, minimal environment, two-phase SIGTERM→SIGKILL |

---

## 8. AgentHub Recommendation: Deny-by-Default + Tiered Authorization

### 8.1 Core Principle

**Nothing is allowed unless explicitly granted.** This applies at every boundary:

```
                ┌─────────────────────────────────────────┐
                │           AgentHub Deny-by-Default        │
                │                                           │
  External ─────┤  Sandbox Wall (OpenHands pattern)         │
  (network,     │    - explicit volume mounts              │
   host fs)     │    - explicit port exposure              │
                │    - explicit env var injection          │
                │                                           │
  Agent ────────┤  Policy Engine (Claude Code pattern)      │
  (tool calls)  │    - 9-source priority rules             │
                │    - 23-validator bash security pipeline  │
                │    - path-scoped file access              │
                │    - risk-level-based defaults            │
                │                                           │
  Plugin ───────┤  Three-Tier Intersection (Plugin pattern) │
  (extension)   │    - manifest declared permissions        │
                │    - user-approved gates                  │
                │    - organization policy                  │
                │    - dangerous permission explicit prompt │
                │                                           │
  User ─────────┤  Session Auth + RBAC                      │
  (identity)    │    - session API key                      │
                │    - team/org role binding                │
                │    - audit log per principal              │
                └─────────────────────────────────────────┘
```

### 8.2 Tiered Authorization Model

```
Tier 0: Sandbox Boundary (always deny cross-boundary)
        → Tool access outside workspace → DENY
        → Network access to non-exposed ports → DENY
        → Host environment variable access → DENY
        → No user override possible

Tier 1: Content Security Pipeline (misparsing = mandatory ask)
        → 23 bash validators (adopted from Claude Code)
        → Misparsing concerns: no allowlist override
        → SeverityBlock patterns: system-deny (no user prompt)
        → User must rephrase, not override

Tier 2: Policy Rules (allowlist-able, priority-ordered)
        → 9-source priority system
        → First match wins
        → Allow/Deny/Escalate decisions

Tier 3: Plugin Permissions (explicit grant, intersection)
        → Manifest ∩ User Config ∩ Policy
        → Dangerous permissions: interactive-only
        → Per-slot sandboxing (iframe/worker/process)

Tier 4: Session Auth (bearer token, time-bound)
        → 32-byte random session API key
        → Scoped to session lifetime
        → Revocable
```

### 8.3 Decision Flow

```
Tool call arrives at Runner
  │
  ├── Tier 0: Sandbox boundary check
  │     path outside workspace? → DENY (no override)
  │     target not in exposed ports? → DENY (no override)
  │
  ├── Tier 1: Content security pipeline (bash/powershell)
  │     23 validators → SeverityBlock? → DENY
  │                   → Misparsing? → MANDATORY_ASK
  │                   → Non-misparsing? → deferred to Tier 2
  │
  ├── Tier 2: Policy rule evaluation
  │     Priority-ordered rule match → Allow/Deny/Escalate
  │
  ├── Tier 3: Plugin permission gate (if plugin-initiated)
  │     manifest ∩ user_config ∩ policy → Allow/Deny
  │
  └── Tier 4: Default behavior
        Deny-by-default: return ASK_USER
```

### 8.4 Why Not Any Single Model

| If we adopted only... | We would lose... |
|----------------------|-----------------|
| Claude Code's model | No sandbox boundary (container-level isolation), no plugin permission identity, no deny-by-default at tool registration level |
| OpenCode's model | No content-level bash security pipeline, no 9-source admin-visible priority, no plugin isolation |
| OpenHands's model | No fine-grained tool/file/command permissions inside the sandbox, everything inside is implicitly trusted |
| Plugin Marketplace alone | No bash security for non-plugin tools, no session-level policy rules, no sandbox boundary |

### 8.5 What AgentHub Adds Beyond References

1. **Unified decision type** (`ApprovalDecision`) carrying `DecidedBy` tracking across all four tiers
2. **Security violations as first-class errors** in the unified `AgentHubError` taxonomy -- no separate security subsystem
3. **Plugin as independent security principal** -- plugins have their own permission identity, not inheriting the agent's
4. **Sandbox + Pipeline combination** -- spatial isolation AND behavioral inspection, not one or the other
5. **Admin-visible priority bands** -- Team and Enterprise policy visible in the same priority system as user preferences

---

## 9. Implementation Roadmap

### Phase 1: Foundation (P0)

- [x] `SecurityPipeline` with 23 validators (adopted from Claude Code, ported to Go)
- [x] `PolicyEngine` with 9-source priority and `ApprovalDecision` type
- [x] `AgentHubError` unified error taxonomy with `SecurityViolation` integration
- [ ] Decision cache: session-scoped + thread-scoped keys
- [ ] ToolDescriptor `RiskLevel` and `RequiresApproval` fields
- [ ] Default deny-by-default at ToolRegistry registration

### Phase 2: Plugin Permissions (P1)

- [ ] Manifest `permissions` field validation (5 categories x 20 sub-permissions)
- [ ] Install-time permission prompt UI
- [ ] Three-tier intersection enforcement at runtime
- [ ] Dangerous permission interactive-only gate
- [ ] Plugin audit log with `[plugin:<name>]` prefix

### Phase 3: Sandbox Boundary (P2)

- [ ] `WorkspaceService` ABC (adopted from OpenHands `SandboxService` pattern)
- [ ] `DockerWorkspaceService` implementation
- [ ] `WorktreeWorkspaceService` implementation (for lightweight course-assignment scenarios)
- [ ] Sandbox boundary enforcement in PolicyEngine Tier 0
- [ ] Session API Key generation and validation

### Phase 4: Admin & Audit (P2)

- [ ] Team/Enterprise policy priority bands in PolicyEngine
- [ ] Permission audit dashboard
- [ ] Security violation aggregation and alerting
- [ ] Policy rule CRUD API with admin RBAC

---

## A. Reference Cross-Index

| Concept | Claude Code | OpenCode | OpenHands | AgentHub Plugin | This Document |
|---------|-------------|----------|-----------|-----------------|---------------|
| Default stance | Allow with pipeline gate | Agent-dependent | Container deny-by-default | Explicit grant | **Deny-by-default all tiers** |
| Bash security | 23 validators, misparsing gate | None | None (container wall) | N/A | **Adopted: 23 validators** |
| File-GLOB permissions | PathPattern in policy rules | `read/edit/write` + `external_directory` | Volume mounts | `fs.{read,write,delete}` | **All three: path + op + mount** |
| Priority system | 9-source, first-match-wins | Hierarchical merge (last wins) | N/A | Intersection (all must pass) | **Adopted: 9-source priority** |
| Plugin identity | N/A (no plugins) | Inherits agent permissions | N/A | Independent security principal | **Adopted: independent** |
| Decision caching | session + thread | In-memory per session | session API key | N/A | **Adopted: session + thread** |
| Sandbox isolation | None (same process) | TUI/server separation | Docker cgroup/namespace | iframe/worker/process | **Tier 0 boundary** |
| Security as errors | Separate subsystem | Hook-based | N/A | Manifest validation | **Unified AgentHubError** |

---

*Analysis complete. 2026-05-21.*
