# 深入：Claude Code 工具编排与 Bash 安全

> 源码：`claude-code-main/src/services/tools/toolOrchestration.ts`、
> `claude-code-main/src/tools/BashTool/bashSecurity.ts`（105KB，23+ 检查）、
> `claude-code-main/src/services/tools/toolExecution.ts`、
> `claude-code-main/src/tools/BashTool/BashTool.tsx`、
> `Group2_ToolSystem/Group2_Summary.md`
> 目标：AgentHub Runner executor + PolicyEngine 设计
> 日期：2026-05-21

---

## 1. 工具编排引擎

### 1.1 架构概览

Claude Code 的工具编排是一个**分区并发执行器**。核心洞察：只读工具可以并行运行（它们观察状态），而写入工具必须串行运行（它们修改状态）。编排器不是调度器——它是一个**批处理分区器**，将相邻的只读工具调用分组为并发批次，并与串行写入批次交替执行。

```
runTools(toolUseMessages) {
  for batch of partitionToolCalls(toolUseMessages):
    if batch.isConcurrencySafe:
      runToolsConcurrently(batch)   // 最多 10 个并行
    else:
      runToolsSerially(batch)       // 每次一个
  }
}
```

### 1.2 分区逻辑（编排器的核心）

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
            return false  // 解析失败 -> 保守处理：视为串行
          }
        })()
      : false
    // 相邻的并发安全工具合并到同一批次
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}
```

关键特性：
- **相邻性很重要**：三个连续只读工具成为一个并发批次。中间有一个写入工具则拆分为三个批次。
- **保守默认**：如果 `isConcurrencySafe()` 抛出异常（如 shell-quote 解析失败），工具按串行处理。
- **逐工具声明**：每个工具通过 `Tool.isConcurrencySafe(input)` 声明其并发安全性。GlobTool、GrepTool、ReadTool 返回 `true`；BashTool、WriteTool、EditTool 返回 `false`。

### 1.3 并发机制

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
      // 标记为进行中，运行，标记完成
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id))
      yield* runToolUse(toolUse, ...)
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),  // 默认 10
  )
}

function getMaxToolUseConcurrency(): number {
  return parseInt(
    process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10
  ) || 10
}
```

`all()` 生成器（来自 `src/utils/generators.ts`）是一个**有界并发异步生成器**。它最多同时运行 `concurrencyCap` 个生成器，在任何生成器完成时立即产出值并启动下一个：

```typescript
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void>
```

### 1.4 上下文流转

**串行路径**（`runToolsSerially`）：上下文线性流转。每个工具的 `contextModifier` 立即应用于 `currentContext`，后续工具看到更新后的上下文。

**并发路径**（`runToolsConcurrently`）：并发工具的上下文修改器被**排队，在批次中所有工具完成后统一应用**。这防止了并发工具读取过期或部分修改的上下文。

```typescript
// 批次完成后排队应用：
for (const block of blocks) {
  const modifiers = queuedContextModifiers[block.id]
  if (!modifiers) continue
  for (const modifier of modifiers) {
    currentContext = modifier(currentContext)
  }
}
```

### 1.5 工具结果 -> LLM 反馈循环

每次工具执行生成一个 `MessageUpdate`，包含一条带有 `tool_result` 内容块的 user 消息：

```typescript
// toolExecution.ts
message: createUserMessage({
  content: [{
    type: 'tool_result',
    content: outputContent,  // stdout 文本或错误消息
    is_error: boolean,
    tool_use_id: toolUse.id,
  }],
  toolUseResult: summaryString,
  sourceToolAssistantUUID: assistantMessage.uuid,
})
```

这些 tool_result 消息被累积并在下一次 API 调用中反馈给 LLM。Anthropic API 格式要求 tool_result 块引用原始的 tool_use id，形成闭环。

### 1.6 AgentHub Runner 集成

AgentHub Runner executor 应采用相同的分区优先模型：

