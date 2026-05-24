# Claude Code SDK — Security Pipeline Adoption Map

> **Reference**: Claude Code (`reference/claude-code-source/claude-code-main/src/`)
> **Target**: AgentHub edge-server (`edge-server/internal/`)
> **Date**: 2026-05-24
> **Previous**: `01-overview.md`, `02-tool-security.md`, `03-context-compaction.md`

---

## Executive Summary

Claude Code runs a **23-check Bash security pipeline** (`bashSecurity.ts`) plus a **multi-layer permission engine** (`bashPermissions.ts`) that validates every Bash command before execution. AgentHub currently has a single `SecurityHook` with a monolithic regex and a `DefaultPermissionHandler` that **auto-approves all tool use** — a critical security gap. This map identifies every adoption opportunity with concrete Go implementation paths referencing actual AgentHub files.

---

## 1. Permission Decision Pipeline: 5-Layer Architecture

### Finding: Claude Code uses 5-layer permission check; AgentHub auto-approves everything
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:1663-2557` — `bashToolHasPermission()` pipeline:
1. AST-based security parse (tree-sitter)  
2. Sandbox auto-allow (respects deny/ask rules)  
3. Exact match rule check → deny/ask/allow  
4. Classifier (Haiku): parallel deny+ask, then allow single  
5. Prefix/wildcard rule check per subcommand  
6. Path constraints validation (32 commands)  
7. Compound command gates (cd, cd+git, cd+write)  
8. Legacy safety check fallback (bashCommandIsSafeAsync)

**AgentHub**: `edge-server/internal/adapters/control_protocol.go:70-144` — `DefaultPermissionHandler` auto-approves every `can_use_tool` by writing `{"behavior":"allow"}` unconditionally. There is no deny, no rules engine, no classification, no path validation.

**Change**: Replace `DefaultPermissionHandler` with a `PermissionEngine` that:
1. Integrates `SecurityHook` as the deny-gate (blocked patterns = `behavior: deny`)
2. Introduces a `PermissionRule` store (exact/prefix/wildcard) checked before approval
3. Routes `ask` results to an event channel so Desktop can present user approval UI
4. Only auto-allows when a tool+input passes all deny gates AND has an explicit allow rule

**Priority**: **P0** | **Effort**: 8d

---

## 2. The 23-Check Bash Security Pipeline

### Finding: Claude Code runs 23 validators; AgentHub has 7 patterns in one regex
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashSecurity.ts:77-101` — 23 numeric check IDs:
1. INCOMPLETE_COMMANDS — fragments that start with `-`/`&&`/`||`
2. JQ_SYSTEM_FUNCTION — jq command execution functions
3. JQ_FILE_ARGUMENTS — jq file arguments
4. OBFUSCATED_FLAGS — flags hidden inside strings/backtick
5. SHELL_METACHARACTERS — `;`, `|`, `&` in unquoted context
6. DANGEROUS_VARIABLES — `$()`, `${}`, `$[...]` expansion
7. NEWLINES — newline-based command injection
8. COMMAND_SUBSTITUTION — `$()`, backticks, `>()`, `<()`, `=()`
9. INPUT_REDIRECTION — `<` from sensitive paths
10. OUTPUT_REDIRECTION — `>` to block devices / sensitive paths
11. IFS_INJECTION — IFS manipulation via env vars
12. GIT_COMMIT_SUBSTITUTION — git commit injection
13. PROC_ENVIRON_ACCESS — `/proc/*/environ` access
14. MALFORMED_TOKEN_INJECTION — malformed quotes
15. BACKSLASH_ESCAPED_WHITESPACE — `\n`, `\t` in cmd
16. BRACE_EXPANSION — `{a,b}` expansion leading to injection
17. CONTROL_CHARACTERS — non-printable/unusual chars
18. UNICODE_WHITESPACE — Unicode space bypasses
19. MID_WORD_HASH — `#` inside unquoted word (comment injection)
20. ZSH_DANGEROUS_COMMANDS — zmodload, emulate, sysopen, zpty, etc.
21. BACKSLASH_ESCAPED_OPERATORS — `\;`, `\&`, `\|` bypasses
22. COMMENT_QUOTE_DESYNC — `'#` pattern mismatches
23. QUOTED_NEWLINE — newline inside quoted strings

