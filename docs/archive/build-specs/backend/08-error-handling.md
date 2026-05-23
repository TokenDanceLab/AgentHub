> 状态: 🔄 进行中 — 基础错误码在 API 层已使用，完整 37 ErrorCode 体系待实现

# AgentHub 错误处理与用户反馈 UX 设计

> 综合自：`opencode.md`（LLMErrorReason 10 变体 + RouteExecutor retry）、
> `cross-analysis-adapters.md`（第 3 节 per-agent workarounds + ResultPayload subtypes）、
> `design-desktop-ux.md`（DiffCard + ConnectionStatus + Toast + RunStore states）、
> `deep-dive-claude-code-tool-security.md`（SecurityViolation severity + PolicyEngine decisions）
> 日期：2026-05-21

---

## 1. 错误分类体系

### 1.1 三轴模型

AgentHub 系统中的每个错误沿三个正交轴进行分类。
此分类法合并了 OpenCode 的 `LLMErrorReason` 可区分联合类型、
CC 的 `result.is_error` / exit-code 语义，以及 AgentHub 自身的 `ResultSubtype` 模型。

```
                    ┌── 用户可修复（用户操作后重试）
                    │
错误 ──来源─────────┼── 系统（基础设施，瞬态或运维可修复）
                    │
                    └── Agent 内部（模型输出无效、工具逻辑 bug）
```

#### 轴 1：来源（谁能修复它）

| 来源 | 定义 | 示例 | 来源 |
|------|------|------|------|
| **用户可修复** | 需要用户更改输入、凭据或配置后才能重试 | InvalidRequest（参数无效）、Authentication（401/403）、QuotaExceeded、ContentPolicy（提示词违反过滤器）、RateLimit（用户可以等待或升级） | OpenCode LLMErrorReason |
| **系统** | 用户无法控制的基础设施故障；瞬态或需要运维介入 | Transport（网络/超时）、ProviderInternal（500/503/504）、NoRoute（配置错误）、MCP 连接失败、Edge WS 断开 | OpenCode + connectionStore |
| **Agent 内部** | 模型或工具产生无效输出，或 Agent 达到逻辑限制 | InvalidProviderOutput（解析错误）、max_turns、max_budget_usd、工具执行失败、安全违规（误解析）、子进程崩溃 | ResultPayload subtypes + SecurityViolation |

#### 轴 2：可重试性（相同请求重试能否成功）

| 可重试性 | 行为 | 示例 |
|---------|------|------|
| **自动可重试** | 瞬态；系统自动以退避重试 | RateLimit (429)、ProviderInternal (500/503)、Transport（超时） |
| **手动可重试** | 用户必须先更改某些内容再重试 | Authentication（修复密钥）、InvalidRequest（修复参数）、QuotaExceeded（充值）、ContentPolicy（改写提示词） |
| **不可重试** | 相同请求永远失败；需要替代路径 | InvalidProviderOutput（模型 bug）、SeverityBlock 安全违规、NoRoute |

> OpenCode 的 `LLMErrorReason` 通过每个变体的 `retryable` getter 编码可重试性。
> AgentHub 采用相同模式，作为 `AgentHubError` 上的布尔字段。

#### 轴 3：严重程度（UX 多紧急 / 多具破坏性）

| 严重程度 | UX 影响 | 展示渠道 |
|---------|--------|---------|
| **Info** | 后台通知，不中断 | Toast（4s 自动消失）、日志面板 |
| **Warning** | 非阻塞告警；用户应知晓但不被阻止 | 内联横幅、连接圆点黄色 |
| **Error** | 操作失败；用户必须确认或重试 | 内联错误卡片、DiffCard 红色边框、状态徽章 |
| **Critical** | 会话/连接中断；需要用户立即操作 | Modal 或全屏错误状态、连接圆点红色、阻塞重试对话框 |
| **Block** | 安全违规；系统拒绝执行 | ApprovalCard（已拒绝）、安全说明、无重试路径 |

### 1.2 统一错误类型（Go）