```go
// packages/executor/orchestrator.go

type ToolBatch struct {
    IsConcurrencySafe bool
    Blocks            []ToolCall
}

// PartitionToolCalls 将相邻的并发安全工具分组为批次。
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

// Executor 运行分区后的工具调用。
type Executor struct {
    MaxConcurrency int           // 默认 10
    PolicyEngine   *PolicyEngine // 安全审批
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

## 2. Bash 安全检查管道

### 2.1 架构

Claude Code 的 bash 安全是一个**由 23 个独立 validator 函数组成的管道**，每个函数返回 `passthrough`（无问题）、`ask`（需要用户审批）或 `allow`（明确安全）。管道有序排列：early-allow validator 先运行，然后是 misparsing validator（在入口处阻断），最后是 non-misparsing validator（走标准权限流程）。

```
bashCommandIsSafe(command):
  1. CONTROL_CHAR_RE 检查（预处理守卫）
  2. shell-quote 单引号 bug 检查（预处理守卫）
  3. extractHeredocs（剥离带引号的 heredoc 正文）
  4. extractQuotedContent -> ValidationContext
  5. EARLY VALIDATORS（allow -> passthrough 返回）：
     - validateEmpty（空命令安全）
     - validateIncompleteCommands（tab 开头、flag 开头、操作符开头 -> ask）
     - validateSafeCommandSubstitution（$(cat <<'EOF') -> allow）
     - validateGitCommit（安全 git commit -> allow）
  6. MAIN VALIDATORS（有序，含延迟 non-misparsing）：
     [见下方完整列表]
```

### 2.2 完整 Validator 目录（23 项检查）

| # | Validator | 检查 ID | 类别 | 触发时行为 |
|---|-----------|----------|----------|---------------------|
| 1 | `validateEmpty` | - | Early-allow | `allow`（空命令安全） |
| 2 | `validateIncompleteCommands` | INCOMPLETE_COMMANDS | Early-ask | 子项-1：tab 开头；子项-2：`-` 开头；子项-3：`&&`/`\|\|`/`;`/`>>`/`<` 开头 |
| 3 | `validateSafeCommandSubstitution` | - | Early-allow | `allow` 用于 `$(cat <<'DELIM')`；验证 heredoc 正文为字面文本、无嵌套 heredoc、替换不在命令名位置 |
| 4 | `validateGitCommit` | GIT_COMMIT_SUBSTITUTION | Early-ask | 如果 commit message 包含 `$()` 或反引号则 `ask` |
| 5 | `validateJqCommand` | JQ_SYSTEM_FUNCTION / JQ_FILE_ARGUMENTS | Misparsing | 如果 jq 使用 `system`/`env`/`input_filename` 或 `--rawfile`/`--slurpfile` 写入则 `ask` |
| 6 | `validateObfuscatedFlags` | OBFUSCATED_FLAGS | Misparsing | 阻断 ANSI-C 引用（`$'...'`）、locale 引用（`$"..."`）、横线前空引号（`""-f`）、横线 8 字符内引号拼接混淆 |
| 7 | `validateShellMetacharacters` | SHELL_METACHARACTERS | Misparsing | 引号内 `find -name` / `-path` / `-regex` 参数中出现 `;` `\|` `&` 时 `ask` |
| 8 | `validateDangerousVariables` | DANGEROUS_VARIABLES | Misparsing | 变量出现在重定向/管道上下文中时 `ask`：`[<>\|]\s*$VAR` 或 `$VAR\s*[<>\|]` |
| 9 | `validateCommentQuoteDesync` | COMMENT_QUOTE_DESYNC | Misparsing | `#` 注释中包含可能导致引号跟踪不同步的引号字符时 `ask` |
| 10 | `validateQuotedNewline` | QUOTED_NEWLINE | Misparsing | 引号内 `\n` 后跟 `#` 前缀行时 `ask`（对基于行的检查隐藏参数） |
| 11 | `validateCarriageReturn` | - | Misparsing | 命令中出现 `\r` 时 `ask`（shell-quote 将 CR 视为 token 边界，bash 不视为——解析器差异） |
| 12 | `validateNewlines` | NEWLINES | Non-misparsing | 非引号内换行后跟非空白字符时 `ask`（不包括 `\<newline>` 续行） |
| 13 | `validateIFSInjection` | IFS_INJECTION | Misparsing | `$IFS` 或 `${...IFS...}` 模式时 `ask` |
| 14 | `validateProcEnvironAccess` | PROC_ENVIRON_ACCESS | Misparsing | 访问 `/proc/*/environ` 时 `ask` |
| 15 | `validateDangerousPatterns` | DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION | Misparsing | 反引号（未转义）+ 12 种替换模式：`<()` `>()` `=()` Zsh `=cmd` 展开、`$()` `${}` `$[]` `~[]` `(e:` `(+` `}\s*always\s*{` `<#`（PowerShell） |
| 16 | `validateRedirections` | DANGEROUS_PATTERNS_INPUT_REDIRECTION / OUTPUT_REDIRECTION | Non-misparsing | 完全去引号内容中出现 `<` 或 `>` 时 `ask`（剥离 `>/dev/null` 和 `2>&1` 之后） |
| 17 | `validateBackslashEscapedWhitespace` | BACKSLASH_ESCAPED_WHITESPACE | Misparsing | 可能改变解析的 `\<whitespace>` 模式时 `ask` |
| 18 | `validateBackslashEscapedOperators` | BACKSLASH_ESCAPED_OPERATORS | Misparsing | `\;` `\|` `\&` `\<` `\>` 时 `ask`——splitCommand 将 `\;` 规范化为裸 `;`，导致双重解析 bug |
| 19 | `validateUnicodeWhitespace` | UNICODE_WHITESPACE | Misparsing | `     -          　 ﻿` 时 `ask` |
| 20 | `validateMidWordHash` | MID_WORD_HASH | Misparsing | `\S#`（非空白后跟 `#`）时 `ask`——shell-quote 视为注释开始，bash 视为字面量 |
| 21 | `validateBraceExpansion` | BRACE_EXPANSION | Misparsing | 3 个子检查：(1) 最外层深度未转义 `{` 带 `,`/`..` -> 花括号展开；(2) 去除引号后多出 `}`（引号花括号混淆）；(3) 非引号 `{..}` 上下文中出现引号花括号字符 `'{'` |
| 22 | `validateZshDangerousCommands` | ZSH_DANGEROUS_COMMANDS | Misparsing | 阻断 18 条 Zsh 命令：`zmodload em emulate sysopen sysread syswrite sysseek zpty ztcp zsocket mapfile zf_rm zf_mv zf_ln zf_chmod zf_chown zf_mkdir zf_rmdir zf_chgrp`；同时阻断 `fc -e` |
| 23 | `validateMalformedTokenInjection` | MALFORMED_TOKEN_INJECTION | Misparsing | 命令同时包含 `;`/`&&`/`\|\|` 操作符和未平衡 token 分隔符时 `ask`（来自 HackerOne 审查的 eval 绕过） |

