# Claude Code SDK → AgentHub 源码级采纳映射表

> 分析日期：2026-05-24
> 数据来源：Claude Code 28 hooks + 23 security checks + 6 compaction layers → AgentHub Go 源码对照
> 现有文档：`01-overview.md`, `02-tool-security.md`, `03-context-compaction.md`, `00-synthesis.md`
> AgentHub 源码：`edge-server/internal/adapters/`, `edge-server/internal/security/`, `edge-server/internal/runnerctx/`, `edge-server/internal/lifecycle/`

---

## 1. Hook 系统映射：28 CC hooks → 6 AgentHub 核心接口

### 1.1 Claude Code 的 28 个 Hook 事件

来源：`src/entrypoints/sdk/coreTypes.ts:25-52`

| # | CC Hook 事件 | 分类 | AgentHub 映射 | 接口方法 | 优先级 |
|---|-------------|------|--------------|---------|:---:|
| 1 | `PreToolUse` | 工具前拦截 | **已实现**: `AgentHook.PreToolUse()` | hooks.go:41 | P0 |
| 2 | `PostToolUse` | 工具后处理 | **已实现**: `AgentHook.PostToolUse()` | hooks.go:44 | P0 |
| 3 | `PostToolUseFailure` | 工具错误 | **已实现**: `AgentHook.OnError()` | hooks.go:50 | P0 |
| 4 | `Notification` | 通知 | **缺失** — 无独立通知 hook | — | P2 |
| 5 | `UserPromptSubmit` | 用户输入前 | **已实现**: `AgentHook.PrePrompt()` | hooks.go:53 | P1 |
| 6 | `SessionStart` | 会话开始 | **缺失** — 通过 `BusEventSessionInit` 事件间接实现 | — | P1 |
| 7 | `SessionEnd` | 会话结束 | **缺失** — 通过 `BusEventResult` + `run.finished` 间接实现 | — | P1 |
| 8 | `Stop` | 停止时 | **缺失** — 无等价 hook | — | P2 |
| 9 | `StopFailure` | 停止失败 | **缺失** — 无等价 hook | — | P2 |
| 10 | `SubagentStart` | 子代理启动 | **部分**: `BusEventTaskStarted` 事件 | — | P1 |
| 11 | `SubagentStop` | 子代理停止 | **部分**: `BusEventTaskNotification` 事件 | — | P1 |
| 12 | `PreCompact` | 压缩前 | **缺失** — ContextBudget 无 hook 回调 | — | P2 |
| 13 | `PostCompact` | 压缩后 | **缺失** — 同 PreCompact | — | P2 |
| 14 | `PermissionRequest` | 权限请求 | **已实现**: `AgentHook.PermissionRequest()` | hooks.go:47 | P0 |
| 15 | `PermissionDenied` | 权限拒绝 | **部分**: PermissionDecision=PermDeny 隐式覆盖 | hooks.go:50 | P1 |
| 16 | `Setup` | 初始化 | **缺失** — 无等价 setup hook | — | P2 |
| 17 | `TeammateIdle` | 队友空闲 | **缺失** — 无跨 agent 协调 hook | — | P2 |
| 18 | `TaskCreated` | 任务创建 | **缺失** — 无等价 | — | P2 |
| 19 | `TaskCompleted` | 任务完成 | **缺失** — 无等价 | — | P2 |
| 20 | `Elicitation` | 信息征询 | **缺失** — 无等价 | — | P2 |
| 21 | `ElicitationResult` | 征询结果 | **缺失** — 无等价 | — | P2 |
| 22 | `ConfigChange` | 配置变更 | **缺失** — 无等价 | — | P2 |
| 23 | `InstructionsLoaded` | 指令加载 | **缺失** — CLI 内部处理 | — | P2 |
| 24 | `WorktreeCreate` | Worktree 创建 | **缺失** — AgentHub 自身处理 worktree | — | P1 |
| 25 | `WorktreeRemove` | Worktree 删除 | **缺失** — AgentHub 自身处理 worktree | — | P1 |
| 26 | `CwdChanged` | 目录变更 | **缺失** — 无等价 | — | P2 |
| 27 | `FileChanged` | 文件变更 | **部分**: `BusEventFileChange` 事件 | adapter.go:79 | P1 |
| 28 | `PrePrompt` | 提示前 | 通过 `PrePrompt` 覆盖 | hooks.go:53 | P1 |
| 29 | `PostResponse` | 响应后 | **已实现**: `AgentHook.PostResponse()` | hooks.go:56 | P1 |

### 1.2 AgentHub 6 核心 Hook 接口实现位置

**CC 源码**: `src/entrypoints/sdk/coreTypes.ts:25-52` (事件枚举)
**CC 源码**: `src/utils/hooks/hooksConfigManager.ts:270-392` (hook 分组注册)

**AgentHub 源码**: `edge-server/internal/adapters/hooks.go:39-57`