Each validator gets its own `ValidationContext` (bashSecurity.ts:103-117) extracting `originalCommand`, `unquotedContent`, `fullyUnquotedContent`, and optional `treeSitter` analysis.

**AgentHub**: `edge-server/internal/adapters/security_hooks.go:147-182` — `dangerousPatternsRE` is a single `regexp.MustCompile` covering only 7 categories (rm -rf, curl|bash, sudo, chmod 777, block device write, cp/mv/tee to dev). There is no shell-unquoting, no per-validator context, no ASCII/Unicode awareness.

**Change**: Refactor `security_hooks.go` to implement the 23-check pipeline as individual validator functions, each receiving a `ShellContext` (with `unquotedContent`, `fullyUnquotedContent`, `baseCommand` fields). Priority order:
1. Add `ShellContext` struct + `extractQuoteContext()` (P0, 2d)
2. Implement validators 1-14 (critical shell injection) (P0, 3d)
3. Implement validators 15-23 (edge-case bypasses) (P1, 2d)
4. Wire validators into `SecurityHook.PreToolUse` with early-exit on first block (P0, 1d)

**Priority**: **P0** (checks 1-14), **P1** (checks 15-23) | **Effort**: 8d total

---

## 3. Path Validation for 32 Path-Aware Commands

### Finding: Claude Code validates paths for 32 commands; AgentHub has no path-level validation
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/pathValidation.ts:27-66` — `PathCommand` type defines 32 commands from `cd` to `md5sum`. Each has a dedicated `PATH_EXTRACTORS` function (line 190-508) that correctly parses flags vs. positional path arguments.

Key security features:
- `filterOutFlags()` (line 126-139): respects `--` POSIX end-of-options delimiter
- `createPathChecker()` (line 703-784): validates paths against `allowedWorkingDirectories`
- `checkDangerousRemovalPaths()` (line 70-108): catches `rm -rf /` and similar
- `checkPathConstraints()` (line 1013-1109): validates output redirections + AST-derived redirects
- cd+write compound block (line 645-655): prevents `cd .claude/ && mv test.txt settings.json`

**AgentHub**: No path validation at all. `security_hooks.go` only checks command patterns, not where files are being read/written. `env_sanitizer.go` filters environment variables but has no concept of allowed working directories or per-command path extraction.

**Change**: Create `edge-server/internal/security/path_validation.go` with:
1. `PathCommand` type enumerating 20+ common commands
2. `ExtractPaths(command string, cmdType PathCommand) []string` — using flag-aware parsing with `--` delimiter handling
3. `ValidatePaths(paths []string, cwd string, allowedDirs []string) PermissionResult`
4. Wire into `SecurityHook.PreToolUse` for Bash tools (when toolName == "Bash")

**Priority**: **P0** | **Effort**: 5d

---

## 4. Permission Rule Engine (Exact / Prefix / Wildcard)

### Finding: Claude Code has a 3-level rule matching engine; AgentHub has none
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:869-935` — `filterRulesByContentsMatchingInput()`:
- **Exact match**: `Bash(git commit -m "fix typo")` matches only that exact command
- **Prefix match**: `Bash(git commit:*)` matches any `git commit ...` with word-boundary check
- **Wildcard match**: `Bash(git *)` matches with glob pattern (only on subcommands in prefix mode)
- **Deny/Ask/Allow** rules by source: `userSettings`, `projectSettings`, `localSettings`, `flagSettings`, `policySettings`, `cliArg`, `command`, `session`

Key security features:
- `stripSafeWrappers()` (line 524-615): strips `timeout`, `nice`, `nohup`, `time`, `stdbuf`, env vars so `timeout 10 rm -rf /` still matches `Bash(rm:*)` deny
- `stripAllLeadingEnvVars()` (line 733-776): for deny rules, strips ANY env var prefix so `FOO=bar rm /evil` still matches deny
- Compound command guard (line 889-892): prefix rules must NOT match `cd / && python3 evil.py`