### 2.3 预处理守卫（在 validator 运行之前）

**控制字符**（在其他任何检查之前）：
```typescript
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
// 排除 tab（0x09）、换行（0x0A）、回车（0x0D）
// Bash 静默丢弃 null 字节并忽略大多数控制字符
```

**Shell-quote 单引号 bug**（在 shell-quote 解析之前检查）：
```typescript
if (hasShellQuoteSingleQuoteBug(command)) {
  return { behavior: 'ask', ... }
}
// 检测单引号内 shell-quote 错误处理的反射杠模式
```

**Heredoc 剥离**（在引号提取之前运行）：
```typescript
const { processedCommand } = extractHeredocs(command, { quotedOnly: true })
// 仅剥离带引号/转义定界符的正文（<<'EOF'、<<\EOF）
// 非引号 heredocs（<<EOF）保持原样——其正文可能含有 $() 展开
```

### 2.4 Misparsing 与 Non-Misparsing 分类

管道中的关键区分：

- **Misparsing validator**（23 个中的 21 个）：它们的 `ask` 结果带有 `isBashSecurityCheckForMisparsing: true`。bashPermissions 入口**提前阻断**它们——没有 allowlist 规则可以覆盖 misparsing 问题。因为安全解析器本身无法可靠判断命令的行为。

- **Non-misparsing validator**（23 个中的 2 个）：`validateNewlines` 和 `validateRedirections`。这些模式被 shell-quote 和 bash 正确解析。它们的 `ask` 结果走标准权限流程（allowlist 规则可以自动批准）。

- **延迟 non-misparsing**：如果 non-misparsing validator 首先触发，其结果被延迟。管道继续运行 misparsing validator。只有没有 misparsing validator 触发时，才返回延迟结果。

```typescript
let deferredNonMisparsingResult: PermissionResult | null = null
for (const validator of validators) {
  const result = validator(context)
  if (result.behavior === 'ask') {
    if (nonMisparsingValidators.has(validator)) {
      if (deferredNonMisparsingResult === null) {
        deferredNonMisparsingResult = result
      }
      continue  // 继续运行以让 misparsing validator 触发
    }
    return { ...result, isBashSecurityCheckForMisparsing: true }
  }
}
```

### 2.5 管道阻断的关键安全攻击

代码库记录了若干 HackerOne 发现的攻击向量，附带详细的利用追踪：