```go
// hooks.go:39 — 6 核心接口收敛自 28 个 CC hooks
type AgentHook interface {
    PreToolUse(ctx, toolName, input)        → CC: PreToolUse
    PostToolUse(ctx, toolName, output)      → CC: PostToolUse
    PermissionRequest(ctx, toolName, risk)   → CC: PermissionRequest
    OnError(ctx, err)                       → CC: PostToolUseFailure + StopFailure
    PrePrompt(ctx, prompt)                  → CC: UserPromptSubmit + PrePrompt
    PostResponse(ctx, response)             → CC: (PostToolUse 批处理后)
}
```

**HookChain 中间件模式**: `hooks.go:60-122`

CC 的 hook 链执行逻辑（`hooksConfigManager.ts`）按 event+matcher 三级分组 → AgentHub 的 `HookChain` 按顺序遍历，首个阻断即停止：

```go
// hooks.go:63 — PreToolUse 链: 首个 block=true 停止
func (c HookChain) RunPreToolUse(...) { ... }
// hooks.go:85 — PermissionRequest 链: 首个非 Allow 即胜出
func (c HookChain) RunPermissionRequest(...) { ... }
```

### 1.3 Hook 配置格式对比

| 维度 | Claude Code (TypeScript) | AgentHub (Go) |
|------|--------------------------|---------------|
| 配置位置 | `settings.json` `hooks` 字段 | 代码内注册（`HookChain{}`） |
| Hook 类型 | 4 种: command/prompt/agent/http | 1 种: Go interface 实现 |
| Matcher 语法 | `"Bash(git *)"` 权限规则语法 | 无 — 在 `PreToolUse` 内自行判断 toolName |
| 退出码语义 | exit 0/2/other 三态 | block bool + reason string |
| 异步支持 | `async: true` + `asyncRewake` | 无 — 同步执行 |
| 超时 | per-hook `timeout` 字段 | 无 — 由调用方 context 控制 |
| 来源分层 | settings/plugins/built-in 3 层 | 代码级 `HookChain` 单层 |

### 1.4 缺失 Hook 的覆盖策略

| CC Hook | 覆盖机制 | 实现位置 |
|---------|---------|---------|
| SessionStart | `BusEventSessionInit` 事件 → 前端监听 | parser_ndjson.go:273 |
| SessionEnd | `BusEventResult` + `run.finished` 事件 | parser_ndjson.go:249, process_executor.go:266 |
| SubagentStart/Stop | `BusEventTaskStarted/Notification` 事件 | parser_ndjson.go:339,366 |
| FileChanged | `BusEventFileChange` 事件 | parser_ndjson.go:296 |
| PreCompact/PostCompact | 无 — 待实现 CompactionHook | — |
| ConfigChange | 无 — 可通过 `BusEventStatusChange` 感知 | parser_ndjson.go:318 |
| WorktreeCreate/Remove | AgentHub 自管理 worktree 生命周期 | — |

---

## 2. 安全管道映射：23 CC 检查 → AgentHub SecurityHook

### 2.1 Claude Code 23 项安全检查

来源：`src/tools/BashTool/bashSecurity.ts` (105KB)

| # | CC Validator | 检查 ID | 分类 | AgentHub 映射 | 源位置 |
|---|-------------|----------|------|--------------|--------|
| 1 | `validateEmpty` | — | Early-allow | **部分**: SecurityHook 不检查空命令 | — |
| 2 | `validateIncompleteCommands` | INCOMPLETE_COMMANDS | Early-ask | **缺失** | — |
| 3 | `validateSafeCommandSubstitution` | — | Early-allow | **缺失** — heredoc 安全分析未实现 | — |
| 4 | `validateGitCommit` | GIT_COMMIT_SUBSTITUTION | Early-ask | **缺失** | — |
| 5 | `validateJqCommand` | JQ_SYSTEM_FUNCTION | Misparsing | **缺失** | — |
| 6 | `validateObfuscatedFlags` | OBFUSCATED_FLAGS | Misparsing | **缺失** — ANSI-C `$'...'` 未检测 | — |
| 7 | `validateShellMetacharacters` | SHELL_METACHARACTERS | Misparsing | **部分**: 仅在 `dangerousPatternsRE` 中检测 `|` 管道 | security_hooks.go:159-162 |
| 8 | `validateDangerousVariables` | DANGEROUS_VARIABLES | Misparsing | **缺失** — 无变量上下文分析 | — |
| 9 | `validateCommentQuoteDesync` | COMMENT_QUOTE_DESYNC | Misparsing | **缺失** — 无引号状态机 | — |
| 10 | `validateQuotedNewline` | QUOTED_NEWLINE | Misparsing | **缺失** | — |
| 11 | `validateCarriageReturn` | — | Misparsing | **缺失** — `\r` 字节未检测 | — |
| 12 | `validateNewlines` | NEWLINES | Non-misparsing | **缺失** | — |
| 13 | `validateIFSInjection` | IFS_INJECTION | Misparsing | **缺失** — `$IFS` 模式未检测 | — |
| 14 | `validateProcEnvironAccess` | PROC_ENVIRON_ACCESS | Misparsing | **缺失** | — |
| 15 | `validateDangerousPatterns` | COMMAND_SUBSTITUTION | Misparsing | **部分**: 仅检测 `curl\|sh`、重定向执行 | security_hooks.go:159-165 |
| 16 | `validateRedirections` | INPUT/OUTPUT_REDIRECTION | Non-misparsing | **部分**: `>/dev/sd*` 在 dangerousPatternsRE 中 | security_hooks.go:177-180 |
| 17 | `validateBackslashEscapedWhitespace` | BACKSLASH_ESCAPED_WHITESPACE | Misparsing | **缺失** | — |
| 18 | `validateBackslashEscapedOperators` | BACKSLASH_ESCAPED_OPERATORS | Misparsing | **缺失** — `\;` 双重解析攻击未覆盖 | — |
| 19 | `validateUnicodeWhitespace` | UNICODE_WHITESPACE | Misparsing | **缺失** | — |
| 20 | `validateMidWordHash` | MID_WORD_HASH | Misparsing | **缺失** — `\S#` 模式未检测 | — |
| 21 | `validateBraceExpansion` | BRACE_EXPANSION | Misparsing | **缺失** — 花括号混淆攻击未覆盖 | — |
| 22 | `validateZshDangerousCommands` | ZSH_DANGEROUS_COMMANDS | Misparsing | **缺失** — 18 条 Zsh 危险命令未列 | — |
| 23 | `validateMalformedTokenInjection` | MALFORMED_TOKEN_INJECTION | Misparsing | **缺失** | — |