```go
// AgentHubError 是流经所有层的单一错误类型。
type AgentHubError struct {
    Code        ErrorCode       // 机器可读枚举
    Origin      ErrorOrigin     // user-fixable | system | agent-internal
    Retryable   bool            // 相同输入重试能否成功
    Severity    ErrorSeverity   // info | warning | error | critical | block
    Message     string          // 人类可读（一句话）
    Detail      string          // 技术细节（堆栈、原始响应、违规模式）
    Suggestion  string          // 面向用户的可操作指导（"请在...处检查您的 API key"）
    RetryAction *RetryAction    // 非 nil 时，UI 渲染此重试按钮/链接
    Source      ErrorSource     // 哪一层产生的（llm, adapter, tool, security, edge）
    Raw         json.RawMessage // 原始 provider 错误，用于调试
}
```

### 1.3 ErrorCode 枚举（合并自全部四个来源）

```go
type ErrorCode string

const (
    // --- LLM Provider 错误（来自 OpenCode LLMErrorReason） ---
    ErrInvalidRequest        ErrorCode = "invalid_request"         // 400/404/409/422
    ErrNoRoute               ErrorCode = "no_route"                // 无 provider 配置
    ErrAuthentication        ErrorCode = "authentication"          // 401/403
    ErrRateLimit             ErrorCode = "rate_limit"              // 429（可重试）
    ErrQuotaExceeded         ErrorCode = "quota_exceeded"          // 429 quota
    ErrContentPolicy         ErrorCode = "content_policy"          // 内容过滤器拒绝
    ErrProviderInternal      ErrorCode = "provider_internal"       // 500/503/504/529（可重试）
    ErrTransport             ErrorCode = "transport"               // 网络/超时（可重试）
    ErrInvalidProviderOutput ErrorCode = "invalid_provider_output" // 解析错误
    ErrUnknownProvider       ErrorCode = "unknown_provider"        // 兜底

    // --- Turn 级错误（来自 ResultPayload subtypes） ---
    ErrMaxTurns               ErrorCode = "max_turns"
    ErrMaxBudget              ErrorCode = "max_budget_usd"
    ErrMaxStructuredOutput    ErrorCode = "max_structured_output_retries"
    ErrExecution              ErrorCode = "error_during_execution"

    // --- 工具执行错误 ---
    ErrToolNotFound     ErrorCode = "tool_not_found"
    ErrToolTimeout      ErrorCode = "tool_timeout"
    ErrToolDenied       ErrorCode = "tool_denied"
    ErrToolCrashed      ErrorCode = "tool_crashed"
    ErrSandboxDenial    ErrorCode = "sandbox_denial"

    // --- 安全违规（来自 SecurityViolation） ---
    ErrSecurityBlock    ErrorCode = "security_block"     // SeverityBlock：始终拒绝
    ErrSecurityWarning  ErrorCode = "security_warning"   // SeverityHigh：必须询问
    ErrSecurityNotice   ErrorCode = "security_notice"    // SeverityLow/Medium：非误解析

    // --- 连接 / 基础设施 ---
    ErrEdgeDisconnected ErrorCode = "edge_disconnected"
    ErrEdgeTimeout      ErrorCode = "edge_timeout"
    ErrRunnerUnavailable ErrorCode = "runner_unavailable"
    ErrMCPConnection    ErrorCode = "mcp_connection_failed"

    // --- 会话 / 工作流 ---
    ErrSessionNotFound  ErrorCode = "session_not_found"
    ErrForkFailed       ErrorCode = "fork_failed"
    ErrCompactionFailed ErrorCode = "compaction_failed"
    ErrMessageSendFailed ErrorCode = "message_send_failed"

    // --- Diff / Git 错误（来自桌面 UX 枚举） ---
    ErrNotARepository   ErrorCode = "not_a_repository"
    ErrBranchNotFound   ErrorCode = "branch_not_found"
    ErrDiffParseError   ErrorCode = "diff_parse_error"
    ErrGitHookFailed    ErrorCode = "git_hook_failed"
    ErrNothingToCommit  ErrorCode = "nothing_to_commit"
    ErrGitConflict      ErrorCode = "git_conflict"
    ErrGitAuthFailed    ErrorCode = "git_auth_failed"
    ErrGitPushRejected  ErrorCode = "git_push_rejected"
)
```