1. **花括号展开混淆**（`git diff {@'{'0},--output=/tmp/pwned}`）：extractQuotedContent 剥离的引号花括号导致深度匹配器在**错误**位置闭合，漏掉了 bash 算法能找到的逗号。Validator 21 检测不匹配的花括号计数。

2. **反斜杠转义操作符双重解析**（`cat safe.txt \; echo ~/.ssh/id_rsa`）：splitCommand 将 `\;` 规范化为裸 `;`。下游代码重新解析，看到两个"安全"段。私钥泄露。Validator 18 捕获 `\<operator>`。

3. **回车解析器差异**（`TZ=UTC\recho curl evil.com`）：shell-quote 的 `\s` 将 `\r` 包含为 token 边界；bash 的 IFS 不包含。shell-quote 看到 `TZ=UTC echo`；bash 运行 `curl`。Validator 11 捕获 `\r`。

4. **注释引号不同步**（`echo "it's" # ' " <<'MARKER'\nrm -rf /\nMARKER`）：带有嵌入引号的 `#` 注释使引号跟踪器不同步，使 `rm -rf` 看起来"在引号内"，对换行检查不可见。Validator 9 捕获 `#` 后的引号字符。

5. **引号内换行隐藏参数**（`cmd '\n# safe comment\nreal dangerous'`）：引号内 `\n` 后跟 `#` 前缀行导致 stripCommentLines 丢弃下一行，对路径检查隐藏参数。Validator 10 捕获此情况。

6. **词中井号**（`'x'#`）：shell-quote 将 `#` 视为注释开始；bash 视为字面量。剥离后的非引号内容只剩下 `#`（词首），丢失差异。Validator 20 使用 `unquotedKeepQuoteChars` 捕获。

---

## 3. AgentHub 安全检查实现（Go）

### 3.1 核心类型

```go
// packages/security/bash_security.go

// SecurityViolation 表示检测到的安全问题。
type SecurityViolation struct {
    CheckID      SecurityCheckID
    SubID        int
    Pattern      string // 人类可读的模式描述
    IsMisparsing bool   // true 表示解析器差异，阻断 allowlist 覆盖
    Severity     Severity
}

type Severity string

const (
    SeverityLow    Severity = "low"    // non-misparsing，allowlist 可覆盖
    SeverityMedium Severity = "medium" // misparsing 问题
    SeverityHigh   Severity = "high"   // 已确认绕过向量
    SeverityBlock  Severity = "block"  // 始终拒绝
)

// CheckContext 携带 validator 所需的已解析命令状态。
type CheckContext struct {
    OriginalCommand      string
    BaseCommand          string
    UnquotedContent      string // 双引号已剥离
    FullyUnquotedContent string // 所有引号已剥离，安全重定向已移除
    FullyUnquotedPreStrip string // stripSafeRedirections 之前
    UnquotedKeepQuoteChars string // 引号保留，内容已剥离
    TreeSitterAST        *TreeSitterAnalysis // 可选 AST 用于权威解析
}

// SecurityValidator 是一次安全检查。
type SecurityValidator func(cmd string, ctx CheckContext) *SecurityViolation
```

### 3.2 Validator 实现

#### 检查 1：空命令（early-allow）

```go
func ValidateEmpty(ctx CheckContext) *SecurityViolation {
    if strings.TrimSpace(ctx.OriginalCommand) == "" {
        return nil // passthrough -> allow
    }
    return nil
}
```

#### 检查 2：不完整命令（early-ask）

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

#### 检查 3-4：Heredoc 与 Git Commit（early-allow/ask）