### 2.2 AgentHub SecurityHook 已实现的 7 类阻断模式

**AgentHub 源码**: `edge-server/internal/adapters/security_hooks.go:147-182`

```go
// security_hooks.go:147 — dangerousPatternsRE = 7 类阻断模式
var dangerousPatternsRE = regexp.MustCompile(
    // 1. rm -rf 针对根目录（security_hooks.go:149-157）
    // 2. curl/wget 管道到 shell（security_hooks.go:159-162）
    // 3. curl/wget 重定向后执行（security_hooks.go:164-165）
    // 4. sudo bash/shell 提升（security_hooks.go:167-173）
    // 5. chmod 777 全局可写（security_hooks.go:175）
    // 6. > /dev/sd* 块设备覆盖（security_hooks.go:177）
    // 7. dd/cp/mv/tee 到原始块设备（security_hooks.go:178-181）
)
```

**初始化自检** (`security_hooks.go:187-224`): 17 个危险命令 + 5 个安全命令验证正则不产生假阳性/假阴性。

### 2.3 风险分类映射

**AgentHub 源码**: `edge-server/internal/adapters/hooks.go:12-17` + `security_hooks.go:83-98`

```go
// RiskLevel 四级（hooks.go:12-17）
RiskLow     → Read, Grep, Glob              // CC: 自动允许
RiskMedium  → Write, Edit                    // CC: acceptEdits 模式
RiskHigh    → Bash, WebFetch, WebSearch      // CC: 询问用户
RiskBlocked → dangerousPatternsRE 匹配       // CC: misparsing block
```

**CC 对应**: `src/tools/BashTool/bashPermissions.ts` 的 `isBashSecurityCheckForMisparsing` 标志

### 2.4 管道执行流程对比

```
Claude Code (bashSecurity.ts):
  Control char check → Heredoc strip → Quote extraction →
  Early validators → Main validators (misparsing first, then non-misparsing deferred) →
  bashPermissions entry gate

AgentHub (security_hooks.go + hooks.go):
  SecurityHook.PreToolUse() → classifyRisk() → containsDangerousPattern() →
    RiskBlocked? → block=true → HookChain.RunPreToolUse stops
    RiskHigh?    → PermissionRequest(PermAllowOnce) or auto-allow
    RiskLow/Med  → PermissionRequest(PermAllow)
```

**关键差异**:
1. **AgentHub 无 misparsing/non-misparsing 分类** — 所有阻断不可覆盖，但缺乏细粒度安全分析
2. **AgentHub 无延迟 non-misparsing 机制** — CC 的关键设计: 低严重度 non-misparsing 结果延迟等待 misparsing 检查完成
3. **AgentHub 无 heredoc 剥离** — CC 的 `extractHeredocs()` 在引号提取前运行
4. **AgentHub 无引号状态机** — 所有检查基于裸正则匹配，CC 有完整 shell-quote 解析器

### 2.5 P0/P1/P2 优先级评估

| 优先级 | 缺失的 CC 检查 | 理由 |
|:---:|--------|------|
| **P0** | `validateObfuscatedFlags` (ANSI-C `$'...'`)、`validateDangerousPatterns` (12 种替换模式)、`validateBackslashEscapedOperators` (`\;` 双重解析) | 已知 HackerOne 攻击向量 |
| **P0** | `validateCarriageReturn` (`\r`) | Shell-quote vs bash 解析器差异，已知绕过 |
| **P1** | `validateBraceExpansion`、`validateMidWordHash`、`validateCommentQuoteDesync` | 花括号混淆 + 词中井号 + 注释引号不同步，各有已知攻击向量 |
| **P1** | `validateIFSInjection`、`validateDangerousVariables`、`validateQuotedNewline` | 变量注入 + 引号内换行攻击 |
| **P2** | `validateZshDangerousCommands`、`validateUnicodeWhitespace`、`validateMalformedTokenInjection` | Zsh 特定 / 防御纵深 / 畸形 token |
| **P2** | `validateIncompleteCommands`、`validateJqCommand`、`validateNewlines`、`validateRedirections` | 已通过现有模式部分覆盖 |

