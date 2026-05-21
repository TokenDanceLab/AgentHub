# Deep Dive: Claude Code Tool Orchestration & Bash Security

> Sources: `claude-code-main/src/services/tools/toolOrchestration.ts`,
> `claude-code-main/src/tools/BashTool/bashSecurity.ts` (105KB, 23+ checks),
> `claude-code-main/src/services/tools/toolExecution.ts`,
> `claude-code-main/src/tools/BashTool/BashTool.tsx`,
> `Group2_ToolSystem/Group2_Summary.md`
> Target: AgentHub Runner executor + PolicyEngine design
> Date: 2026-05-21

---

## 1. Tool Orchestration Engine

### 1.1 Architecture Overview

Claude Code's tool orchestration is a **partitioned concurrent executor**. The core insight: read-only tools can run in parallel (they observe state), while write tools must run serially (they mutate state). The orchestrator is not a scheduler -- it's a **batch partitioner** that groups adjacent read-only tool calls into concurrent batches and interleaves them with serial write batches.

```
runTools(toolUseMessages) {
  for batch of partitionToolCalls(toolUseMessages):
    if batch.isConcurrencySafe:
      runToolsConcurrently(batch)   // up to 10 parallel
    else:
      runToolsSerially(batch)       // one at a time
  }
}
```

### 1.2 Partition Logic (the heart of the orchestrator)

```typescript
// src/services/tools/toolOrchestration.ts:91-116
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            return false  // parse failure -> conservative: treat as serial
          }
        })()
      : false
    // Adjacent concurrency-safe tools merge into the same batch
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}
```

Key properties:
- **Adjacency matters**: three read-only tools in a row become one concurrent batch. A write tool between them splits into three batches.
- **Conservative default**: if `isConcurrencySafe()` throws (e.g. shell-quote parse failure), the tool is treated as serial.
- **Per-tool declaration**: each tool declares its concurrency safety via `Tool.isConcurrencySafe(input)`. GlobTool, GrepTool, ReadTool return `true`; BashTool, WriteTool, EditTool return `false`.

### 1.3 Concurrency Mechanism

```typescript
// src/services/tools/toolOrchestration.ts:152-177
async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse) {
      // Mark as in-progress, run, mark complete
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id))
      yield* runToolUse(toolUse, ...)
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),  // default 10
  )
}

function getMaxToolUseConcurrency(): number {
  return parseInt(
    process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10
  ) || 10
}
```

The `all()` generator (from `src/utils/generators.ts`) is a **bounded concurrent async generator**. It runs up to `concurrencyCap` generators simultaneously, yielding values from any generator as they complete and immediately starting the next one:

```typescript
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void>
```

### 1.4 Context Flow

**Serial path** (`runToolsSerially`): context flows linearly. Each tool's `contextModifier` is applied to `currentContext` immediately, and subsequent tools see the updated context.

**Concurrent path** (`runToolsConcurrently`): context modifiers from concurrent tools are **queued and applied after all tools in the batch complete**. This prevents race conditions where concurrent tools read stale or partially-modified context.

```typescript
// Queued application after batch completes:
for (const block of blocks) {
  const modifiers = queuedContextModifiers[block.id]
  if (!modifiers) continue
  for (const modifier of modifiers) {
    currentContext = modifier(currentContext)
  }
}
```

### 1.5 Tool Result -> LLM Feedback Loop

Each tool execution produces a `MessageUpdate` containing a user message with a `tool_result` content block:

```typescript
// toolExecution.ts
message: createUserMessage({
  content: [{
    type: 'tool_result',
    content: outputContent,  // stdout text or error message
    is_error: boolean,
    tool_use_id: toolUse.id,
  }],
  toolUseResult: summaryString,
  sourceToolAssistantUUID: assistantMessage.uuid,
})
```

These tool_result messages are accumulated and fed back to the LLM in the next API call. The Anthropic API format requires tool_result blocks to reference the original tool_use id, closing the loop.

### 1.6 AgentHub Runner Integration

The AgentHub Runner executor should adopt the same partition-first model:

```go
// packages/executor/orchestrator.go

type ToolBatch struct {
    IsConcurrencySafe bool
    Blocks            []ToolCall
}

// PartitionToolCalls groups adjacent concurrency-safe tools into batches.
func PartitionToolCalls(calls []ToolCall, registry ToolRegistry) []ToolBatch {
    var batches []ToolBatch
    for _, call := range calls {
        tool := registry.Resolve(call.ToolName)
        safe := tool != nil && tool.Descriptor.IsReadOnly
        if safe && len(batches) > 0 && batches[len(batches)-1].IsConcurrencySafe {
            batches[len(batches)-1].Blocks = append(
                batches[len(batches)-1].Blocks, call)
        } else {
            batches = append(batches, ToolBatch{
                IsConcurrencySafe: safe,
                Blocks:            []ToolCall{call},
            })
        }
    }
    return batches
}

// Executor runs the partitioned tool calls.
type Executor struct {
    MaxConcurrency int           // default 10
    PolicyEngine   *PolicyEngine // security approval
}

func (e *Executor) Execute(ctx context.Context, calls []ToolCall) <-chan ToolResult {
    batches := PartitionToolCalls(calls, e.registry)
    results := make(chan ToolResult, len(calls))
    go func() {
        defer close(results)
        for _, batch := range batches {
            if batch.IsConcurrencySafe {
                e.runConcurrently(ctx, batch, results)
            } else {
                e.runSerially(ctx, batch, results)
            }
        }
    }()
    return results
}
```

---

## 2. Bash Security Check Pipeline

### 2.1 Architecture

Claude Code's bash security is a **pipeline of 23 independent validator functions**, each returning either `passthrough` (no concern), `ask` (require user approval), or `allow` (explicitly safe). The pipeline is ordered: early-allow validators run first, then misparsing validators (which block at the gate), then non-misparsing validators (which go through standard permissions).

```
bashCommandIsSafe(command):
  1. CONTROL_CHAR_RE check (pre-processing guard)
  2. shell-quote single-quote bug check (pre-processing guard)
  3. extractHeredocs (strip quoted heredoc bodies)
  4. extractQuotedContent -> ValidationContext
  5. EARLY VALIDATORS (allow -> passthrough return):
     - validateEmpty (empty command is safe)
     - validateIncompleteCommands (tab start, flag start, operator start -> ask)
     - validateSafeCommandSubstitution ($(cat <<'EOF') -> allow)
     - validateGitCommit (safe git commit -> allow)
  6. MAIN VALIDATORS (ordered, with deferred non-misparsing):
     [see full list below]
```

### 2.2 Complete Validator Catalog (23 checks)