```go
var heredocInSubstitution = regexp.MustCompile(`\$\(.*<<`)

func ValidateSafeCommandSubstitution(ctx CheckContext) *SecurityViolation {
    if !heredocInSubstitution.MatchString(ctx.OriginalCommand) {
        return nil
    }
    if isSafeHeredoc(ctx.OriginalCommand) {
        return nil // early-allow：安全 heredoc 模式
    }
    return nil // 交由主 validator 处理
}

func ValidateGitCommit(ctx CheckContext) *SecurityViolation {
    // 如果 commit message（-m）包含 $() 或反引号替换则 ask
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

#### 检查 5：JQ 危险函数

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

#### 检查 6：混淆 Flags（ANSI-C 引用、空引号绕过）

```go
var ansiCQuoteRe = regexp.MustCompile(`\$'[^']*'`)
var localeQuoteRe = regexp.MustCompile(`\$"[^"]*"`)
var emptyQuoteDashRe = regexp.MustCompile(`(?m)(?:^|\s)(?:''|"")+\s*-`)
var conjugateDashRe = regexp.MustCompile(`([\x27\x22]{2,})\s{0,8}-`)

func ValidateObfuscatedFlags(ctx CheckContext) *SecurityViolation {
    // echo 是安全的
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
    // 引号拼接混淆：\"\"\"\\s{0,8}-
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

#### 检查 7-8：Shell 元字符与危险变量

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

#### 检查 9-11：注释不同步、引号内换行、回车

```go
func ValidateCommentQuoteDesync(ctx CheckContext) *SecurityViolation {
    if ctx.TreeSitterAST != nil {
        return nil // AST 是权威的，不可能不同步
    }
    // 扫描：同一行内非引号 # 后跟引号字符
    // 详细引号状态机（见第 2.5 节，攻击 #4）
    ...
}

func ValidateQuotedNewline(ctx CheckContext) *SecurityViolation {
    if !strings.Contains(ctx.OriginalCommand, "\n") ||
       !strings.Contains(ctx.OriginalCommand, "#") {
        return nil
    }
    // 扫描：引号内 \n，下一行以 # 开头 -> ask
    ...
}

func ValidateCarriageReturn(ctx CheckContext) *SecurityViolation {
    if !strings.Contains(ctx.OriginalCommand, "\r") {
        return nil
    }
    return &SecurityViolation{
        CheckID: CheckControlCharacters, // 复用控制字符 ID
        Pattern: "carriage return causes parser differential",
        IsMisparsing: true, Severity: SeverityHigh,
    }
}
```

#### 检查 12：换行（non-misparsing）

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

#### 检查 13：IFS 注入

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

#### 检查 14：/proc/*/environ 访问

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

#### 检查 15：命令替换模式（12 种模式 + 反引号）

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
    // 状态机：跳过反斜杠转义字符，检测裸 `
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

#### 检查 16-18：重定向、反斜杠转义

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

// hasBackslashEscapedOperator：跟踪单/双引号状态的状态机，
// 检测双引号外的 \<operator>（在双引号内是安全的）。
// 关键：反斜杠检查在引号切换之前运行（见第 2.5 节，攻击 #2）。
```

#### 检查 19-21：Unicode、词中井号、花括号展开

```go
var unicodeWSRe = regexp.MustCompile(
    `[   -     　﻿]`)

func ValidateUnicodeWhitespace(ctx CheckContext) *SecurityViolation { ... }

var midWordHashRe = regexp.MustCompile(`\S(?<!\$\{)#`)

func ValidateMidWordHash(ctx CheckContext) *SecurityViolation {
    // 检查原始版本和续行合并版本
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
    // 子项-2：去除引号后花括号计数不匹配
    open, close := countUnescapedBraces(content)
    if open > 0 && close > open {
        return &SecurityViolation{
            CheckID: CheckBraceExpansion, SubID: 2,
            Pattern: "excess closing braces after quote stripping",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    // 子项-3：非引号花括号上下文中出现引号花括号
    if open > 0 && quotedBraceRe.MatchString(ctx.OriginalCommand) {
        return &SecurityViolation{
            CheckID: CheckBraceExpansion, SubID: 3,
            Pattern: "quoted brace char inside brace context (obfuscation)",
            IsMisparsing: true, Severity: SeverityHigh,
        }
    }
    // 子项-1：在最外层嵌套级别扫描 {a,b} 或 {a..b}
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

#### 检查 22：Zsh 危险命令（18 条命令 + fc -e）

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
            continue // 环境变量赋值
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

#### 检查 23：畸形 Token 注入（eval 绕过）

```go
func ValidateMalformedTokenInjection(ctx CheckContext) *SecurityViolation {
    tokens := tryParseShellCommand(ctx.OriginalCommand)
    if tokens == nil {
        return nil // 由其他地方处理
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

### 3.3 管道编排器（Go）

```go
// SecurityPipeline 按顺序运行所有 validator，返回第一个阻断结果。
// 镜像 CC 优先级：early-allow -> misparsing -> deferred non-misparsing。
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
    // 预处理：控制字符
    if p.ControlCharRe.MatchString(command) {
        return &SecurityViolation{
            CheckID: CheckControlCharacters,
            Pattern: "non-printable control characters",
            IsMisparsing: true, Severity: SeverityBlock,
        }
    }

    // 预处理：提取 heredocs（仅引号类型）
    processedCmd := extractHeredocs(command, true)

    // 构建上下文
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

    // Early validators（allow -> 返回 nil）
    for _, v := range p.EarlyValidators {
        result := v(command, ctx)
        if result != nil {
            if result.Severity == SeverityLow {
                return nil // early-allow（安全 heredoc、空命令、安全 git）
            }
            return result
        }
    }

    // 主 validator，含延迟 non-misparsing
    var deferred *SecurityViolation
    for _, v := range p.MisparsingValidators {
        if result := v(command, ctx); result != nil {
            return result // misparsing -> 立即阻断
        }
    }
    for _, v := range p.NonMisparsingValidators {
        if result := v(command, ctx); result != nil {
            deferred = result // non-misparsing -> 延迟
        }
    }
    if deferred != nil {
        return deferred
    }

    return nil // 安全
}
```

### 3.4 SecurityCheckID 枚举（Go）

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

## 4. 超时与后台化策略

### 4.1 Claude Code 常量

```typescript
// BashTool.tsx
const PROGRESS_THRESHOLD_MS = 2000;           // 2s 后显示进度
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;  // assistant 模式下 15s 后自动后台化

// BashTool/prompt.ts
export function getDefaultTimeoutMs(): number { return 120_000 } // 2 分钟
export function getMaxTimeoutMs(): number { return 600_000 }     // 10 分钟
```

### 4.2 后台化流程

```
Command starts
  |
  +-- 2s (PROGRESS_THRESHOLD_MS): 如果仍在运行，显示进度 UI
  |
  +-- 15s (ASSISTANT_BLOCKING_BUDGET_MS): 如果在 Kairos/assistant 模式，
  |     命令自动后台化。命令继续运行；
  |     agent 获得 backgroundTaskId，可以继续工作。
  |
  +-- 120s (default timeout): 如果被配置，终止命令。
  |
  +-- 600s (max timeout): 硬限制；SIGKILL。
```

后台结果通知：
```typescript
backgroundInfo = `Command exceeded the assistant-mode blocking budget (${
  ASSISTANT_BLOCKING_BUDGET_MS / 1000}s) and was moved to the background
  with ID: ${backgroundTaskId}. It is still running — you will be notified
  when it completes. Output is being written to: ${outputPath}.`
```

### 4.3 AgentHub 超时策略

```go
// packages/executor/timeout.go

type TimeoutConfig struct {
    ProgressThreshold time.Duration // 2s  — 显示"Running..."反馈
    BlockingBudget    time.Duration // 15s — 此后自动后台化
    DefaultTimeout    time.Duration // 120s — 默认超时
    MaxTimeout        time.Duration // 600s — 用户指定的最大值
}

type TimeoutStrategy int

const (
    TimeoutStrategyDefault     TimeoutStrategy = iota // 120s 超时，15s 后台化
    TimeoutStrategyInteractive                        // 更短：30s 后台化
    TimeoutStrategyBatch                              // 更长：300s 超时
    TimeoutStrategyBackground                         // 无阻断预算
)

// BackgroundContext 保存已转入后台任务的状态。
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

### 4.4 Executor 中的超时执行

```go
func (e *Executor) runWithTimeout(
    ctx context.Context,
    call ToolCall,
    cfg TimeoutConfig,
) (*ToolResult, error) {
    // 创建带超时的子上下文
    timeout := call.Timeout
    if timeout == 0 {
        timeout = cfg.DefaultTimeout
    }
    if timeout > cfg.MaxTimeout {
        timeout = cfg.MaxTimeout
    }
    execCtx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    // 超过阈值后发出进度通知
    progressTimer := time.NewTimer(cfg.ProgressThreshold)
    defer progressTimer.Stop()

    // 自动后台化定时器（仅 assistant 模式）
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
            // 向流发出进度事件
            e.emitProgress(call, "still running...")
        case <-bgTimer.C:
            // 转入后台
            return e.moveToBackground(ctx, call, execCtx, resultCh, errCh), nil
        case <-execCtx.Done():
            return nil, execCtx.Err()
        }
    }
}
```

---

## 5. AgentHub PolicyEngine 设计

### 5.1 架构

```
Agent CLI requests tool execution
  |
  Runner ToolEngine intercepts
  |
  PolicyEngine.Evaluate(toolCall, evalCtx)
  |
  +-- Pre-check: SecurityPipeline.Evaluate(command) -> violation?
  |     |
  |     +-- SeverityBlock? -> DENY（不提示用户）
  |     +-- SeverityHigh? -> 标记为强制 ask
  |
  +-- Rule evaluation（按优先级排序）
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

### 5.2 PolicyEngine 接口与实现

```go
// packages/security/policy_engine.go

// PolicyEngine 根据配置的规则和安全检查评估工具调用。
// 规则按优先级排序；首个匹配即胜出（停止处理）。
// 安全管道在规则之前运行，以处理阻断性违规。
type PolicyEngine struct {
    rules             []PolicyRule        // 按 Priority 排序
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

// Evaluate 确定工具调用的决策。
// 流程：
//   1. BypassPermissions 模式：自动允许（仍运行只读检查）
//   2. Plan 模式：仅允许只读工具
//   3. 检查缓存决策（per-thread、per-session 作用域）
//   4. 对 bash 命令运行安全管道
//   5. 匹配高风险模式（自动拒绝模式）
//   6. 按优先级顺序评估 policy rules
//   7. 基于 ToolDescriptor 的默认行为
func (pe *PolicyEngine) Evaluate(
    toolCall ToolCall,
    ctx EvalContext,
) *ApprovalDecision {

    // 快速路径：bypass 模式
    if ctx.PermissionMode == "bypassPermissions" {
        if toolCall.IsReadOnly {
            return &ApprovalDecision{
                Type:    DecisionAccept,
                Reason:  "bypassPermissions mode (read-only)",
                DecidedBy: "system",
                Scope:   ScopeOnce,
            }
        }
        // bypass 模式下的写入工具仍然自动接受（用户选择加入）
        return &ApprovalDecision{
            Type:    DecisionAccept,
            Reason:  "bypassPermissions mode",
            DecidedBy: "system",
            Scope:   ScopeOnce,
        }
    }

    // Plan 模式：仅允许只读
    if ctx.PermissionMode == "plan" && !toolCall.IsReadOnly {
        return &ApprovalDecision{
            Type:    DecisionDecline,
            Reason:  "plan mode: write tool blocked",
            DecidedBy: "system",
            Scope:   ScopeOnce,
        }
    }

    // 缓存查找
    if d := pe.lookupCache(toolCall, ctx); d != nil {
        return d
    }

    // 安全管道（仅 bash 命令）
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
                    // 强制用户审批（绕过 allowlist）
                    return &ApprovalDecision{
                        Type:      DecisionAccept, // 将在 Edge 中被 ASK_USER 覆盖
                        Reason:    fmt.Sprintf("security concern: %s", violation.Pattern),
                        DecidedBy: "system",
                        Scope:     ScopeOnce,
                        // SecurityViolation 附加用于 UI 展示
                    }
                }
            }
        }
    }

    // 高风险模式匹配（自动拒绝模式）
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

    // Policy rule 评估（优先级顺序，首个匹配即胜出）
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
            // 落到默认行为
            break
        case PolicyEscalate:
            return &ApprovalDecision{
                Type:      DecisionAccept,
                Reason:    "escalated to admin",
                DecidedBy: "system",
                Scope:     ScopeOnce,
                // 升级到管理员审批流程
            }
        }
    }

    // 默认行为
    if toolCall.RequiresApproval {
        return &ApprovalDecision{
            Type:      DecisionAccept,
            Reason:    "requires user approval (default)",
            DecidedBy: "system",
            Scope:     ScopeOnce,
        }
    }

    // 自动允许
    return &ApprovalDecision{
        Type:      DecisionAccept,
        Reason:    "auto-allowed (no rules matched, low risk)",
        DecidedBy: "system",
        Scope:     ScopeOnce,
    }
}