**AgentHub**: `edge-server/internal/adapters/security_hooks.go:36-42` — `PreToolUse` only checks `RiskBlocked` via regex. No rule store, no persistent deny/allow lists, no prefix/wildcard matching.

**Change**: Create `edge-server/internal/security/permission_engine.go`:
1. `PermissionRule` struct: `{ToolName, RuleContent, Behavior, Source}`
2. `PermissionEngine` struct holding deny/ask/allow rules per tool
3. `CheckPermission(toolName string, input map[string]any, context PermissionContext) PermissionDecision`
4. `stripSafeWrappers(command string) string` — Go port of the TS wrapper stripping
5. Integrate into a new `PermissionAwareControlHandler` that calls the engine before writing response to stdin

**Priority**: **P0** | **Effort**: 6d

---

## 5. DefaultPermissionHandler: The Critical Auto-Approval Gap

### Finding: DefaultPermissionHandler auto-approves everything — bypassPermissions equivalent
**Reference**: `reference/claude-code-source/claude-code-main/src/bridge/bridgePermissionCallbacks.ts:1-44` — Bridge permission uses `sendRequest`/`sendResponse` with allow/deny behavior. The `control_request` protocol exchanges structured permission requests between host and CLI.

**AgentHub**: `edge-server/internal/adapters/control_protocol.go:70-144` — `DefaultPermissionHandler.handleCanUseTool()` always writes `{"behavior":"allow"}` regardless of tool name or input. The comment on line 70 explicitly says "Replace with a proper approval engine for production use." Even the `NewEventEmittingPermissionHandler` wrapper only adds event observability — it still auto-approves.

The current `SecurityHook.PreToolUse` in `security_hooks.go:36` does return `block=true` for `RiskBlocked` patterns, but this hook is applied at the **adapter parse level**, not at the **control protocol level**. The parser-based `SecurityHook` blocks the tool call in the NDJSON stream parser, while `DefaultPermissionHandler` responds to `can_use_tool` control requests — these are two different code paths. In the current implementation, `DefaultPermissionHandler` handles the `control_request` protocol exchange (stdin->stdout bidirectional), and it auto-approves regardless of what `SecurityHook` would have said about the input.

**Change**:
1. Inject `SecurityHook` (or newer `PermissionEngine`) into a new `SecuredPermissionHandler` that replaces `DefaultPermissionHandler`
2. `SecuredPermissionHandler.handleCanUseTool()` must:
   a. Run PreToolUse checks on the toolName+input → block if dangerous
   b. Check permission rules (deny → deny, ask → emit event for Desktop, allow → auto-allow)
   c. Only write `"behavior":"allow"` for explicitly allowed or low-risk tools
3. Delete or deprecate `DefaultPermissionHandler`

**Priority**: **P0** | **Effort**: 3d

---

## 6. Shell Unquoting / AST-Based Parsing Gap

### Finding: Claude Code unquotes commands before validation; AgentHub checks raw strings
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashSecurity.ts:128-174` — `extractQuotedContent()` produces three views:
- `withDoubleQuotes`: content visible after single-quote removal
- `fullyUnquoted`: unquoted content only (no single or double quotes)
- `unquotedKeepQuoteChars`: strips content but keeps delimiter chars (for mid-word hash detection)

Each validator gets `ValidationContext` with all three views. Check 19 (MID_WORD_HASH) specifically relies on `unquotedKeepQuoteChars` to detect `'x'#` patterns where quote stripping hides `#` adjacency.

**AgentHub**: `security_hooks.go:123-128` — `containsDangerousPattern()` matches regex directly against the raw command string. No shell-unquoting. An attacker could hide blocked patterns inside single quotes: `rm -rf '/'etc/passwd` — the unquote would reveal `rm -rf /etc/passwd` but raw string check fails to see the `/etc/passwd` pattern.

**Change**: Add `extractShellQuotes(command string) ShellContext` to `security_hooks.go` before the dangerous pattern check. Use `ShellContext.FullyUnquotedContent` as the primary match target for `dangerousPatternsRE`. This is a surgical fix — the regex stays, but the target changes from raw to unquoted.