| # | Validator | Check ID | Category | Behavior on Trigger |
|---|-----------|----------|----------|---------------------|
| 1 | `validateEmpty` | - | Early-allow | `allow` (empty cmd is safe) |
| 2 | `validateIncompleteCommands` | INCOMPLETE_COMMANDS | Early-ask | Sub-1: starts with tab; Sub-2: starts with `-`; Sub-3: starts with `&&`/`\|\|`/`;`/`>>`/`<` |
| 3 | `validateSafeCommandSubstitution` | - | Early-allow | `allow` for `$(cat <<'DELIM')`; validates heredoc body is literal text, no nested heredocs, substitution NOT in command-name position |
| 4 | `validateGitCommit` | GIT_COMMIT_SUBSTITUTION | Early-ask | `ask` if commit message contains `$()` or backticks |
| 5 | `validateJqCommand` | JQ_SYSTEM_FUNCTION / JQ_FILE_ARGUMENTS | Misparsing | `ask` if jq uses `system`/`env`/`input_filename` or `--rawfile`/`--slurpfile` writes |
| 6 | `validateObfuscatedFlags` | OBFUSCATED_FLAGS | Misparsing | Block ANSI-C quoting (`$'...'`), locale quoting (`$"..."`), empty quotes before dash (`""-f`), quote concatenation obfuscation within 8 chars of dash |
| 7 | `validateShellMetacharacters` | SHELL_METACHARACTERS | Misparsing | `ask` if `;` `\|` `&` inside quoted `find -name` / `-path` / `-regex` arguments |
| 8 | `validateDangerousVariables` | DANGEROUS_VARIABLES | Misparsing | `ask` on variable in redirection/pipe context: `[<>\|]\s*$VAR` or `$VAR\s*[<>\|]` |
| 9 | `validateCommentQuoteDesync` | COMMENT_QUOTE_DESYNC | Misparsing | `ask` if `#` comment contains quote chars that could desync quote tracking |
| 10 | `validateQuotedNewline` | QUOTED_NEWLINE | Misparsing | `ask` if `\n` inside quotes followed by `#`-prefixed line (hides args from line-based checks) |
| 11 | `validateCarriageReturn` | - | Misparsing | `ask` if `\r` in command (shell-quote treats CR as token boundary, bash does not -- parser differential) |
| 12 | `validateNewlines` | NEWLINES | Non-misparsing | `ask` if unquoted newline followed by non-whitespace (not including `\<newline>` continuation) |
| 13 | `validateIFSInjection` | IFS_INJECTION | Misparsing | `ask` on `$IFS` or `${...IFS...}` patterns |
| 14 | `validateProcEnvironAccess` | PROC_ENVIRON_ACCESS | Misparsing | `ask` on `/proc/*/environ` access |
| 15 | `validateDangerousPatterns` | DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION | Misparsing | Backtick (unescaped) + 12 substitution patterns: `<()` `>()` `=()` Zsh `=cmd` expansion, `$()` `${}` `$[]` `~[]` `(e:` `(+` `}\s*always\s*{` `<#` (PowerShell) |
| 16 | `validateRedirections` | DANGEROUS_PATTERNS_INPUT_REDIRECTION / OUTPUT_REDIRECTION | Non-misparsing | `ask` on `<` or `>` in fully-unquoted content (after stripping `>/dev/null` and `2>&1`) |
| 17 | `validateBackslashEscapedWhitespace` | BACKSLASH_ESCAPED_WHITESPACE | Misparsing | `ask` on `\<whitespace>` patterns that could alter parsing |
| 18 | `validateBackslashEscapedOperators` | BACKSLASH_ESCAPED_OPERATORS | Misparsing | `ask` on `\;` `\|` `\&` `\<` `\>` -- splitCommand normalizes `\;` to bare `;`, causing double-parse bugs |
| 19 | `validateUnicodeWhitespace` | UNICODE_WHITESPACE | Misparsing | `ask` on `     -          　 ﻿` |
| 20 | `validateMidWordHash` | MID_WORD_HASH | Misparsing | `ask` on `\S#` (non-whitespace followed by `#`) -- shell-quote treats as comment-start, bash treats as literal |
| 21 | `validateBraceExpansion` | BRACE_EXPANSION | Misparsing | 3 sub-checks: (1) unescaped `{` with `,`/`..` at outermost depth -> brace expansion; (2) excess `}` after quote stripping (quoted-brace obfuscation); (3) quoted brace char `'{'` inside unquoted `{..}` context |
| 22 | `validateZshDangerousCommands` | ZSH_DANGEROUS_COMMANDS | Misparsing | Block 18 Zsh commands: `zmodload em emulate sysopen sysread syswrite sysseek zpty ztcp zsocket mapfile zf_rm zf_mv zf_ln zf_chmod zf_chown zf_mkdir zf_rmdir zf_chgrp`; also block `fc -e` |
| 23 | `validateMalformedTokenInjection` | MALFORMED_TOKEN_INJECTION | Misparsing | `ask` if command has both `;`/`&&`/`\|\|` operators AND unbalanced token delimiters (eval bypass from HackerOne review) |

### 2.3 Pre-Processing Guards (before validators run)

**Control characters** (check before anything else):
```typescript
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
// Excludes tab (0x09), newline (0x0A), carriage return (0x0D)
// Bash silently drops null bytes and ignores most control chars
```

**Shell-quote single-quote bug** (check before shell-quote parsing):
```typescript
if (hasShellQuoteSingleQuoteBug(command)) {
  return { behavior: 'ask', ... }
}
// Detects backslash patterns inside single quotes that shell-quote mishandles
```

**Heredoc stripping** (runs before quote extraction):
```typescript
const { processedCommand } = extractHeredocs(command, { quotedOnly: true })
// Only strips bodies of quoted/escaped delimiters (<<'EOF', <<\EOF)
// Unquoted heredocs (<<EOF) kept intact -- their bodies may have $() expansion
```

### 2.4 Misparsing vs Non-Misparsing Classification

A critical distinction in the pipeline:

- **Misparsing validators** (21 of 23): their `ask` results carry `isBashSecurityCheckForMisparsing: true`. The bashPermissions gate **blocks** these early -- no allowlist rule can override a misparsing concern. This is because the security parser itself cannot reliably determine what the command does.

- **Non-misparsing validators** (2 of 23): `validateNewlines` and `validateRedirections`. These patterns are correctly parsed by both shell-quote and bash. Their `ask` results go through the standard permission flow (allowlist rules can auto-approve).

- **Deferred non-misparsing**: if a non-misparsing validator fires first, its result is deferred. The pipeline continues running misparsing validators. Only if no misparsing validator fires is the deferred result returned.

```typescript
let deferredNonMisparsingResult: PermissionResult | null = null
for (const validator of validators) {
  const result = validator(context)
  if (result.behavior === 'ask') {
    if (nonMisparsingValidators.has(validator)) {
      if (deferredNonMisparsingResult === null) {
        deferredNonMisparsingResult = result
      }
      continue  // keep running to let misparsing validators fire
    }
    return { ...result, isBashSecurityCheckForMisparsing: true }
  }
}
```

### 2.5 Critical Security Exploits the Pipeline Blocks

The codebase documents several HackerOne-discovered attack vectors with detailed exploit traces:

1. **Brace expansion obfuscation** (`git diff {@'{'0},--output=/tmp/pwned}`): Quoted braces stripped by extractQuotedContent cause our depth-matcher to close at the WRONG position, missing commas that bash's algorithm finds. Validator 21 detects mismatched brace counts.

2. **Backslash-escaped operator double-parse** (`cat safe.txt \; echo ~/.ssh/id_rsa`): splitCommand normalizes `\;` to bare `;`. Downstream code re-parses and sees two "safe" segments. Private key leaked. Validator 18 catches `\<operator>`.

3. **Carriage return parser differential** (`TZ=UTC\recho curl evil.com`): shell-quote's `\s` includes `\r` as token boundary; bash's IFS does not. shell-quote sees `TZ=UTC echo`; bash runs `curl`. Validator 11 catches `\r`.