---

## 3. DefaultPermissionHandler → auto-approve 全部

### 3.1 代码位置与行为

**AgentHub 源码**: `edge-server/internal/adapters/control_protocol.go:74-144`

```go
// control_protocol.go:74 — 注释明确标注为"bypassPermissions equivalent"
type DefaultPermissionHandler struct {
    emitter EventEmitter // nil = silent auto-approve
}

// control_protocol.go:96-143 — handleCanUseTool: 无条件 allow
func (h *DefaultPermissionHandler) handleCanUseTool(...) error {
    // 1. 发射 permission_requested 事件（仅当 emitter 非 nil）
    // 2. 响应 behavior: "allow"
    // 3. 发射 permission_decided 事件（仅当 emitter 非 nil）
}
```

**CC 对应**: `--permission-mode bypassPermissions` CLI 参数

### 3.2 当前使用位置

**AgentHub 源码**: `edge-server/internal/adapters/claude_code.go:125`

```go
// claude_code.go:125 — 所有 CLI 子进程走 DefaultPermissionHandler
func (a *ClaudeCodeAdapter) ParseStream(...) error {
    parser := NewNDJSONStreamParser(emitter, run)
    if stdin != nil {
        parser.WithControlHandler(NewEventEmittingPermissionHandler(emitter), stdin)
    }
    // SecurityHook 阻断在 HookChain 层 — 先于 PermissionHandler
    parser.WithHooks(HookChain{NewSecurityHook()})
    return parser.Parse(ctx, stdout)
}
```

### 3.3 双门控架构

AgentHub 的权限模型是**双层**的：

```
Layer 1: SecurityHook (PreToolUse) — 阻断级（不可覆盖）
    → RiskBlocked → HookChain.RunPreToolUse 返回 block=true
    → 此层先于 PermissionHandler，不受其影响

Layer 2: DefaultPermissionHandler — 审批级（可覆盖）
    → CC 发送 control_request(can_use_tool)
    → DefaultPermissionHandler 自动 allow
    → 仅 SecurityHook 未阻断的工具到达此层
```

**关键问题**: Layer 2 完全不区分风险。它等价于 `bypassPermissions`，意味着：
- `RiskHigh` 工具（Bash, WebFetch）被**静默自动批准**
- 唯一的防护是 Layer 1 的 7 个阻断正则模式
- CC 的 23 项安全检查中有 16 项**未被 AgentHub 实现**

### 3.4 升级路径

三步替换 DefaultPermissionHandler：

1. **P0**: `EventEmittingPermissionHandler` 增加"等待 Desktop 审批响应"模式
2. **P1**: 集成 `PolicyEngine` 决策引擎替代硬编码 `allow`
3. **P2**: 实现 session/thread 级决策缓存

```go
// 目标架构
type PolicyPermissionHandler struct {
    policyEngine *PolicyEngine
    emitter      EventEmitter
    pending      map[string]chan PermissionDecision  // requestID → 决策通道
}

func (h *PolicyPermissionHandler) handleCanUseTool(...) error {
    decision := h.policyEngine.Evaluate(toolCall, evalCtx)
    if decision.Type == DecisionDecline {
        return writeDenyResponse(stdin, requestID, decision.Reason)
    }
    if decision.Type == DecisionAccept && decision.Scope == ScopeOnce {
        // 发送到 Desktop 审批（异步等待）
        return h.requestDesktopApproval(stdin, requestID, inner)
    }
    return writeAllowResponse(stdin, requestID)
}
```

---

## 4. 上下文 Compaction 映射：6 层 → AgentHub ContextBudget + reserveRatio

### 4.1 Claude Code 6 层与 AgentHub 对比

来源：`src/services/compact/` (microCompact.ts, snipCompact.ts, autoCompact.ts, reactiveCompact.ts, sessionMemoryCompact.ts, contextCollapse.ts)

| CC 层 | CC 触发条件 | CC 源文件 | AgentHub 映射 | 源位置 | 状态 |
|-------|------------|---------|--------------|--------|:---:|
| Microcompact | 工具结果数超阈值 / 空闲时间超时 | `microCompact.ts:530` | **ContextBudget + Track()** | context_budget.go:47 | **已实现** |
| Snip | `HISTORY_SNIP` gate | `snipCompact.ts` (stub) | **缺失** — 无工具结果占位符替换 | — | **P2** |
| Autocompact (LLM) | token >= contextWindow - 33K | `autoCompact.ts:351` | **ContextBudget.IsExhausted()** | context_budget.go:32 | **部分** — 仅检测，不执行压缩 |
| Reactive Compact | API 413 错误 | `reactiveCompact.ts` (stub) | **缺失** — 无应急裁剪 | — | **P1** |
| Session Memory | Feature gate + SM 文件存在 | `sessionMemoryCompact.ts:630` | **缺失** — 无外部 SM | — | **P2** |
| Context Collapse | Ant-only | `contextCollapse.ts` | **缺失** — 折叠视图投影 | — | **P2** |

### 4.2 AgentHub ContextBudget 实现

**AgentHub 源码**: `edge-server/internal/runnerctx/context_budget.go:1-50`