**Priority**: **P0** | **Effort**: 1d

---

## 7. Compound Command Security Gates

### Finding: Claude Code has cd, cd+git, cd+write gates; AgentHub has none
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:2182-2225`:
- `cdCommands.length > 1` → ask (direction-confusion attack)
- `compoundCommandHasCd && hasGitCommand` → ask (bare repo RCE attack: `cd /malicious && git status` triggers `core.fsmonitor` hook)
- `compoundCommandHasCd && operationType !== 'read'` → ask (path-resolution bypass: `cd .claude/ && mv test.txt settings.json`)

Also `pathValidation.ts:645-655`: compound cd+write blocks at path constraint level.

**AgentHub**: No compound command awareness. `security_hooks.go` treats every Bash input as a flat string. `process_executor.go` runs whatever command the agent generates via `exec.CommandContext` with zero inspection.

**Change**: Add to `edge-server/internal/security/path_validation.go`:
1. `splitCompoundCommand(cmd string) []string` — split on `&&`, `||`, `;`, `|`
2. `detectCdGates(subcommands []string) (hasCd bool, hasGit bool, hasWrite bool)`
3. In `SecurityHook.PreToolUse`: if `hasCd && (hasGit || hasWrite)`, elevate to `RiskBlocked` or at minimum `RiskHigh`
4. In path validation: when `compoundCommandHasCd` && write operation, return `ask` with reason

**Priority**: **P0** (cd+git, cd+write) | **Effort**: 3d

---

## 8. Sandbox Integration Point

### Finding: Claude Code integrates sandbox auto-allow; AgentHub sandbox concept absent
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:1270-1359` — `checkSandboxAutoAllow()`:
- When sandbox is enabled (`SandboxManager.isSandboxingEnabled()`), bash commands that survive deny/ask rule checks are auto-allowed
- The function still checks each subcommand of compound commands against deny rules
- Returns `"allow"` with reason `"Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)"`

**AgentHub**: No sandbox concept at all. `process_executor.go:190` runs `exec.CommandContext(ctx, cmdPath, args...)` with only a workdir — no OS-level isolation.

**Change**: Create `edge-server/internal/security/sandbox_integration.go`:
1. `SandboxContext` struct tracking whether sandbox is enabled for this run
2. When sandbox is enabled, `PermissionEngine.CheckPermission()` skips `ask` for commands that pass deny+path checks (auto-allow under sandbox)
3. This is the bridge between "Subagent B" workspace sandbox and the permission pipeline

**Priority**: **P1** | **Effort**: 2d

---

## 9. Wrapper Command Stripping