---

## 2. 错误展示 UI：四通道模型

### 2.1 通道决策矩阵

| 通道 | 可见性 | 消除方式 | 最适合 | 示例 |
|------|-------|---------|--------|------|
| **内联卡片** | 上下文内，消息流中 | 用户滚动经过 | 工具级错误、diff 失败、审批拒绝 | DiffCard `apply_failed`、ToolResult `is_error`、ApprovalCard denied |
| **Toast** | 全局，右上角堆叠 | 4s 自动消失或滑动关闭 | 瞬态通知、后台任务完成 | "连接已恢复"、"消息已发送"、"压缩完成" |
| **状态指示器** | 持久，侧边栏底部 | 无（始终可见） | 连接健康、运行状态、MCP 服务器状态 | ConnectionStatus 圆点（绿/黄/红）、RunIndicator |
| **Modal / Overlay** | 阻塞，屏幕居中 | 显式关闭按钮 | 需要用户决策的关键错误 | 认证过期（重新登录）、会话损坏、致命崩溃 |

### 2.2 内联错误卡片（DiffCard 模式）

来自 `design-desktop-ux.md` 第 3.2 节的 DiffCard 错误状态泛化到所有工具结果错误展示：

| 组件状态 | 视觉 | 操作 |
|---------|------|------|
| `pending`（默认） | 黄色左边框 | [Apply] [Discard] [View Full] |
| `applying` | 动画脉冲 | Spinner "Applying..." |
| `applied` | 绿色左边框，渐变为灰色 | [Undo（5s 窗口）] |
| `apply_failed` | 红色左边框 | 红色 "Failed" + [Retry] [Discard] |
| `discarded` | 灰色左边框，降低不透明度 | "Discarded" 灰色显示 |

泛化到 `ErrorCard`：

```tsx
// src/components/chat/ErrorCard.tsx
interface ErrorCardProps {
    error: AgentHubError
    context: "tool_result" | "diff" | "approval" | "send_failed"
    onRetry?: () => void
    onDismiss?: () => void
    onModify?: () => void  // 消息失败时的 "Edit & Resend"
}
```

**渲染规则：**
- `Severity == "block"`：红色左边框，无重试按钮，说明文字（"此命令被安全策略阻止：..."）
- `Severity == "critical"`：红色左边框，主按钮 [Retry] + 次要按钮 [Dismiss]
- `Severity == "error"`：橙色左边框，可重试时显示 [Retry]，否则 [Dismiss]
- `Severity == "warning"`：黄色左边框，可关闭
- `Severity == "info"`：无边框，仅内联文本

### 2.3 Toast 通知（来自 design-desktop-ux.md ToastContainer）

```tsx
// AgentHub stores 中的 Toast 类型
type ToastType = "success" | "error" | "warning" | "info" | "loading"

// Toast 生命周期
// 1. 由 WS 事件或 API 响应后的 store action 触发
// 2. 堆叠在 ToastContainer（右上角，最多 5 个可见）
// 3. 4s 后自动消失（每个 toast 可配置）
// 4. 用户可以滑动提前关闭
// 5. "loading" toast 持续到被 success/error 替换

// 示例：
// - "已连接到 Edge: us1-desktop"（success, 3s）
// - "消息发送失败 — 点击重试"（error, 持续到操作）
// - "压缩完成：释放 12k tokens"（info, 4s）
// - "安全检查：检测到大括号扩展混淆"（warning, 6s）
```

### 2.4 连接状态指示器（来自 `connectionStore`）

LeftSidebar 中的持久底部元素：

```
绿色圆点 + "us1-desktop" + "12ms" → 正常
黄色圆点 + "Connecting..."       → 瞬时（重连尝试 N）
红色圆点 + "Disconnected"         → 离线，带 [Reconnect] 按钮
红色横幅（全宽）                  → "Edge 不可达 — 离线模式"（达到最大重试后）
```

重连策略：指数退避（1s, 2s, 4s, 8s, 最大 30s），成功后重置。