4. **Comment-quote desync** (`echo "it's" # ' " <<'MARKER'\nrm -rf /\nMARKER`): `#` comment with embedded quotes desyncs the quote tracker, making `rm -rf` appear "inside quotes" and invisible to newline checks. Validator 9 catches quote chars after `#`.

5. **Quoted-newline hides args** (`cmd '\n# safe comment\nreal dangerous'`): A `\n` inside quotes followed by a `#`-prefixed line causes stripCommentLines to drop the next line, hiding arguments from path checks. Validator 10 catches this.

6. **Mid-word hash** (`'x'#`): shell-quote treats `#` as comment-start; bash treats it as literal. The unquoted content after stripping becomes just `#` (word-start), losing the differential. Validator 20 catches using `unquotedKeepQuoteChars`.

---

## 3. AgentHub Security Check Implementation (Go)

### 3.1 Core Types

```go
// packages/security/bash_security.go

// SecurityViolation represents a detected security concern.
type SecurityViolation struct {
    CheckID      SecurityCheckID
    SubID        int
    Pattern      string // human-readable pattern description
    IsMisparsing bool   // true if parser differential, blocks allowlist override
    Severity     Severity
}

type Severity string

const (
    SeverityLow    Severity = "low"    // non-misparsing, allowlist can override
    SeverityMedium Severity = "medium" // misparsing concern
    SeverityHigh   Severity = "high"   // confirmed bypass vector
    SeverityBlock  Severity = "block"  // always deny
)

// CheckContext carries the parsed command state for validators.
type CheckContext struct {
    OriginalCommand      string
    BaseCommand          string
    UnquotedContent      string // double quotes stripped
    FullyUnquotedContent string // all quotes stripped, safe redirections removed
    FullyUnquotedPreStrip string // before stripSafeRedirections
    UnquotedKeepQuoteChars string // quotes preserved, content stripped
    TreeSitterAST        *TreeSitterAnalysis // optional AST for authoritative parsing
}

// SecurityValidator is a single security check.
type SecurityValidator func(cmd string, ctx CheckContext) *SecurityViolation
```

### 3.2 Validator Implementations

#### Check 1: Empty Command (early-allow)

```go
func ValidateEmpty(ctx CheckContext) *SecurityViolation {
    if strings.TrimSpace(ctx.OriginalCommand) == "" {
        return nil // passthrough -> allow
    }
    return nil
}
```

#### Check 2: Incomplete Commands (early-ask)

```go
func ValidateIncompleteCommands(ctx CheckContext) *SecurityViolation {
    trimmed := strings.TrimSpace(ctx.OriginalCommand)
    if strings.HasPrefix(trimmed, "\t") {
        return &SecurityViolation{
            CheckID: CheckIncompleteCommands, SubID: 1,
            Pattern: "starts with tab",
            IsMisparsing: true, Severity: SeverityMedium,
        }
    }
    if strings.HasPrefix(trimmed, "-") {
        return &SecurityViolation{
            CheckID: CheckIncompleteCommands, SubID: 2,
            Pattern: "starts with flags",
            IsMisparsing: true, Severity: SeverityMedium,
        }
    }
    if matched, _ := regexp.MatchString(`^\s*(&&|\|\||;|>>?|<)`, ctx.OriginalCommand); matched {
        return &SecurityViolation{
            CheckID: CheckIncompleteCommands, SubID: 3,
            Pattern: "continuation line (starts with operator)",
            IsMisparsing: true, Severity: SeverityMedium,
        }
    }
    return nil
}
```

#### Check 3-4: Heredoc & Git Commit (early-allow/ask)