```go
// context_budget.go:11 — 原子计数器，并发安全
type ContextBudget struct {
    MaxTokens      int64
    UsedTokens     atomic.Int64
    ReservedTokens int64  // 默认: 10,000（对应 CC 的 AUTOCOMPACT_BUFFER_TOKENS=13,000）
}

// context_budget.go:32 — 对应 CC autoCompact.ts:72-91 阈值计算
func (b *ContextBudget) IsExhausted() bool {
    return b.UsedTokens.Load() >= b.MaxTokens - b.ReservedTokens
}

// context_budget.go:47 — 对应 CC 的 cumulative token tracking
func (b *ContextBudget) Track(tokens int) {
    b.UsedTokens.Add(int64(tokens))
}
```

**CC 对应公式**:
```
CC: threshold = getContextWindowForModel(model) - 20,000 - AUTOCOMPACT_BUFFER_TOKENS(13,000) 
AgentHub: exhausted = usedTokens >= maxTokens - reservedTokens(10,000)
```

### 4.3 Token 追踪集成点

**AgentHub 源码**: `edge-server/internal/adapters/parser_ndjson.go:262-264`

```go
// parser_ndjson.go:262 — 在每个 result 消息上累加
if p.budget != nil {
    p.budget.Track(int(msg.Usage.InputTokens + msg.Usage.OutputTokens))
}
```

**AgentHub 源码**: `edge-server/internal/adapters/claude_code.go:128`

```go
// claude_code.go:128 — SecurityHook + ContextBudget 注入
parser.WithHooks(HookChain{NewSecurityHook()})
```

### 4.4 紧凑边界事件路由

**AgentHub 源码**: `edge-server/internal/adapters/parser_ndjson.go:308-316`

```go
// parser_ndjson.go:308 — 对应 CC QueryEngine compact_boundary 系统消息
func (p *NDJSONStreamParser) emitCompactBoundary(scope, msg) {
    // 触发: system/compact_boundary → BusEventCompactBoundary
    // 携带 trigger (auto/manual) + pre_tokens
}
```

### 4.5 缺失的压缩能力

| 能力 | CC 实现 | AgentHub 缺失原因 | 优先级 |
|------|---------|-----------------|:---:|
| LLM 摘要压缩 | `autoCompact.ts` `compactConversation()` + fork-agent | ContextBudget 仅检测不执行 | P1 |
| Post-compact 附件恢复 | 5 文件(5K each) + Skills(25K) + Agents + MCP | 无压缩执行器 | P1 |
| PTL retry loop | `truncateHeadForPTLRetry()` max 3 retries | 无 | P1 |
| Circuit breaker | `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` | ContextBudget 无状态 | P2 |
| Snip 占位符压缩 | 工具结果 → `[truncated]` 占位符 | 无 | P2 |
| Fork-agent cache 复用 | 继承父级 system+tools+model | 无 fork 机制 | P2 |
| EMA 校准 | `calibrationRatio` EMA α=0.1 | ContextBudget 不使用 EMA | P2 |
| Compaction hooks | `executePreCompactHooks()` / `executePostCompactHooks()` | HookChain 无 compact 钩子 | P2 |

---

## 5. 流式事件协议映射：SDKMessage → BusEvent

### 5.1 NDJSON 事件类型 → AgentHub BusEvent 完整映射

来源：`src/cli/structuredIO.ts`, `src/QueryEngine.ts` → `edge-server/internal/adapters/parser_ndjson.go`

| CC SDKMessage type | subtype | AgentHub BusEvent | parser_ndjson.go 行号 | 说明 |
|-------------------|---------|-------------------|---------------------|------|
| `system` | `init` | `run.agent.session_init` | :100,273 | 模型、工具列表、MCP、权限模式 |
| `assistant` | text block | `run.agent.text_block` | :195 | 完整文本块 |
| `assistant` | tool_use block | `run.agent.tool_call` | :199 | 工具调用请求 |
| `assistant` | thinking block | `run.agent.thinking` | :209 | 思考内容 |
| `stream_event` | `text_delta` | `run.agent.text_delta` | :224 | 部分文本增量 |
| `stream_event` | `thinking_delta` | `run.agent.thinking` | :228 | 部分思考增量 |
| `stream_event` | `content_block_start` (tool_use) | `run.agent.tool_call` | :237 | 工具调用开始 |
| `user` | tool_result | `run.agent.tool_result` | :289 | 工具执行结果 |
| `user` | tool_result (Write/Edit) | `run.agent.file_change` | :297 | 文件修改事件 |
| `result` | — | `run.agent.result` | :269 | 最终结果 + usage 追踪 |
| `system` | `compact_boundary` | `run.agent.compact_boundary` | :102,308 | 上下文压缩边界 |
| `system` | `status` | `run.agent.status_change` | :104,318 | 权限模式/状态变更 |
| `system` | `api_retry` | `run.agent.api_retry` | :106,329 | API 重试信息 |
| `system` | `task_started` | `run.agent.task_started` | :108,339 | 子任务开始 |
| `system` | `task_dispatched` | `run.agent.task_dispatched` | :109,348 | 子任务分派 |
| `system` | `task_progress` | `run.agent.task_progress` | :111,357 | 子任务进度 |
| `system` | `task_notification` | `run.agent.task_notification` | :113,366 | 子任务通知 |
| `system` | `session_state_changed` | `run.agent.session_state_changed` | :115,375 | 会话状态变更 |
| `system` | `hook_started` | `run.agent.hook_started` | :129,381 | Hook 开始 |
| `system` | `hook_progress` | `run.agent.hook_progress` | :131,389 | Hook 进度 |
| `system` | `hook_response` | `run.agent.hook_response` | :133,398 | Hook 响应 |
| `tool_progress` | — | `run.agent.tool_call` (status=in_progress) | :154 | 工具执行进度 |
| `tool_use_summary` | — | `run.agent.tool_use_summary` | :162 | 工具使用摘要 |
| `auth_status` | — | `run.agent.auth_status` | :168 | 认证状态 |
| `rate_limit_event` | — | `run.agent.rate_limit` | :175 | 速率限制信息 |
| `control_request` | `can_use_tool` | → ControlHandler | :86 | 权限请求（发送到 stdin） |
| `control_request` | `initialize` | → ControlHandler | :88 | 会话初始化 |