### 2.5 运行状态徽章（来自 `runStore`）

在 ChatHeader 中显示为 `ExecutionBadge`：

| 状态 | 视觉 | 示例文本 |
|------|------|---------|
| `queued` | 灰色 pill | "Queued..." |
| `starting` | 蓝色脉冲 | "Starting..." |
| `running` | 绿色脉冲 | "Edge: us1-desktop / Runner #3" |
| `awaiting_approval` | 黄色脉冲 | "Waiting for approval..." |
| `completed` | 绿色对勾（2s）然后消失 | -- |
| `failed` | 红色叉号 + 错误摘要 | "Failed: rate limit exceeded" |
| `cancelled` | 灰色删除线 | "Cancelled" |

---

## 3. 重试策略 UX

### 3.1 策略决策树

```
错误发生
  │
  ├── 可重试 && 严重程度 < Critical？
  │     ├── 自动重试活跃？（RouteExecutor, WS reconnect）
  │     │     └── 退避计时器运行 → Toast："Retrying in 3s... (attempt 2/3)"
  │     │     └── 所有重试耗尽 → 内联错误卡片带 [Manual Retry]
  │     └── 无自动重试？
  │           └── 内联错误卡片带 [Retry] 按钮
  │
  ├── 用户可修复？
  │     └── 错误卡片带 [Modify & Retry] 或具体操作链接
  │           （"打开 API key 设置"、"检查配额面板"）
  │
  └── 不可重试？
        └── 错误卡片仅含解释，无重试按钮
              （"此模型不支持工具使用。请切换到 Claude 或 Codex。"）
```

### 3.2 自动重试模式

#### LLM Route Executor（来自 OpenCode `RouteExecutor`）

```
指数退避 + jitter
  基础延迟：500ms
  最大延迟：10000ms
  最大重试次数：2
  可重试代码：RateLimit, ProviderInternal, Transport
  日志记录前脱敏 header/query/body
  UI 反馈：Toast "Request failed (500). Retrying... (1/2)"
```

#### WebSocket 重连（来自 `connectionStore`）

```
指数退避
  延迟：1s, 2s, 4s, 8s, 最大 30s
  无限重试（直到显式断开）
  UI：连接圆点转换 green→yellow→red
  3 次失败尝试后：红色横幅 "Edge disconnected"
  重连时：Toast "Connection restored" + 绿色圆点
```

#### 消息发送重试（乐观 UI）

```
乐观：消息立即出现，带 "sending..." 指示器
  超时：10s 软，30s 硬
  软超时：spinner 持续，toast "Still trying..."
  失败：消息上红色圆点，内联横幅 [Retry] [Edit & Resend] [Delete]
  成功：服务器 ID 替换本地 ID，"sending..." → 时间戳
```

### 3.3 手动重试 UX

| 上下文 | 触发 | UI 组件 | 操作 |
|--------|------|--------|------|
| 工具执行失败 | `ToolResult.is_error` | ErrorCard（内联） | [Retry with same params] [Modify params & retry] |
| Diff apply 失败 | `DiffCard apply_failed` | DiffCard 红色边框 | [Retry] [Discard] |
| 消息发送失败 | 发送超时/错误 | 消息上的内联横幅 | [Retry] [Edit & Resend] [Delete] |
| 审批被拒绝 | 用户或系统拒绝 | ApprovalCard | [Edit command & re-request] |
| 认证过期 | API 调用返回 401 | Modal overlay | [Re-enter credentials] [Switch API key] |
| 达到 max turns/budget | Turn 以错误完成 | 流中的结果卡片 | [Continue in new turn] [Increase limit] |

### 3.4 安全违规重试路径

安全违规有独立于操作错误的重试逻辑：

| 严重程度 | 自动拒绝？ | 重试路径 |
|---------|-----------|---------|
| **Block** | 是（系统） | 无重试。卡片解释触发了哪条安全规则。用户必须完全改写提示词以避免该模式。 |
| **High**（误解析） | 强制询问 | 显示 ApprovalCard。用户可以 [Approve Once]。不能通过允许列表自动批准。 |
| **Medium**（非误解析） | 询问用户 | 显示 ApprovalCard。用户可以 [Approve Once] 或 [Always Allow]（添加到允许列表）。 |
| **Low**（非误解析） | 询问用户（fallback） | 允许列表规则可以自动批准。无规则匹配则显示 ApprovalCard。 |