### Finding: Claude Code strips safe wrappers before rule matching; AgentHub does not
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:524-615` — `stripSafeWrappers()`:
- Phase 1: Strip safe env vars (`GOOS=linux`, `NODE_ENV=production`, etc.) — with allowlist
- Phase 2: Strip wrapper commands — `timeout`, `time`, `nice`, `nohup`, `stdbuf`
- Uses `[ \t]+` (horizontal whitespace only) for security — `\s` matches `\n`/`\r` which are command separators
- Enforce `--` end-of-options handling

`bashPermissions.ts:378-497` — `SAFE_ENV_VARS` set (50+ vars) and `ANT_ONLY_SAFE_ENV_VARS` set (internal only, with `DOCKER_HOST` explicitly gated)

**AgentHub**: No wrapper stripping. `security_hooks.go:147-182` regex checks `rm\s+...` but doesn't handle `timeout 10 rm -rf /`.

**Change**: Port `stripSafeWrappers()` to Go in `edge-server/internal/security/permission_engine.go`. Use the same two-phase approach. Reference AgentHub's existing env var knowledge from `env_sanitizer.go` for the safe env var list.

**Priority**: **P1** | **Effort**: 2d

---

## 10. Event-Emitting Permission Architecture

### Finding: Claude Code emits permission events for host-side UI; AgentHub partially does
**Reference**: `reference/claude-code-source/claude-code-main/src/bridge/bridgePermissionCallbacks.ts:10-27` — Bridge emits `sendRequest(requestId, toolName, input...)` and receives `sendResponse(requestId, {behavior, updatedInput})`. Permission UI is external to the CLI.

**AgentHub**: `edge-server/internal/adapters/control_protocol.go:98-104` — `DefaultPermissionHandler` already emits `run.agent.permission_requested` events when `emitter != nil`. But the response (`"allow"`) is hardcoded before Desktop has a chance to respond. The event bus architecture is already in place — what is missing is **blocking on Desktop response** instead of auto-approving.

`edge-server/internal/adapters/adapter.go:97-100` — `BusEventPermissionRequested` and `BusEventPermissionDecided` event types already defined.

**Change**: In the new `SecuredPermissionHandler`:
1. For `RiskHigh` tools: emit `permission_requested`, then block on a channel/semaphore waiting for Desktop to write back `permission_decided`
2. Implement a timeout (e.g., 30s) after which the run is paused/cancelled if no user decision is received
3. This turns the existing event infrastructure from observability-only into actually gating execution

**Priority**: **P1** | **Effort**: 3d

---

## 11. AST-Based Security Parsing

### Finding: Claude Code uses tree-sitter for structural validation; AgentHub uses regex only
**Reference**: `reference/claude-code-source/claude-code-main/src/tools/BashTool/bashPermissions.ts:1686-1738` — `parseCommandRaw()` calls tree-sitter WASM module to produce AST. The AST feeds:
- `parseForSecurityFromAst()` — determines if command is `simple` (safe to analyze) or `too-complex` (must ask)
- `checkSemantics()` — validates zsh builtins, eval, source, etc. at the semantic level
- Each `SimpleCommand` has resolved `argv`, `envVars`, `redirects`, `text`

**AgentHub**: Regex-only. No structural understanding of shell syntax.

**Change**: This is a longer-term investment. Short-term (P1): integrate a Go shell parser like `mvdan.cc/sh/v3/syntax`. Long-term (P2): evaluate tree-sitter Go bindings. Add to `edge-server/internal/security/shell_parser.go`.

**Priority**: **P1** | **Effort**: 5d

---

## 12. Adoption Priority Roadmap

| # | Finding | Priority | Effort | Dependencies |
|---|---------|----------|--------|--------------|
| 5 | Fix DefaultPermissionHandler auto-approval | **P0** | 3d | None |
| 6 | Shell unquoting | **P0** | 1d | None |
| 3 | Path validation for 32 commands | **P0** | 5d | None |
| 4 | Permission rule engine | **P0** | 6d | #5 |
| 1 | 5-layer permission pipeline | **P0** | 8d | #4, #5 |
| 2 | 23-check validation (1-14) | **P0** | 5d | #6 |
| 7 | Compound command gates | **P0** | 3d | #3 |
| 9 | Wrapper command stripping | **P1** | 2d | #4 |
| 8 | Sandbox integration point | **P1** | 2d | #1, Subagent B |
| 10 | Blocking permission UI events | **P1** | 3d | #5 |
| 2b | 23-check validation (15-23) | **P1** | 2d | #2 |
| 11 | AST-based parsing | **P1** | 5d | #6 |

**Total P0 effort**: 31d. **Total P1 effort**: 14d. **Grand total**: 45d.

---

## Key AgentHub Files to Modify

| File | Current Role | Planned Change |
|------|-------------|----------------|
| `edge-server/internal/adapters/control_protocol.go` | Auto-approve permissions (P0 gap) | Replace `DefaultPermissionHandler` with `SecuredPermissionHandler` |
| `edge-server/internal/adapters/security_hooks.go` | 7-pattern regex validator | Add 23-check pipeline, shell unquoting, compound gates |
| `edge-server/internal/adapters/hooks.go` | Hook interface + chain | Add `RiskAsk` level for permission escalation |
| `edge-server/internal/security/origin.go` | Origin validation (unrelated) | Add `path_validation.go`, `permission_engine.go`, `shell_parser.go` |
| `edge-server/internal/adapters/adapter.go` | Event type definitions | Already has `PermissionRequested`/`PermissionDecided` — wire them |
| `edge-server/internal/lifecycle/env_sanitizer.go` | Env whitelisting | Reuse safe env var list for wrapper stripping |