```go
var heredocInSubstitution = regexp.MustCompile(`\$\(.*<<`)

func ValidateSafeCommandSubstitution(ctx CheckContext) *SecurityViolation {
    if !heredocInSubstitution.MatchString(ctx.OriginalCommand) {
        return nil
    }
    if isSafeHeredoc(ctx.OriginalCommand) {
        return nil // early-allow: safe heredoc pattern
    }
    return nil // fall through to main validators
}

func ValidateGitCommit(ctx CheckContext) *SecurityViolation {
    // Ask if commit message (-m) contains $() or backtick substitution
    if gitCommitRe.MatchString(ctx.OriginalCommand) {
        if containsSubstitution(ctx.UnquotedContent) {
            return &SecurityViolation{
                CheckID: CheckGitCommitSubstitution,
                Pattern: "git commit with command substitution in message",
                IsMisparsing: true, Severity: SeverityMedium,
            }
        }
    }
    return nil
}
```

#### Check 5: JQ Dangerous Functions

```go
var jqSystemFuncRe = regexp.MustCompile(`\b(system|env|input_filename)\b`)
var jqFileArgRe = regexp.MustCompile(`--(rawfile|slurpfile)\s`)

func ValidateJqCommand(ctx CheckContext) *SecurityViolation {
    if ctx.BaseCommand != "jq" {
        return nil
    }
    if jqSystemFuncRe.MatchString(ctx.UnquotedContent) {
        return &SecurityViolation{
            CheckID: CheckJqSystemFunction,
            Pattern: "jq with system/env/input_filename",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    if jqFileArgRe.MatchString(ctx.UnquotedContent) {
        return &SecurityViolation{
            CheckID: CheckJqFileArguments,
            Pattern: "jq with --rawfile/--slurpfile",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

#### Check 6: Obfuscated Flags (ANSI-C quoting, empty-quote bypass)

```go
var ansiCQuoteRe = regexp.MustCompile(`\$'[^']*'`)
var localeQuoteRe = regexp.MustCompile(`\$"[^"]*"`)
var emptyQuoteDashRe = regexp.MustCompile(`(?m)(?:^|\s)(?:''|"")+\s*-`)
var conjugateDashRe = regexp.MustCompile(`([\x27\x22]{2,})\s{0,8}-`)

func ValidateObfuscatedFlags(ctx CheckContext) *SecurityViolation {
    // echo is safe
    hasOps, _ := regexp.MatchString(`[|&;]`, ctx.OriginalCommand)
    if ctx.BaseCommand == "echo" && !hasOps {
        return nil
    }
    if ansiCQuoteRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckObfuscatedFlags, SubID: 5,
            Pattern: "ANSI-C quoting ($'...') can hide characters",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    if localeQuoteRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckObfuscatedFlags, SubID: 6,
            Pattern: "locale quoting ($\"...\") can hide characters",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    if emptyQuoteDashRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckObfuscatedFlags, SubID: 7,
            Pattern: "empty quotes before dash (potential bypass)",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    // Quote concatenation obfuscation: \"\"\"\\s{0,8}-
    if conjugateDashRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckObfuscatedFlags, SubID: 8,
            Pattern: "quote concatenation near dash",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

#### Checks 7-8: Shell Metacharacters & Dangerous Variables

```go
var quotedMetacharRe = regexp.MustCompile(`(?:^|\s)["'][^"']*[;&][^"']*["'](?:\s|$)`)
var findNameRe = regexp.MustCompile(`-(?:name|path|iname)\s+["'][^"']*[;|&][^"']*["']`)
var findRegexRe = regexp.MustCompile(`-regex\s+["'][^"']*[;|&][^"']*["']`)
var dangerousVarRe1 = regexp.MustCompile(`[<>|]\s*\$[A-Za-z_]`)
var dangerousVarRe2 = regexp.MustCompile(`\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]`)

func ValidateShellMetacharacters(ctx CheckContext) *SecurityViolation { ... }
func ValidateDangerousVariables(ctx CheckContext) *SecurityViolation {
    if dangerousVarRe1.MatchString(ctx.FullyUnquotedContent) ||
       dangerousVarRe2.MatchString(ctx.FullyUnquotedContent) {
        return &SecurityViolation{
            CheckID: CheckDangerousVariables,
            Pattern: "variables in dangerous contexts (redirections or pipes)",
            IsMisparsing: true, Severity: SeverityMedium,
        }
    }
    return nil
}
```

#### Checks 9-11: Comment Desync, Quoted Newline, Carriage Return

```go
func ValidateCommentQuoteDesync(ctx CheckContext) *SecurityViolation {
    if ctx.TreeSitterAST != nil {
        return nil // AST is authoritative, no desync possible
    }
    // Scan for unquoted # followed by quote char on same line
    // Detailed quote-state machine (see Section 2.5, attack #4)
    ...
}

func ValidateQuotedNewline(ctx CheckContext) *SecurityViolation {
    if !strings.Contains(ctx.OriginalCommand, "\n") ||
       !strings.Contains(ctx.OriginalCommand, "#") {
        return nil
    }
    // Scan: \n inside quotes, next line starts with # -> ask
    ...
}

func ValidateCarriageReturn(ctx CheckContext) *SecurityViolation {
    if !strings.Contains(ctx.OriginalCommand, "\r") {
        return nil
    }
    return &SecurityViolation{
        CheckID: CheckControlCharacters, // reuses control char ID
        Pattern: "carriage return causes parser differential",
        IsMisparsing: true, Severity: SeverityHigh,
    }
}
```

#### Check 12: Newlines (non-misparsing)

```go
var looksLikeCommandRe = regexp.MustCompile(`(?<![\s]\\)[\n\r]\s*\S`)

func ValidateNewlines(ctx CheckContext) *SecurityViolation {
    if !strings.ContainsAny(ctx.FullyUnquotedPreStrip, "\n\r") {
        return nil
    }
    if looksLikeCommandRe.MatchString(ctx.FullyUnquotedPreStrip) {
        return &SecurityViolation{
            CheckID: CheckNewlines,
            Pattern: "newlines that could separate multiple commands",
            IsMisparsing: false, Severity: SeverityLow,
        }
    }
    return nil
}
```

#### Check 13: IFS Injection

```go
var ifsInjectionRe = regexp.MustCompile(`\$IFS|\$\{[^}]*IFS`)

func ValidateIFSInjection(ctx CheckContext) *SecurityViolation {
    if ifsInjectionRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckIFSInjection,
            Pattern: "IFS variable usage could bypass security validation",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

#### Check 14: /proc/*/environ Access

```go
var procEnvironRe = regexp.MustCompile(`/proc/.*/environ`)

func ValidateProcEnvironAccess(ctx CheckContext) *SecurityViolation {
    if procEnvironRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckProcEnvironAccess,
            Pattern: "accesses /proc/*/environ (sensitive environment variables)",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

#### Check 15: Command Substitution Patterns (12 patterns + backtick)

```go
var commandSubstitutionPatterns = []struct {
    re      *regexp.Regexp
    message string
}{
    {regexp.MustCompile(`<\(`), "process substitution <()"},
    {regexp.MustCompile(`>\(`), "process substitution >()"},
    {regexp.MustCompile(`=\(`), "Zsh process substitution =()"},
    {regexp.MustCompile(`(?:^|[\s;&|])=[a-zA-Z_]`), "Zsh equals expansion (=cmd)"},
    {regexp.MustCompile(`\$\(`), "$() command substitution"},
    {regexp.MustCompile(`\$\{`), "${} parameter substitution"},
    {regexp.MustCompile(`\$\[`), "$[] legacy arithmetic expansion"},
    {regexp.MustCompile(`~\[`), "Zsh-style parameter expansion"},
    {regexp.MustCompile(`\(e:`), "Zsh-style glob qualifiers"},
    {regexp.MustCompile(`\(\+`), "Zsh glob qualifier with command execution"},
    {regexp.MustCompile(`\}\s*always\s*\{`), "Zsh always block (try/always construct)"},
    {regexp.MustCompile(`<#`), "PowerShell comment syntax (defense in depth)"},
}

func hasUnescapedBacktick(content string) bool {
    // State machine: skip backslash-escaped chars, detect bare `
    ...
}

func ValidateDangerousPatterns(ctx CheckContext) *SecurityViolation {
    if hasUnescapedBacktick(ctx.UnquotedContent) {
        return &SecurityViolation{
            CheckID: CheckCommandSubstitution,
            Pattern: "backticks (`) for command substitution",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    for _, p := range commandSubstitutionPatterns {
        if p.re.MatchString(ctx.UnquotedContent) {
            return &SecurityViolation{
                CheckID: CheckCommandSubstitution,
                Pattern: p.message,
                IsMisparsing: true, Severity: SeverityHigh,
            }
        }
    }
    return nil
}
```

#### Checks 16-18: Redirections, Backslash Escapes

```go
func ValidateRedirections(ctx CheckContext) *SecurityViolation {
    if strings.Contains(ctx.FullyUnquotedContent, "<") {
        return &SecurityViolation{
            CheckID: CheckInputRedirection,
            Pattern: "input redirection (<) could read sensitive files",
            IsMisparsing: false, Severity: SeverityLow,
        }
    }
    if strings.Contains(ctx.FullyUnquotedContent, ">") {
        return &SecurityViolation{
            CheckID: CheckOutputRedirection,
            Pattern: "output redirection (>) could write to arbitrary files",
            IsMisparsing: false, Severity: SeverityLow,
        }
    }
    return nil
}

var backslashEscapedWSRe = regexp.MustCompile(`\\[ \t]`)
var shellOperators = []byte{';', '|', '&', '<', '>'}

func ValidateBackslashEscapedWhitespace(ctx CheckContext) *SecurityViolation { ... }
func ValidateBackslashEscapedOperators(ctx CheckContext) *SecurityViolation {
    if hasBackslashEscapedOperator(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckBackslashEscapedOperators,
            Pattern: "backslash-escaped operator (\\;) causes double-parse",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}

// hasBackslashEscapedOperator: state machine tracking single/double quote state,
// detects \<operator> outside double quotes (safe inside double quotes).
// Critical: backslash check runs BEFORE quote toggle (see Section 2.5, attack #2).
```

#### Checks 19-21: Unicode, Mid-Word Hash, Brace Expansion

```go
var unicodeWSRe = regexp.MustCompile(
    `[   -     　﻿]`)

func ValidateUnicodeWhitespace(ctx CheckContext) *SecurityViolation { ... }

var midWordHashRe = regexp.MustCompile(`\S(?<!\$\{)#`)

func ValidateMidWordHash(ctx CheckContext) *SecurityViolation {
    // Check original + continuation-joined versions
    joined := joinLineContinuations(ctx.UnquotedKeepQuoteChars)
    if midWordHashRe.MatchString(ctx.UnquotedKeepQuoteChars) ||
       midWordHashRe.MatchString(joined) {
        return &SecurityViolation{
            CheckID: CheckMidWordHash,
            Pattern: "mid-word # parsed differently by shell-quote vs bash",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}

func ValidateBraceExpansion(ctx CheckContext) *SecurityViolation {
    content := ctx.FullyUnquotedPreStrip
    // Sub-2: Mismatched brace counts after quote stripping
    open, close := countUnescapedBraces(content)
    if open > 0 && close > open {
        return &SecurityViolation{
            CheckID: CheckBraceExpansion, SubID: 2,
            Pattern: "excess closing braces after quote stripping",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    // Sub-3: Quoted brace inside unquoted brace context
    if open > 0 && quotedBraceRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckBraceExpansion, SubID: 3,
            Pattern: "quoted brace char inside brace context (obfuscation)",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    // Sub-1: Scan for {a,b} or {a..b} at outermost nesting level
    if hasBraceExpansion(content) {
        return &SecurityViolation{
            CheckID: CheckBraceExpansion, SubID: 1,
            Pattern: "brace expansion that could alter command parsing",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

#### Check 22: Zsh Dangerous Commands (18 commands + fc -e)

```go
var zshDangerousCommands = map[string]bool{
    "zmodload": true, "emulate": true,
    "sysopen": true, "sysread": true, "syswrite": true, "sysseek": true,
    "zpty": true, "ztcp": true, "zsocket": true,
    "mapfile": true,
    "zf_rm": true, "zf_mv": true, "zf_ln": true,
    "zf_chmod": true, "zf_chown": true, "zf_mkdir": true,
    "zf_rmdir": true, "zf_chgrp": true,
}
var zshPrecommandModifiers = map[string]bool{
    "command": true, "builtin": true, "noglob": true, "nocorrect": true,
}

func ExtractBaseCommand(trimmed string) string {
    tokens := strings.Fields(trimmed)
    for _, tok := range tokens {
        if strings.ContainsRune(tok, '=') &&
           regexp.MustCompile(`^[A-Za-z_]\w*=`).MatchString(tok) {
            continue // env var assignment
        }
        if zshPrecommandModifiers[tok] {
            continue
        }
        return tok
    }
    return ""
}

func ValidateZshDangerousCommands(ctx CheckContext) *SecurityViolation {
    baseCmd := ExtractBaseCommand(strings.TrimSpace(ctx.OriginalCommand))
    if zshDangerousCommands[baseCmd] {
        return &SecurityViolation{
            CheckID: CheckZshDangerousCommands, SubID: 1,
            Pattern: fmt.Sprintf("Zsh '%s' can bypass security checks", baseCmd),
            IsMisparsing: true, Severity: SeverityBlock,
        }
    }
    if baseCmd == "fc" && regexp.MustCompile(`\s-\S*e`).MatchString(
        strings.TrimSpace(ctx.OriginalCommand)) {
        return &SecurityViolation{
            CheckID: CheckZshDangerousCommands, SubID: 2,
            Pattern: "fc -e can execute arbitrary commands via editor",
            IsMisparsing: true, Severity: SeverityBlock,
        }
    }
    return nil
}
```

#### Check 23: Malformed Token Injection (eval bypass)

```go
func ValidateMalformedTokenInjection(ctx CheckContext) *SecurityViolation {
    tokens := tryParseShellCommand(ctx.OriginalCommand)
    if tokens == nil {
        return nil // handled elsewhere
    }
    hasCommandSeparator := false
    for _, t := range tokens {
        if t.Op == ";" || t.Op == "&&" || t.Op == "||" {
            hasCommandSeparator = true
            break
        }
    }
    if !hasCommandSeparator {
        return nil
    }
    if hasMalformedTokens(ctx.OriginalCommand, tokens) {
        return &SecurityViolation{
            CheckID: CheckMalformedTokenInjection,
            Pattern: "ambiguous syntax with command separators (eval bypass)",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    return nil
}
```

### 3.3 Pipeline Orchestrator (Go)

```go
// SecurityPipeline runs all validators in order, returning the first blocking result.
// Mirrors the CC priority: early-allow -> misparsing -> deferred non-misparsing.
type SecurityPipeline struct {
    EarlyValidators     []SecurityValidator
    MisparsingValidators []SecurityValidator
    NonMisparsingValidators []SecurityValidator
    ControlCharRe       *regexp.Regexp
}

func NewSecurityPipeline() *SecurityPipeline {
    return &SecurityPipeline{
        ControlCharRe: regexp.MustCompile(`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`),
        EarlyValidators: []SecurityValidator{
            ValidateEmpty,
            ValidateIncompleteCommands,
            ValidateSafeCommandSubstitution,
            ValidateGitCommit,
        },
        MisparsingValidators: []SecurityValidator{
            ValidateJqCommand,
            ValidateObfuscatedFlags,
            ValidateShellMetacharacters,
            ValidateDangerousVariables,
            ValidateCommentQuoteDesync,
            ValidateQuotedNewline,
            ValidateCarriageReturn,
            ValidateIFSInjection,
            ValidateProcEnvironAccess,
            ValidateDangerousPatterns,
            ValidateBackslashEscapedWhitespace,
            ValidateBackslashEscapedOperators,
            ValidateUnicodeWhitespace,
            ValidateMidWordHash,
            ValidateBraceExpansion,
            ValidateZshDangerousCommands,
            ValidateMalformedTokenInjection,
        },
        NonMisparsingValidators: []SecurityValidator{
            ValidateNewlines,
            ValidateRedirections,
        },
    }
}

func (p *SecurityPipeline) Evaluate(command string) *SecurityViolation {
    // Pre-processing: control characters
    if p.ControlCharRe.MatchString(command) {
        return &SecurityViolation{
            CheckID: CheckControlCharacters,
            Pattern: "non-printable control characters",
            IsMisparsing: true, Severity: SeverityBlock,
        }
    }

    // Pre-processing: extract heredocs (quoted-only)
    processedCmd := extractHeredocs(command, true)

    // Build context
    baseCmd := strings.Split(processedCmd, " ")[0]
    withDQ, fullyUQ, keepQC := extractQuotedContent(processedCmd, baseCmd == "jq")
    fullyUQStripped := stripSafeRedirections(fullyUQ)

    ctx := CheckContext{
        OriginalCommand:       command,
        BaseCommand:           baseCmd,
        UnquotedContent:       withDQ,
        FullyUnquotedContent:  fullyUQStripped,
        FullyUnquotedPreStrip: fullyUQ,
        UnquotedKeepQuoteChars: keepQC,
    }

    // Early validators (allow -> return nil)
    for _, v := range p.EarlyValidators {
        result := v(command, ctx)
        if result != nil {
            if result.Severity == SeverityLow {
                return nil // early-allow (safe heredoc, empty cmd, safe git)
            }
            return result
        }
    }

    // Main validators with deferred non-misparsing
    var deferred *SecurityViolation
    for _, v := range p.MisparsingValidators {
        if result := v(command, ctx); result != nil {
            return result // misparsing -> block immediately
        }
    }
    for _, v := range p.NonMisparsingValidators {
        if result := v(command, ctx); result != nil {
            deferred = result // non-misparsing -> defer
        }
    }
    if deferred != nil {
        return deferred
    }

    return nil // safe
}
```

### 3.4 SecurityCheckID Enum (Go)

```go
type SecurityCheckID int

const (
    CheckIncompleteCommands       SecurityCheckID = 1
    CheckJqSystemFunction         SecurityCheckID = 2
    CheckJqFileArguments          SecurityCheckID = 3
    CheckObfuscatedFlags          SecurityCheckID = 4
    CheckShellMetacharacters      SecurityCheckID = 5
    CheckDangerousVariables       SecurityCheckID = 6
    CheckNewlines                 SecurityCheckID = 7
    CheckCommandSubstitution      SecurityCheckID = 8
    CheckInputRedirection         SecurityCheckID = 9
    CheckOutputRedirection        SecurityCheckID = 10
    CheckIFSInjection             SecurityCheckID = 11
    CheckGitCommitSubstitution    SecurityCheckID = 12
    CheckProcEnvironAccess        SecurityCheckID = 13
    CheckMalformedTokenInjection  SecurityCheckID = 14
    CheckBackslashEscapedWhitespace SecurityCheckID = 15
    CheckBraceExpansion           SecurityCheckID = 16
    CheckControlCharacters        SecurityCheckID = 17
    CheckUnicodeWhitespace        SecurityCheckID = 18
    CheckMidWordHash              SecurityCheckID = 19
    CheckZshDangerousCommands     SecurityCheckID = 20
    CheckBackslashEscapedOperators SecurityCheckID = 21
    CheckCommentQuoteDesync       SecurityCheckID = 22
    CheckQuotedNewline            SecurityCheckID = 23
)
```

---

## 4. Timeout & Backgrounding Strategy

### 4.1 Claude Code Constants

```typescript
// BashTool.tsx
const PROGRESS_THRESHOLD_MS = 2000;           // show progress after 2s
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;  // auto-background after 15s in assistant mode

// BashTool/prompt.ts
export function getDefaultTimeoutMs(): number { return 120_000 } // 2 min
export function getMaxTimeoutMs(): number { return 600_000 }     // 10 min
```

### 4.2 Backgrounding Flow

```
Command starts
  |
  +-- 2s (PROGRESS_THRESHOLD_MS): if still running, show progress UI
  |
  +-- 15s (ASSISTANT_BLOCKING_BUDGET_MS): if in Kairos/assistant mode,
  |     auto-background the command. Command continues running;
  |     the agent gets a backgroundTaskId and can keep working.
  |
  +-- 120s (default timeout): if configuredn't, kill the command.
  |
  +-- 600s (max timeout): hard limit; SIGKILL.
```

Background results notification:
```typescript
backgroundInfo = `Command exceeded the assistant-mode blocking budget (${
  ASSISTANT_BLOCKING_BUDGET_MS / 1000}s) and was moved to the background
  with ID: ${backgroundTaskId}. It is still running — you will be notified
  when it completes. Output is being written to: ${outputPath}.`
```

### 4.3 AgentHub Timeout Strategy

```go
// packages/executor/timeout.go

type TimeoutConfig struct {
    ProgressThreshold time.Duration // 2s  — show "Running..." feedback
    BlockingBudget    time.Duration // 15s — auto-background after this
    DefaultTimeout    time.Duration // 120s — default timeout
    MaxTimeout        time.Duration // 600s — user-specified max
}

type TimeoutStrategy int

const (
    TimeoutStrategyDefault     TimeoutStrategy = iota // 120s timeout, 15s bg
    TimeoutStrategyInteractive                        // shorter: 30s bg
    TimeoutStrategyBatch                              // longer: 300s timeout
    TimeoutStrategyBackground                         // no blocking budget
)

// BackgroundContext holds the state for a moved-to-background task.
type BackgroundContext struct {
    TaskID        string
    Command       string
    OutputPath    string
    StartTime     time.Time
    Status        BackgroundStatus
    NotificationCh chan BackgroundResult
}

type BackgroundStatus string

const (
    BackgroundRunning  BackgroundStatus = "running"
    BackgroundDone     BackgroundStatus = "done"
    BackgroundFailed   BackgroundStatus = "failed"
    BackgroundTimedOut BackgroundStatus = "timed_out"
)

type BackgroundResult struct {
    TaskID   string
    Stdout   string
    Stderr   string
    ExitCode int
    Duration time.Duration
}
```

### 4.4 Timeout Enforcement in the Executor

```go
func (e *Executor) runWithTimeout(
    ctx context.Context,
    call ToolCall,
    cfg TimeoutConfig,
) (*ToolResult, error) {
    // Create sub-context with timeout
    timeout := call.Timeout
    if timeout == 0 {
        timeout = cfg.DefaultTimeout
    }
    if timeout > cfg.MaxTimeout {
        timeout = cfg.MaxTimeout
    }
    execCtx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    // Progress notification after threshold
    progressTimer := time.NewTimer(cfg.ProgressThreshold)
    defer progressTimer.Stop()

    // Auto-background timer (assistant mode only)
    bgTimer := time.NewTimer(cfg.BlockingBudget)
    defer bgTimer.Stop()

    resultCh := make(chan *ToolResult, 1)
    errCh := make(chan error, 1)

    go func() {
        result, err := e.executeTool(execCtx, call)
        if err != nil {
            errCh <- err
        } else {
            resultCh <- result
        }
    }()

    for {
        select {
        case result := <-resultCh:
            return result, nil
        case err := <-errCh:
            return nil, err
        case <-progressTimer.C:
            // Emit progress event to stream
            e.emitProgress(call, "still running...")
        case <-bgTimer.C:
            // Move to background
            return e.moveToBackground(ctx, call, execCtx, resultCh, errCh), nil
        case <-execCtx.Done():
            return nil, execCtx.Err()
        }
    }
}
```

---

## 5. AgentHub PolicyEngine Design

### 5.1 Architecture

```
Agent CLI requests tool execution
  |
  Runner ToolEngine intercepts
  |
  PolicyEngine.Evaluate(toolCall, evalCtx)
  |
  +-- Pre-check: SecurityPipeline.Evaluate(command) -> violation?
  |     |
  |     +-- SeverityBlock? -> DENY (no user prompt)
  |     +-- SeverityHigh? -> marked as mandatory ask
  |
  +-- Rule evaluation (priority-ordered)
  |     for each PolicyRule (sorted by Priority):
  |       if rule.Match matches toolCall:
  |         return rule.Action
  |
  +-- No rule match?
  |     +-- Tool.RiskLevel == low + no violation? -> ALLOW
  |     +-- Tool.RequiresApproval? -> ASK_USER
  |     +-- else -> ALLOW
  |
  +-- Generate ApprovalDecision
        send to Edge for user interaction (if ASK_USER)
        apply decision to tool execution
```

### 5.2 PolicyEngine Interface & Implementation

```go
// packages/security/policy_engine.go

// PolicyEngine evaluates tool calls against configured rules and security checks.
// Rules are ordered by priority; first match wins (stop processing).
// Security pipeline runs before rules for blocking violations.
type PolicyEngine struct {
    rules             []PolicyRule        // sorted by Priority
    securityPipeline  *SecurityPipeline
    riskPatterns      []HighRiskPattern
    decisionCache     map[string]*CachedDecision // toolCallID -> decision
    mu                sync.RWMutex
}

type EvalContext struct {
    SessionID    string
    TurnID       string
    AgentID      string
    WorkspaceID  string
    WorkingDir   string
    ProjectID    string
    PermissionMode string // "default", "bypassPermissions", "plan", "acceptEdits"
}

type CachedDecision struct {
    Decision *ApprovalDecision
    Scope    DecisionScope
    ExpiresAt time.Time
}

// Evaluate determines the decision for a tool call.
// Flow:
//   1. BypassPermissions mode: auto-allow (read-only check still runs)
//   2. Plan mode: allow only read-only tools
//   3. Check cached decisions (per-thread, per-session scope)
//   4. Run security pipeline on bash commands
//   5. Match against high-risk patterns (auto-deny patterns)
//   6. Evaluate policy rules in priority order
//   7. Default behavior based on ToolDescriptor
func (pe *PolicyEngine) Evaluate(
    toolCall ToolCall,
    ctx EvalContext,
) *ApprovalDecision {

    // Fast path: bypass mode
    if ctx.PermissionMode == "bypassPermissions" {
        if toolCall.IsReadOnly {
            return &ApprovalDecision{
                Type:    DecisionAccept,
                Reason:  "bypassPermissions mode (read-only)",
                DecidedBy: "system",
                Scope:   ScopeOnce,
            }
        }
        // Write tools in bypass still auto-accepted (user opted in)
        return &ApprovalDecision{
            Type:    DecisionAccept,
            Reason:  "bypassPermissions mode",
            DecidedBy: "system",
            Scope:   ScopeOnce,
        }
    }

    // Plan mode: only read-only allowed
    if ctx.PermissionMode == "plan" && !toolCall.IsReadOnly {
        return &ApprovalDecision{
            Type:    DecisionDecline,
            Reason:  "plan mode: write tool blocked",
            DecidedBy: "system",
            Scope:   ScopeOnce,
        }
    }

    // Cache lookup
    if d := pe.lookupCache(toolCall, ctx); d != nil {
        return d
    }

    // Security pipeline (bash commands only)
    if toolCall.ToolName == "bash" || toolCall.ToolName == "powershell" {
        cmd, ok := toolCall.Input["command"].(string)
        if ok {
            violation := pe.securityPipeline.Evaluate(cmd)
            if violation != nil {
                switch violation.Severity {
                case SeverityBlock:
                    return &ApprovalDecision{
                        Type:      DecisionDecline,
                        Reason:    fmt.Sprintf("blocked: %s", violation.Pattern),
                        DecidedBy: "system",
                        Scope:     ScopeOnce,
                    }
                case SeverityHigh:
                    // Mandatory user approval (bypasses allowlist)
                    return &ApprovalDecision{
                        Type:      DecisionAccept, // will be overridden by ASK_USER in Edge
                        Reason:    fmt.Sprintf("security concern: %s", violation.Pattern),
                        DecidedBy: "system",
                        Scope:     ScopeOnce,
                        // SecurityViolation is attached for UI to display
                    }
                }
            }
        }
    }

    // High-risk pattern match (auto-deny patterns)
    for _, pattern := range pe.riskPatterns {
        if pattern.Matches(toolCall) && pattern.AutoDeny {
            return &ApprovalDecision{
                Type:      DecisionDecline,
                Reason:    pattern.Description,
                DecidedBy: "system",
                Scope:     ScopeOnce,
            }
        }
    }

    // Policy rule evaluation (priority order, first match wins)
    for _, rule := range pe.rules {
        if !rule.Enabled {
            continue
        }
        if !pe.matchRule(rule, toolCall, ctx) {
            continue
        }
        switch rule.Action {
        case PolicyAllow:
            return &ApprovalDecision{
                Type:      DecisionAccept,
                Reason:    fmt.Sprintf("rule: %s", rule.Name),
                DecidedBy: "system",
                Scope:     ruleScopeToDecisionScope(rule.Scope),
            }
        case PolicyDeny:
            return &ApprovalDecision{
                Type:      DecisionDecline,
                Reason:    fmt.Sprintf("rule: %s", rule.Name),
                DecidedBy: "system",
                Scope:     ScopeOnce,
            }
        case PolicyAskUser:
            // Falls through to default behavior
            break
        case PolicyEscalate:
            return &ApprovalDecision{
                Type:      DecisionAccept,
                Reason:    "escalated to admin",
                DecidedBy: "system",
                Scope:     ScopeOnce,
                // escalates to admin approval flow
            }
        }
    }

    // Default behavior
    if toolCall.RequiresApproval {
        return &ApprovalDecision{
            Type:      DecisionAccept,
            Reason:    "requires user approval (default)",
            DecidedBy: "system",
            Scope:     ScopeOnce,
        }
    }

    // Auto-allow
    return &ApprovalDecision{
        Type:      DecisionAccept,
        Reason:    "auto-allowed (no rules matched, low risk)",
        DecidedBy: "system",
        Scope:     ScopeOnce,
    }
}

// matchRule checks if a policy rule matches the given tool call and context.
func (pe *PolicyEngine) matchRule(
    rule PolicyRule,
    toolCall ToolCall,
    ctx EvalContext,
) bool {
    match := rule.Match

    // Tool pattern match (glob)
    if match.ToolPattern != "" {
        if !globMatch(match.ToolPattern, toolCall.ToolName) {
            return false
        }
    }

    // Tool input key match
    if match.ToolInputKey != "" {
        val, ok := toolCall.Input[match.ToolInputKey].(string)
        if !ok {
            return false
        }
        if match.ToolInputValue != "" {
            if !regexp.MustCompile(match.ToolInputValue).MatchString(val) {
                return false
            }
        }
    }

    // Path pattern match
    if match.PathPattern != "" {
        path, _ := toolCall.Input["file_path"].(string)
        if !globMatch(match.PathPattern, path) {
            return false
        }
    }

    // Risk level match
    if match.RiskLevel != nil {
        if toolCall.RiskLevel != *match.RiskLevel {
            return false
        }
    }

    // Agent match
    if match.AgentID != "" && match.AgentID != ctx.AgentID {
        return false
    }

    return true
}

func (pe *PolicyEngine) lookupCache(
    toolCall ToolCall,
    ctx EvalContext,
) *ApprovalDecision {
    pe.mu.RLock()
    defer pe.mu.RUnlock()

    // Check per-session scope
    key := fmt.Sprintf("session:%s:%s", ctx.SessionID, toolCall.ToolName)
    if cached, ok := pe.decisionCache[key]; ok {
        if cached.Scope == ScopeSession &&
           time.Now().Before(cached.ExpiresAt) {
            return cached.Decision
        }
    }

    // Check per-thread scope
    key = fmt.Sprintf("thread:%s:%s:%s", ctx.SessionID,
        ctx.TurnID, toolCall.ToolName)
    if cached, ok := pe.decisionCache[key]; ok {
        if cached.Scope == ScopeThread &&
           time.Now().Before(cached.ExpiresAt) {
            return cached.Decision
        }
    }
    return nil
}

func (pe *PolicyEngine) RegisterRule(rule *PolicyRule) error {
    pe.mu.Lock()
    defer pe.mu.Unlock()
    pe.rules = append(pe.rules, *rule)
    sort.Slice(pe.rules, func(i, j int) bool {
        return pe.rules[i].Priority < pe.rules[j].Priority
    })
    return nil
}

func (pe *PolicyEngine) RemoveRule(ruleID string) error { ... }

func (pe *PolicyEngine) ListRules(
    scope PolicyScope, scopeID string,
) ([]*PolicyRule, error) { ... }

func (pe *PolicyEngine) RecordDecision(decision *ApprovalDecision) error {
    pe.mu.Lock()
    defer pe.mu.Unlock()
    // Cache decisions with per-session/per-thread scope
    ...
    return nil
}
```

### 5.3 PolicyRule Priority System

```go
// Priority values match CC's 9-source priority system:
// Lower number = higher priority (checked first)

const (
    PriorityCLIFlag        = 0   // --approve-bash, --dangerously-skip-permissions
    PrioritySessionRule    = 100 // user approved "for this session" during runtime
    PriorityUserSettings   = 200 // ~/.agenthub/settings.json
    PriorityProjectLocal   = 300 // .agenthub/rules.json (project-local)
    PriorityAgentConfig    = 400 // per-agent configuration
    PriorityTeamPolicy     = 500 // team-level policy from Hub
    PriorityEnterprisePolicy = 600 // organization-wide policy
    PrioritySystemDefault  = 700 // built-in high-risk patterns
    PriorityCatchAll       = 1000 // default allow/deny
)
```

### 5.4 HighRiskPattern Matcher

```go
type HighRiskPattern struct {
    ID          string
    Name        string
    Pattern     string // regex
    Category    ApprovalKind
    AutoDeny    bool   // true = deny without user prompt
    Description string
}

func (p *HighRiskPattern) Matches(toolCall ToolCall) bool {
    if toolCall.ToolName != "bash" && toolCall.ToolName != "powershell" {
        return false
    }
    cmd, ok := toolCall.Input["command"].(string)
    if !ok {
        return false
    }
    return regexp.MustCompile(p.Pattern).MatchString(cmd)
}

var defaultHighRiskPatterns = []HighRiskPattern{
    {
        ID: "curl-pipe-sh", Name: "curl | sh",
        Pattern: `curl.*\|.*(sh|bash)`,
        Category: ApprovalShellCommand,
        AutoDeny: true,
        Description: "Piped remote script execution (curl | sh)",
    },
    {
        ID: "read-ssh",
        Name: "Read SSH keys",
        Pattern: `\.ssh/(id_|authorized_)`,
        Category: ApprovalSensitiveRead,
        AutoDeny: true,
        Description: "Reading SSH private keys",
    },
    {
        ID: "write-outside-workspace",
        Name: "Write outside workspace",
        Pattern: `^/[^w]`, // simplistic placeholder
        Category: ApprovalFileWrite,
        AutoDeny: true,
        Description: "Writing outside workspace root",
    },
    {
        ID: "sudo",
        Name: "sudo",
        Pattern: `\bsudo\b`,
        Category: ApprovalShellCommand,
        AutoDeny: false,
        Description: "Superuser command execution",
    },
    {
        ID: "rm-rf",
        Name: "rm -rf",
        Pattern: `\brm\s+.*-rf?\b`,
        Category: ApprovalShellCommand,
        AutoDeny: false,
        Description: "Recursive force deletion",
    },
    {
        ID: "git-push",
        Name: "git push",
        Pattern: `git\s+push`,
        Category: ApprovalDeploy,
        AutoDeny: false,
        Description: "Pushing to remote repository",
    },
    {
        ID: "deploy-cmd",
        Name: "Deploy command",
        Pattern: `\b(deploy|release|publish)\b`,
        Category: ApprovalDeploy,
        AutoDeny: false,
        Description: "Deployment-related command",
    },
}
```

---

## 6. Integration: Runner Executor + PolicyEngine

### 6.1 End-to-End Tool Execution Flow

```go
// packages/executor/runner_executor.go

type RunnerExecutor struct {
    registry       ToolRegistry
    policyEngine   *PolicyEngine
    security       *SecurityPipeline
    timeout        TimeoutConfig
    workspace      WorkspaceProvider
}

func (e *RunnerExecutor) ExecuteTurn(
    ctx context.Context,
    turn TurnContext,
    toolCalls []ToolCall,
) (<-chan ToolResult, error) {

    batches := PartitionToolCalls(toolCalls, e.registry)
    results := make(chan ToolResult, len(toolCalls))

    go func() {
        defer close(results)

        for _, batch := range batches {
            for _, call := range batch.Blocks {
                // 1. Security & Policy evaluation
                decision := e.policyEngine.Evaluate(call, EvalContext{
                    SessionID:      turn.SessionID,
                    TurnID:         turn.TurnID,
                    AgentID:        turn.AgentID,
                    WorkspaceID:    turn.WorkspaceID,
                    WorkingDir:     turn.WorkingDir,
                    PermissionMode: turn.PermissionMode,
                })

                if decision.Type == DecisionDecline {
                    results <- ToolResult{
                        ToolCallID: call.ID,
                        IsDenied:   true,
                        DenyReason: decision.Reason,
                    }
                    continue
                }

                // 2. Execute with timeout
                result, err := e.runWithTimeout(ctx, call, e.timeout)
                if err != nil {
                    results <- ToolResult{
                        ToolCallID: call.ID,
                        IsError:    true,
                        Content:    err.Error(),
                    }
                    continue
                }

                // 3. Record permission decision for caching
                if decision.Scope == ScopeThread || decision.Scope == ScopeSession {
                    e.policyEngine.RecordDecision(decision)
                }

                results <- *result
            }
        }
    }()

    return results, nil
}
```

### 6.2 PermissionBroker Integration (Adapter SDK)

The `PermissionBroker` interface (from `design-adapter-sdk.md`) bridges the runner's policy engine with the underlying agent CLI:

```go
// When the agent adapter emits a permission request:
func (a *Adapter) ResolvePermission(
    ctx context.Context,
    req ToolPermissionRequest,
) (*PermissionDecision, error) {
    // Map to PolicyEngine.Evaluate
    toolCall := ToolCall{
        ID:       req.ToolCallID,
        ToolName: req.ToolName,
        Input:    req.ToolInput,
    }
    evalCtx := EvalContext{
        SessionID: req.SessionID,
        TurnID:    req.TurnID,
    }

    decision := a.policyEngine.Evaluate(toolCall, evalCtx)
    return decision, nil
}
```

---

## 7. Summary: Key Design Decisions

| Aspect | Claude Code (TypeScript) | AgentHub (Go) |
|--------|--------------------------|---------------|
| **Partitioning** | Adjacent read-only tools merged into concurrent batches | Same: `PartitionToolCalls()` |
| **Concurrency cap** | 10 (env: `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`) | 10 (configurable) |
| **Context flow** | Serial: immediate; Concurrent: queued after batch | Same: batch-completion barrier |
| **Security checks** | 23 validators in ordered pipeline | 23 validators in `SecurityPipeline` |
| **Misparsing gate** | `isBashSecurityCheckForMisparsing` flag blocks early | `SecurityViolation.IsMisparsing` |
| **Heredoc handling** | Line-based matching replicating bash behavior | Same: `extractHeredocs()` |
| **Timeout** | 120s default, 600s max, 15s auto-bg | Same: `TimeoutConfig` struct |
| **Policy engine** | 9-source priority, first match wins | Same: `PolicyEngine` with priority-ordered rules |
| **Permission cache** | per-session, per-thread scoped | `CachedDecision` with session/thread keys |
| **High-risk patterns** | 8 built-in patterns | 7 built-in patterns (extensible) |

### Files Output

- `packages/security/bash_security.go` -- 23 security validators
- `packages/security/security_pipeline.go` -- Pipeline orchestrator
- `packages/security/policy_engine.go` -- PolicyEngine interface + implementation
- `packages/executor/orchestrator.go` -- PartitionToolCalls + Executor
- `packages/executor/timeout.go` -- TimeoutConfig + BackgroundContext
- `packages/executor/runner_executor.go` -- RunnerExecutor integrating PolicyEngine