---

## 4. AgentHub 错误处理架构

### 4.1 各层职责

```
┌──────────────────────────────────────────────────┐
│  UI 层（React）                                   │
│  ErrorCard / Toast / ConnectionDot / Modal        │
│  读取：AgentHubError.Code, .Severity, .Suggestion │
│  渲染：适当通道 + 重试操作                         │
└──────────────────┬───────────────────────────────┘
                   │ AgentHubError（通过 WS/REST 序列化）
┌──────────────────┴───────────────────────────────┐
│  Edge Server（Go）                                │
│  ErrorNormalizer：adapter errors → AgentHubError  │
│  ConnectionMonitor：WS 健康、重连逻辑              │
│  SessionErrorTracker：每个 session 的错误日志      │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────┐
│  Runner（Go）                                     │
│  PolicyEngine.Evaluate() → ApprovalDecision       │
│  SecurityPipeline.Evaluate() → SecurityViolation  │
│  ToolExecutor → ToolResult（带 is_error）          │
│  AdapterErrorMapper：native → AgentHubError       │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────┐
│  Agent Adapter（Go）                              │
│  NDJSON/SSE/Rollout parser → AgentEvent 流        │
│  错误检测：exit code, result.is_error,             │
│    LLMErrorReason._tag, HTTP 状态码                │
│  通过 mapper 将原生错误映射 → AgentHubError        │
└──────────────────────────────────────────────────┘
```

### 4.2 Adapter 错误映射（来自 cross-analysis-adapters.md 第 3 节）

每个 Adapter 有独特的错误编码，必须规范化：

#### Claude Code Adapter
```go
// CC 特定的错误源及其映射
var ccErrorMapping = map[string]ErrorCode{
    // result.is_error + result.errors[] 字符串
    // Exit code != 0 但 result.is_error == false → 警告（非零退出可能是故意的）
    // tool_result.is_error == true → ErrExecution 带工具上下文
}
```

**Workaround 感知的错误处理：**
- stdout guard 干扰（Workaround 1）：带 `[stdout-guard]` 前缀的 stderr 行 → 仅日志，不面向用户
- Exit code 解释（Workaround 2）：始终检查 `result.is_error`，而不仅是 exit code
- MCP 启动延迟（Workaround 4）：第 1 个 Turn 上的 `system_init` 带 0 个 MCP 工具 → 静默，不是错误

#### Codex Adapter
```go
// Codex 特定：rollout trace 解析失败、沙箱错误
// Workaround 8：沙箱错误与工具失败必须区分
```

#### OpenCode Adapter
```go
func mapOpenCodeError(body []byte) *AgentHubError {
    var errResp struct {
        _tag   string `json:"_tag"`
        error  string `json:"error"`
        status int    `json:"status"`
    }
    json.Unmarshal(body, &errResp)
    switch errResp._tag {
    case "RateLimit":         return newError(ErrRateLimit, OriginSystem, true, ...)
    case "Authentication":    return newError(ErrAuthentication, OriginUserFixable, false, ...)
    case "Transport":         return newError(ErrTransport, OriginSystem, true, ...)
    case "ProviderInternal": return newError(ErrProviderInternal, OriginSystem, true, ...)
    case "InvalidRequest":    return newError(ErrInvalidRequest, OriginUserFixable, false, ...)
    case "QuotaExceeded":     return newError(ErrQuotaExceeded, OriginUserFixable, false, ...)
    case "ContentPolicy":     return newError(ErrContentPolicy, OriginUserFixable, false, ...)
    case "NoRoute":           return newError(ErrNoRoute, OriginSystem, false, ...)
    case "InvalidProviderOutput": return newError(ErrInvalidProviderOutput, OriginAgentInternal, false, ...)
    case "UnknownProvider":   return newError(ErrUnknownProvider, OriginSystem, false, ...)
    }
}
```