### 5.2 事件类型定义位置

**AgentHub 源码**: `edge-server/internal/adapters/adapter.go:73-102`

25 个 BusEvent 类型常量，完整覆盖 CC 的 13 种 SDKMessage 类型。

### 5.3 协议适配关键路径

```
CC stdout NDJSON → bufio.Scanner (10MB max line)
  → json.Unmarshal → claudeSDKMessage
  → switch msg.Type:
      "system" → switch msg.Subtype → emit*
      "assistant" → parseAssistantMessage (text/tool_use/thinking)
      "stream_event" → parseStreamEvent (delta/block_start/block_stop)
      "user" → emitToolResult + file_change detection
      "result" → parseResult + budget tracking
      "tool_progress" → emit tool_call in_progress
      "control_request" → ControlHandler.HandleControlRequest
```

---

## 6. 进程生命周期映射：QueryEngine → ProcessExecutor

### 6.1 对照表

| 维度 | CC QueryEngine | AgentHub ProcessExecutor | 源文件 |
|------|---------------|------------------------|--------|
| 入口 | `query()` → `engine.submitMessage()` | `ProcessExecutor.Start()` → `run()` | process_executor.go:79 |
| 命令构建 | `QueryEngineConfig` 依赖注入 | `adapter.BuildCommand(runCtx)` | claude_code.go:54 |
| 子进程管理 | 进程内 TypeScript 事件循环 | `exec.CommandContext(ctx, ...)` | process_executor.go:190 |
| 超时 | `maxTurns` / `maxBudgetUsd` 软限制 | `defaultRunTimeout = 30min` 硬限制 | process_executor.go:77,88 |
| 取消 | `AbortController` + `engine.interrupt()` | `Cancel()` → `WriteInterrupt()` + `cancel()` | process_executor.go:103,119 |
| 环境 | 继承父进程 + SDK options | `SanitizedEnv()` 白名单过滤 | env_sanitizer.go:20 |
| 输出 | `async *generate()` → NDJSON stdout | `publishStructuredOutput()` → bus events | process_executor.go:357 |
| 错误 | `error_during_execution` / `error_max_turns` | `publishFailed()` → `run.failed` 事件 | process_executor.go:322 |
| 完成 | `result` 消息 + exit code | `run.finished` 事件 + status 转换 | process_executor.go:266 |

### 6.2 中断协议

**AgentHub 源码**: `edge-server/internal/adapters/control_protocol.go:154-168`

```go
// control_protocol.go:154 — 对应 CC 的 stdin JSON-RPC interrupt
func WriteInterrupt(stdin io.Writer, requestID string) error { ... }
```

**AgentHub 源码**: `edge-server/internal/lifecycle/process_executor.go:119`

```go
// process_executor.go:119 — 中断优先于上下文取消
if stdin, ok := e.stdins[runID]; ok {
    if err := adapters.WriteInterrupt(stdin, "interrupt-"+runID); err != nil { ... }
}
cancel()
```

### 6.3 环境隔离

**AgentHub 源码**: `edge-server/internal/lifecycle/env_sanitizer.go:20-242`

```go
// env_sanitizer.go:20 — 默认不继承父进程环境，仅白名单通过
func SanitizedEnv(profileEnv, extraEnv []string) []string { ... }
// env_sanitizer.go:32 — 敏感变量检测：_KEY, _SECRET, _TOKEN, _PASSWORD 等后缀
func IsSensitiveEnvKey(key string) bool { ... }
// env_sanitizer.go:99 — 白名单: XDG_*, HOME, PATH, SHELL, TMPDIR, 语言运行时, 代理等
func isWhitelistedEnvKey(key string) bool { ... }
```

**CC 对应**: CC 无显式环境过滤 — SDK 继承调用进程的全部环境变量。

---

## 7. AgentAdapter 注册与多 CLI 支持

### 7.1 Adapter Registry

**AgentHub 源码**: `edge-server/internal/adapters/registry.go:1-92`