// matchRule 检查 policy rule 是否匹配给定的工具调用和上下文。
func (pe *PolicyEngine) matchRule(
    rule PolicyRule,
    toolCall ToolCall,
    ctx EvalContext,
) bool {
    match := rule.Match

    // 工具模式匹配（glob）
    if match.ToolPattern != "" {
        if !globMatch(match.ToolPattern, toolCall.ToolName) {
            return false
        }
    }

    // 工具输入键匹配
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

    // 路径模式匹配
    if match.PathPattern != "" {
        path, _ := toolCall.Input["file_path"].(string)
        if !globMatch(match.PathPattern, path) {
            return false
        }
    }

    // 风险级别匹配
    if match.RiskLevel != nil {
        if toolCall.RiskLevel != *match.RiskLevel {
            return false
        }
    }

    // Agent 匹配
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

    // 检查 per-session 作用域
    key := fmt.Sprintf("session:%s:%s", ctx.SessionID, toolCall.ToolName)
    if cached, ok := pe.decisionCache[key]; ok {
        if cached.Scope == ScopeSession &&
           time.Now().Before(cached.ExpiresAt) {
            return cached.Decision
        }
    }

    // 检查 per-thread 作用域
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
    // 缓存 per-session/per-thread 作用域的决策
    ...
    return nil
}
```

### 5.3 PolicyRule 优先级体系

```go
// 优先级值匹配 CC 的 9 源优先级系统：
// 数字越小 = 优先级越高（先检查）