### 4.3 MCP 连接错误（来自 opencode.md 第 4 节）

MCP 服务器状态是一个 5 状态可区分联合类型。AgentHub 将其映射到 `AgentHubError`：

| MCP 状态 | ErrorCode | 严重程度 | 可重试 | UX |
|---------|-----------|---------|--------|-----|
| `connected` | -- | -- | -- | MCP 设置中绿色徽章 |
| `disabled` | -- | -- | -- | 灰色徽章，用户有意关闭 |
| `failed` | `mcp_connection_failed` | error | true | 红色徽章 + [Reconnect] 按钮 + 错误详情 |
| `needs_auth` | `authentication` | warning | false（需要 OAuth） | 黄色徽章 + [Authenticate] 按钮 |
| `needs_client_registration` | `mcp_connection_failed` | error | true | 红色徽章 + 详情 + [Retry Registration] |

### 4.4 工具执行错误流（PolicyEngine + SecurityPipeline）

```
ToolCall 到达 Runner
  │
  ├── SecurityPipeline.Evaluate(command)
  │     ├── ControlCharRe 匹配？→ DENY（SeverityBlock，无用户提示）
  │     ├── 误解析违规？→ ErrSecurityWarning（SeverityHigh）
  │     │     └── UI：ApprovalCard "检测到大括号扩展混淆"
  │     │         操作：[Approve Once] only（无 allowlist override）
  │     └── 非误解析违规？→ ErrSecurityNotice（SeverityLow/Medium）
  │           └── UI：ApprovalCard 带 [Approve Once] [Always Allow]
  │
  ├── PolicyEngine.Evaluate(toolCall, evalCtx)
  │     ├── bypassPermissions 模式 → 自动允许（只读路径仍检查）
  │     ├── plan 模式 + 写入工具 → DENY
  │     ├── Rule match（允许）→ 自动允许
  │     ├── Rule match（拒绝）→ ErrToolDenied
  │     ├── HighRiskPattern 匹配 + AutoDeny → ErrToolDenied
  │     └── 无匹配 → 默认（基于 ToolDescriptor.riskLevel）
  │
  ├── ToolExecutor.runWithTimeout(call, cfg)
  │     ├── 进度计时器（2s）→ 发出 ToolProgress 事件
  │     ├── 阻塞预算（15s）→ 自动转入后台
  │     │     └── UI：ToolUseCard 显示 "Running in background..."
  │     ├── 默认超时（120s）→ ErrToolTimeout
  │     └── 执行 → ToolResult（success 或 is_error）
  │
  └── 结果发送到 AgentEvent 流
```

### 4.5 UI 状态机：错误生命周期

```
          ┌────────────────────────────────────────────┐
          │                 正常                         │
          │  （流式输出、空闲、等待输入）                   │
          └──────┬──────────┬──────────┬────────────────┘
                 │          │          │
          错误发生│  警告事件 │  信息事件 │
                 ▼          ▼          ▼
        ┌───────────┐ ┌─────────┐ ┌─────────┐
        │ ERROR     │ │ WARNING │ │ INFO    │
        │ （内联     │ │ （toast │ │ （toast │
        │  卡片）    │ │  + 圆点）│ │  4s）   │
        └─────┬─────┘ └────┬────┘ └────┬────┘
              │            │           │
    ┌─────────┼────────┐   │           │
    │         │        │   │           │
    ▼         ▼        ▼   ▼           ▼
┌────────┐ ┌──────┐ ┌──────┐     自动消失
│RETRYING│ │FIXED │ │GIVING│
│（spinner│ │（绿色│ │ UP   │
│+toast） │ │闪烁）│ │（灰色）│
└───┬────┘ └──┬───┘ └──────┘
    │         │
    │ 成功    │
    └────┬────┘
         ▼
       正常
```

### 4.6 Store 集成汇总