```go
// registry.go:9 — 线程安全注册表
type Registry struct {
    adapters map[string]AgentAdapter  // "claude-code" | "codex" | "opencode" | "orchestrator"
    defaults map[string]string        // role → adapterID
}

// registry.go:78 — 解析链路: agentID explicit → default role → error
func (r *Registry) Resolve(agentID string) (AgentAdapter, error) { ... }
```

**CC 对应**: CC 无多 provider 概念 — 始终是自身。AgentHub 的 Registry 是跨项目创新。

### 7.2 多 CLI 模型别名

**AgentHub 源码**: `edge-server/internal/adapters/model_config.go:1-93`

```go
// model_config.go:5 — 3 个 CLI 各自的模型别名表
var ModelAliases = map[string]map[string]string{
    "claude-code": { "opus": "claude-opus-4-7", "sonnet": "claude-sonnet-4-6", ... },
    "codex":       { "gpt-5": "gpt-5.3-codex", ... },
    "opencode":    { "opus": "newapi/deepseek-v4-pro", ... },
}
// model_config.go:27 — 推理强度别名表（跨 CLI 映射）
var ReasoningEfforts = map[string]map[string]string{ ... }
```

---

## 8. 汇总：P0/P1/P2 待采纳项

### P0 — 安全临界（必须）

| # | 采纳项 | CC 源 | AgentHub 目标文件 | 影响 |
|---|--------|-------|-----------------|------|
| 1 | `validateObfuscatedFlags` — ANSI-C `$'...'`、空引号绕过检测 | bashSecurity.ts | security_hooks.go | 安全 |
| 2 | `validateDangerousPatterns` — 12 种命令替换模式检测 | bashSecurity.ts | security_hooks.go | 安全 |
| 3 | `validateBackslashEscapedOperators` — `\;` 双重解析防御 | bashSecurity.ts | security_hooks.go | 安全 |
| 4 | `validateCarriageReturn` — `\r` 解析器差异防御 | bashSecurity.ts | security_hooks.go | 安全 |
| 5 | `validateBraceExpansion` — 花括号混淆防御 | bashSecurity.ts | security_hooks.go | 安全 |
| 6 | `DefaultPermissionHandler` → `PolicyPermissionHandler` (PolicyEngine integration) | permissions.ts | control_protocol.go | 架构 |

### P1 — 压缩 + 权限增强

| # | 采纳项 | CC 源 | AgentHub 目标 |
|---|--------|-------|-------------|
| 1 | LLM Autocompact 执行器 | autoCompact.ts | context_budget.go + 新 compact 包 |
| 2 | Post-compact 附件恢复 (files/skills/agents/MCP) | autoCompact.ts | context_budget.go |
| 3 | PTL retry loop (max 3, head truncate) | autoCompact.ts | 新 compact 包 |
| 4 | Reactive Compact (API 413 应急) | reactiveCompact.ts | context_budget.go |
| 5 | `validateIFSInjection`, `validateDangerousVariables`, `validateMidWordHash` | bashSecurity.ts | security_hooks.go |
| 6 | `validateCommentQuoteDesync`, `validateQuotedNewline` | bashSecurity.ts | security_hooks.go |
| 7 | Session/Thread 决策缓存 | permissions.ts | control_protocol.go |
| 8 | SubagentStart/Stop → AgentHook 集成 | hooksConfigManager.ts | hooks.go |
| 9 | SessionStart/SessionEnd → AgentHook 集成 | hooksConfigManager.ts | hooks.go |

### P2 — 增强 + 防御纵深

| # | 采纳项 | CC 源 | AgentHub 目标 |
|---|--------|-------|-------------|
| 1 | Snip 占位符压缩 | snipCompact.ts | context_budget.go |
| 2 | Session Memory Compact | sessionMemoryCompact.ts | 新 compact 包 |
| 3 | Fork-agent cache 复用 | autoCompact.ts | 新 compact 包 |
| 4 | EMA 校准 (α=0.1) | LibreChat calibrationRatio | context_budget.go |
| 5 | Compaction hooks (PreCompact/PostCompact) | autoCompact.ts | hooks.go |
| 6 | Circuit breaker (MAX_CONSECUTIVE_FAILURES=3) | autoCompact.ts | context_budget.go |
| 7 | `validateZshDangerousCommands` (18 条命令) | bashSecurity.ts | security_hooks.go |
| 8 | `validateUnicodeWhitespace` | bashSecurity.ts | security_hooks.go |
| 9 | `validateMalformedTokenInjection` (eval 绕过) | bashSecurity.ts | security_hooks.go |
| 10 | ConfigChange/TeammateIdle → AgentHook 集成 | hooksConfigManager.ts | hooks.go |
| 11 | Plugin hook 注册 (settings/plugins/built-in 3 层) | hooksConfigManager.ts | hooks.go |

### 8.1 已正确实现（无需改动）