const (
    PriorityCLIFlag        = 0   // --approve-bash, --dangerously-skip-permissions
    PrioritySessionRule    = 100 // 用户在运行时批准"本次会话"
    PriorityUserSettings   = 200 // ~/.agenthub/settings.json
    PriorityProjectLocal   = 300 // .agenthub/rules.json（项目本地）
    PriorityAgentConfig    = 400 // 逐 agent 配置
    PriorityTeamPolicy     = 500 // 来自 Hub 的团队级策略
    PriorityEnterprisePolicy = 600 // 组织级策略
    PrioritySystemDefault  = 700 // 内置高风险模式
    PriorityCatchAll       = 1000 // 默认 allow/deny
)
```

### 5.4 HighRiskPattern 匹配器

```go
type HighRiskPattern struct {
    ID          string
    Name        string
    Pattern     string // 正则表达式
    Category    ApprovalKind
    AutoDeny    bool   // true = 无需用户提示即拒绝
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
        Pattern: `^/[^w]`, // 简化占位
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

## 6. 集成：Runner Executor + PolicyEngine

### 6.1 端到端工具执行流程

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
                // 1. 安全与策略评估
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

                // 2. 带超时执行
                result, err := e.runWithTimeout(ctx, call, e.timeout)
                if err != nil {
                    results <- ToolResult{
                        ToolCallID: call.ID,
                        IsError:    true,
                        Content:    err.Error(),
                    }
                    continue
                }

                // 3. 记录权限决策以供缓存
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

### 6.2 PermissionBroker 集成（适配器 SDK）

`PermissionBroker` 接口（来自 `design-adapter-sdk.md`）在 runner 的策略引擎与底层 agent CLI 之间建立桥梁：

```go
// 当 agent adapter 发出权限请求时：
func (a *Adapter) ResolvePermission(
    ctx context.Context,
    req ToolPermissionRequest,
) (*PermissionDecision, error) {
    // 映射到 PolicyEngine.Evaluate
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

## 7. 总结：关键设计决策

| 方面 | Claude Code（TypeScript） | AgentHub（Go） |
|--------|--------------------------|---------------|
| **分区** | 相邻只读工具合并为并发批次 | 相同：`PartitionToolCalls()` |
| **并发上限** | 10（环境变量：`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`） | 10（可配置） |
| **上下文流转** | 串行：即时；并发：批次后排队 | 相同：批次完成屏障 |
| **安全检查** | 23 个 validator 组成有序管道 | 23 个 validator 在 `SecurityPipeline` 中 |
| **Misparsing 门控** | `isBashSecurityCheckForMisparsing` 标志提前阻断 | `SecurityViolation.IsMisparsing` |
| **Heredoc 处理** | 基于行的匹配，复现 bash 行为 | 相同：`extractHeredocs()` |
| **超时** | 默认 120s，最大 600s，15s 自动后台化 | 相同：`TimeoutConfig` 结构体 |
| **策略引擎** | 9 源优先级，首个匹配即胜出 | 相同：`PolicyEngine` 优先级排序规则 |
| **权限缓存** | per-session、per-thread 作用域 | `CachedDecision` 含 session/thread 键 |
| **高风险模式** | 8 个内置模式 | 7 个内置模式（可扩展） |

### 输出文件

- `packages/security/bash_security.go` -- 23 个安全 validator
- `packages/security/security_pipeline.go` -- 管道编排器
- `packages/security/policy_engine.go` -- PolicyEngine 接口 + 实现
- `packages/executor/orchestrator.go` -- PartitionToolCalls + Executor
- `packages/executor/timeout.go` -- TimeoutConfig + BackgroundContext
- `packages/executor/runner_executor.go` -- 集成 PolicyEngine 的 RunnerExecutor