| Store | 错误相关字段 | 更新事件 |
|-------|------------|---------|
| `runStore` | `runStatus`、`runError`（在 `failRun()` 时） | `run.failed` WS 事件 |
| `threadStore` | `ToolResult.is_error`、`messageCache` 错误消息 | `run.item`（tool_result）WS 事件 |
| `approvalStore` | `pendingApprovals`、带拒绝原因的 `approvalHistory` | `permission.requested` / `permission.resolved` |
| `connectionStore` | `edgeStatus`、`lastError`、`reconnectAttempt` | `edge.connection_status` / `edge.pong` |
| `diffStore` | `diffError: DiffError`、`commitError`、push/pull errors | REST 响应 + 本地 git |
| `projectStore` | `projectError` | 项目加载失败 |
| `previewStore` | （隐式：artifact 加载失败） | `artifact.created` / 加载失败 |
| `pluginStore` | Plugin `status: "error"`、`error` 字符串 | Plugin 加载/安装失败 |
| `searchStore` | （隐式：FTS5 查询失败 → toast） | Search API error |
| `uiStore` | （ToastContainer 从任何 store 的错误副作用渲染） | 跨 store |

---

## 5. 设计决策与原则

1. **单一错误类型**：`AgentHubError` 流经所有层。没有按层的错误结构体——UI 不需要知道哪一层产生的错误就能正确渲染。`Origin` 和 `Source` 字段用于日志/调试。

2. **重试是一等字段**：`Retryable` 布尔值 + 可选的 `RetryAction` 结构体（label、endpoint、params）意味着 UI 可以通用渲染重试按钮，无需 Adapter 特定知识。

3. **安全违规是错误，不是独立系统**：安全阻塞只是一个带有 `Origin=AgentInternal, Severity=Block, Retryable=false` 的错误。ApprovalCard 组件处理 UX 差异。

4. **瞬态用 Toast，持久用卡片**：通道选择由严重程度和可重试性驱动，而非错误来源。瞬态传输错误应用 toast；持久认证错误应用内联卡片。

5. **连接状态是环境性的，不是事件性的**：连接圆点始终可见，反映最后已知状态。断开连接在状态转换时产生 toast，但圆点是权威状态。这避免了在连接不稳定时错误卡片泛滥。

6. **乐观发送带回滚**：用户消息立即出现。仅在确认失败后 UI 才显示错误状态。这与 DiffCard 的乐观 apply->undo 窗口模式相同。

7. **批量工具的错误聚合**：当多个并发工具失败时（ToolRuntime concurrency=10），错误被收集并渲染为单个 `ToolUseSummary` 卡片，包含每个工具的详细错误信息，而不是 10 个单独的错误卡片。

---

## A. 参考资料

- `opencode.md` 第 3.5 节 -- `LLMErrorReason` 10 变体可区分联合类型
- `opencode.md` 第 3.6 节 -- `RouteExecutor` retry：指数退避，2 次重试，500ms 基础，10s 上限
- `opencode.md` 第 4 节 -- MCP `Status` 5 状态可区分联合类型
- `cross-analysis-adapters.md` 第 3 节 -- 每个 Adapter 的 workaround（每个 8 个），错误映射
- `cross-analysis-adapters.md` 第 2 节 -- `ResultPayload` subtypes（5 个错误变体）
- `design-desktop-ux.md` 第 3.2 节 -- DiffCard display/apply/discard 状态机
- `design-desktop-ux.md` 第 2.2.7 节 -- `uiStore` ToastContainer
- `design-desktop-ux.md` 第 2.2.8 节 -- `connectionStore` edgeStatus + reconnect
- `design-desktop-ux.md` 第 2.2.4 节 -- `diffStore` DiffError/CommitError/PushError enums
- `design-desktop-ux.md` 第 4.4-4.5 节 -- Mobile adaptation：bottom sheet + offline indicator
- `deep-dive-claude-code-tool-security.md` 第 3.1 节 -- `SecurityViolation` struct + Severity tiers
- `deep-dive-claude-code-tool-security.md` 第 3.3 节 -- `SecurityPipeline` misparsing vs non-misparsing gate
- `deep-dive-claude-code-tool-security.md` 第 5 节 -- `PolicyEngine.Evaluate()` decision flow