| # | 项目 | AgentHub 源 | 评价 |
|---|------|-----------|------|
| 1 | `AgentHook` 6 核心接口 + `HookChain` 中间件 | hooks.go | 良好 — CC 28 hooks 收敛为 6 个，模式正确 |
| 2 | `SecurityHook` 7 类危险模式正则阻断 | security_hooks.go | 良好 — 正确阻断，init() 自检覆盖 17+5 个用例 |
| 3 | `ContextBudget` token 追踪 + 耗尽检测 | context_budget.go | 良好 — 原子操作，并发安全 |
| 4 | `NDJSONStreamParser` 完整 25 种事件路由 | parser_ndjson.go | 良好 — switch-case 覆盖所有 CC SDKMessages |
| 5 | `ProcessExecutor` 中断协议 (WriteInterrupt before cancel) | process_executor.go + control_protocol.go | 良好 — 优雅关闭顺序正确 |
| 6 | `SanitizedEnv` 白名单环境过滤 | env_sanitizer.go | 良好 — 权限最小化，敏感变量检测 |
| 7 | `Registry` 多 CLI 适配器注册表 | registry.go | 良好 — 线程安全，按角色默认值 |
| 8 | `ModelAliases` / `ReasoningEfforts` 跨 CLI 别名 | model_config.go | 良好 — 3 个 CLI 统一别名层 |
| 9 | `BusEvent` 25 种统一事件类型 | adapter.go | 良好 — 完整覆盖 CC NDJSON 协议 |
| 10 | `CompactBoundary` 事件路由 | parser_ndjson.go:308 | 良好 — 保留 trigger + pre_tokens 元数据 |
| 11 | Hook 事件路由 (started/progress/response) | parser_ndjson.go:381-406 | 良好 — 完整透传 CC hook 遥测 |
| 12 | API Retry 事件路由 | parser_ndjson.go:329-337 | 良好 — attempt/max_retries/delay/error 齐全 |

---

## 9. 文件交叉索引

### Claude Code 源文件 → AgentHub 源文件

| CC 源文件 | 行号 | AgentHub 目标文件 | 行号 | 映射项 |
|----------|------|-----------------|------|--------|
| `entrypoints/sdk/coreTypes.ts` | 25-52 | `adapters/hooks.go` | 39-57 | Hook 事件 → AgentHook 接口 |
| `utils/hooks/hooksConfigManager.ts` | 270-392 | `adapters/hooks.go` | 60-122 | Hook 分组 → HookChain |
| `tools/BashTool/bashSecurity.ts` | 全文 | `adapters/security_hooks.go` | 147-182 | 23 检查 → 7 阻断正则 |
| `tools/BashTool/bashPermissions.ts` | — | `adapters/hooks.go` | 12-17 | misparsing → RiskBlocked |
| `QueryEngine.ts` | 209-1156 | `adapters/parser_ndjson.go` | 48-186 | SDKMessages → parseLine switch |
| `cli/structuredIO.ts` | 135-650 | `adapters/control_protocol.go` | 74-144 | canUseTool → DefaultPermissionHandler |
| `services/compact/autoCompact.ts` | 72-91 | `runnerctx/context_budget.go` | 32-44 | 阈值 → IsExhausted() |
| `services/compact/microCompact.ts` | — | `runnerctx/context_budget.go` | 47-49 | Token 追踪 → Track() |
| `cli/print.ts` | 455-973 | `adapters/claude_code.go` | 54-120 | 参数 → BuildCommand |
| `tools.ts` | 193-251 | `adapters/adapter.go` | 57-68 | 工具列表 → Capabilities |
| `services/mcp/types.ts` | 23-56 | `adapters/adapter.go` | 67 | MCP → AgentCapabilities.MCPIntegration |
| `bootstrap/state.ts` | — | `runnerctx/context.go` | 18-20 | Session 管理 → SessionID/ContinueLast/ForkSession |
| `QueryEngine.ts` | 1135-1155 | `adapters/parser_ndjson.go` | 249-270 | result → parseResult + budget tracking |
| `cli/structuredIO.ts` | — | `adapters/control_protocol.go` | 154-168 | interrupt → WriteInterrupt |

### AgentHub 回参阅 CC 设计文档

| 设计文档 | 节 | AgentHub 文件 | 采纳状态 |
|---------|---|-------------|:---:|
| `02-tool-security.md` | §2.2 | `security_hooks.go` | 7/23 检查已实现 |
| `02-tool-security.md` | §3.2 | — | 23 个 Go validator 已设计但未引入 |
| `02-tool-security.md` | §3.3 | — | SecurityPipeline 编排器已设计但未引入 |
| `02-tool-security.md` | §5 | — | PolicyEngine 已设计，待集成 |
| `03-context-compaction.md` | §6.1-6.2 | `context_budget.go` | ContextBudget 部分实现 |
| `03-context-compaction.md` | §6.2 | — | CompactionOrchestrator 已设计但未引入 |
| `01-overview.md` | §3 | `hooks.go` | 28→6 收敛完成 |
| `01-overview.md` | §5.1 | `claude_code.go` | CLI 子进程模式实现 |
| `01-overview.md` | §5.2 | `parser_ndjson.go` | NDJSON 消息映射完成 |
| `01-overview.md` | §5.4 | `claude_code.go:54` | CLI 参数映射完成 |

---

> 本文档是 `claude-code-sdk/` 系列第 4 份，前接 `01-overview.md`（SDK 架构概述）、`02-tool-security.md`（Bash 安全管道）、`03-context-compaction.md`（上下文压缩）。
> 更新日期：2026-05-24。
