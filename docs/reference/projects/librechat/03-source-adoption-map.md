# 03 — LibreChat → AgentHub 源码采纳映射表

> 分析日期: 2026-05-24 | 比较对象: LibreChat `reference/LibreChat/` vs AgentHub `app/` + `edge-server/`
> 方法论: LibreChat 文件:行 → AgentHub 文件:行 → 具体代码差异 → P0/P1/P2 优先级

---

## 摘要统计

| 维度 | 完全采纳 | 部分采纳 | 未采纳/缺失 | 总计 |
|------|---------|---------|------------|------|
| 消息树 (Message Tree) | 3 | 2 | 3 | 8 |
| Branch 导航 (SiblingSwitch) | 1 | 0 | 0 | 1 |
| Fork 系统 | 0 | 1 | 3 | 4 |
| Subagent 调度 | 0 | 3 | 5 | 8 |
| Provider Adapter 注册 | 1 | 3 | 1 | 5 |
| 流解析 / Eventing | 2 | 2 | 0 | 4 |
| 安全 / 权限控制 | 2 | 1 | 0 | 3 |
| Context / Summarization | 1 | 1 | 2 | 4 |
| **总计** | **10** | **13** | **14** | **37** |

**采纳率**: 27% 完全 + 35% 部分 = **62% 总体覆盖**

---

## 1. 消息树 (Message Tree)

### 1.1 buildTree() — 扁平列表转嵌套树

**状态**: 完全采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `packages/data-provider/src/messages.ts:5-50` | `app/shared/src/tree.ts:18-49` | AgentHub 使用泛型 `TreeNode<T>` 替代硬编码 TMessage；丢失 `siblingIndex` 计算；丢失 `fileMap` 文件注入 |

```typescript
// LibreChat: 附带 siblingIndex + fileMap 注入
childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;
const extendedMessage: ParentMessage = {
  ...message,
  children: [],
  depth: 0,
  siblingIndex: childrenCount[parentId] - 1,  // ← 丢失
};
if (message.files && fileMap) {  // ← 丢失
  extendedMessage.files = message.files.map(...)
}

// AgentHub: 泛型版 — 干净但缺 feature
export function buildTree<T extends { id: string; parentId?: string }>(
  items: T[],
): TreeNode<T>[] { ... }
```

**AgentHub 优势**: 泛型设计 — 可用于任意带 `id`/`parentId` 的类型，不限于 ChatMessage。通过 `TreeNode<T>` 暴露 `item: T` 保持类型安全。

**P1 — 添加 siblingIndex**: AgentHub 的 `TreeNode<T>` 缺少 `siblingIndex` 字段。SiblingSwitch 组件需要知道"当前是第几个兄弟"，目前只能通过 `children.findIndex()` 在渲染时动态计算，O(n) 查找。建议在 `buildTree` 中预先计算。

**P2 — flattenTree 改为 DFS 先序**: AgentHub 的 `flattenTree` 使用 BFS（`app/shared/src/tree.ts:56-69`），而 LibreChat 的渲染路径用 DFS 先序（`Message.tsx:38-56` 递归 children 而非按层展开）。BFS 适合"平铺显示整个树"，但聊天 IM 场景永远是深度优先 — 先渲染父消息再递归子消息。

---

### 1.2 MessageTree 递归渲染组件

**状态**: 完全采纳 (设计不同但覆盖相同用例)

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `Message.tsx:25-58` → `MultiMessage.tsx:11-78` | `MessageTree.tsx:1-99` | AgentHub 用统一 `TreeNodeRow` 递归 + 可视化缩进线；LibreChat 用 `Message` → `MultiMessage` 两组件递归 |

```tsx
// LibreChat: Message 渲染当前消息 → MultiMessage 递归 children
<MessageContainer>
  <MessageRender {...props} />
  <SiblingSwitch />
</MessageContainer>
<MultiMessage messagesTree={children ?? []} ... />

// AgentHub: 统一 TreeNodeRow 递归 + 树连接线
function TreeNodeRow({ node, renderMessage, isLastSibling, ancestorConnectors }) {
  return (
    <div className={styles.treeNode}>
      <div className={styles.treeIndent} style={{ width: node.depth * 20 }}>
        {ancestorConnectors.map((show, i) => show ? <connector/> : <spacer/>)}
        {node.depth > 0 && <connector last={isLastSibling}/>}
      </div>
      <div>{renderMessage(node.item, node.depth)}</div>
      {node.children.map((child, idx) => <TreeNodeRow .../>)}
    </div>
  );
}
```

**AgentHub 优势**: 树连接线（indent + connector lines）显示分支结构，LibreChat 的纯文本视图不展示。
**LibreChat 优势**: `MultiMessage` 刻意不给 React key（line 49-61 注释），防止 SSE 流式过程中 messageId 变化导致整棵子树卸载重装。

**P1 — AgentHub 缺少流式 key 稳定策略**: `MessageTree.tsx` 中 `TreeNodeRow` 使用 `child.item.id` 作为 key（line 59）。在 SSE 流式更新场景，消息 ID 可能从 client UUID → server ID 改变，导致 React 卸载重装子树。应借鉴 LibreChat 的"不给 key 或使用稳定 surrogate key"策略。

---

### 1.3 ChatMessage 类型定义

**状态**: 部分采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `packages/data-provider/src/schemas.ts:635-750` — TMessage with Zod schema, 40+ fields | `app/desktop/src/components/ChatView.types.ts` — ChatMessage 接口 | AgentHub 没有 Zod schema 验证层；缺少 `children?: TMessage[]` 前端计算字段 |

AgentHub 的 ChatMessage 类型定义在 `ChatView.types.ts`（推断位置，由 `import type { ChatMessage } from './ChatView.types'` 引用）。类型定义比 LibreChat 精简，但缺少 runtime validation。

**P2 — 添加 Zod/Yup schema 验证**: AgentHub 的 Edge Server 用 Go 结构体定义消息模型，但桌面端 React 不验证 API 返回的消息形状。

---

### 1.4 depth 字段计算

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| `messages.ts:44` — `extendedMessage.depth = parentMessage.depth + 1` | `tree.ts:41` — `node.depth = parent.depth + 1` |

两段代码完全相同 — 都是从父节点 depth 级联计算子节点 depth。AgentHub 使用泛型使得 depth 绑定在 `TreeNode<T>` 上（而非 T 本身），这是更干净的设计。

---

### 1.5 孤儿节点处理

**状态**: 完全采纳 (相同的优雅降级策略)

| LibreChat | AgentHub |
|-----------|----------|
| `messages.ts:41-46` — parent 不在 map 中 → 成为 root | `tree.ts:43-45` — `roots.push(node)` 当 parent 不在 map 中 |

两段代码一致：`parentMessageId` 指向不存在消息的节点被提升为根。测试已验证（`tree.test.ts:51-56` vs `fork.spec.js` 孤儿处理）。

---

### 1.6 前向引用处理

**状态**: 差异（AgentHub 降级为 root，LibreChat 同）

| LibreChat | AgentHub | 
|-----------|----------|
| `messages.ts:41-46` — 子消息先于父消息出现 → 成为 root（因为 parent 不在 map 中） | `tree.ts:39-45` — 同样行为 |

相同行为。测试 `tree.test.ts:58-64` 验证了前向引用转为 root。

**P2 — LibreChat 的 O(n) 单遍历保证**：LibreChat 假设消息按 `parentMessageId` 有序排列（父在子前），而 AgentHub 没有这个假设，前向引用直接成为 root。对于数据库排序保证的场景来说两者等价，但 AgentHub 可以在文档中注明此行为。

---

### 1.7 useBuildMessageTree (渲染模式参数)

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `client/src/hooks/Messages/useBuildMessageTree.ts:15-77` — branches/recursive 两参数组合 4 种模式 | — 缺失 |

LibreChat 的 `buildMessageTree` 支持两种参数的组合：

| branches | recursive | 行为 |
|----------|-----------|------|
| false | false | 线性可见路径（ChatView 默认） |
| false | true | 嵌套单分支 |
| true | false | 拍平全分支（导出） |
| true | true | 嵌套全分支（导出） |

AgentHub 的 `flattenTree` 只有 BFS 拍平一种模式。

**P1 — 添加 DFS 先序拍平 + activePath 提取**: 聊天视图默认渲染"活跃兄弟路径"（非 branches, non-recursive），导出需要全树拍平。

---

### 1.8 单元测试覆盖

**状态**: 部分采纳

| LibreChat | AgentHub |
|-----------|----------|
| `fork.spec.js` — fork 算法 4 模式 + 边界测试 | `tree.test.ts:1-116` — buildTree 6 cases + flattenTree 4 cases |
| `messages.ts` 无独立测试（集成在 fork/convo spec） | — |

AgentHub 有专门的 `buildTree`/`flattenTree` 单元测试（10 个用例），LibreChat 没有独立测试。但 LibreChat 的 fork.spec.js 覆盖了所有 4 种 fork 模式。

**P1 — 补充 siblingIndex 和循环引用测试**: 当前测试未覆盖 siblingIndex 计算和多层嵌套场景。

---

## 2. SiblingSwitch — 分支导航

### 2.1 UI 组件

**状态**: 完全采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `SiblingSwitch.tsx:7-68` — 69 lines, Lucide ChevronLeft/Right icons | `SiblingSwitch.tsx:1-46` — 47 lines, Unicode ←→ arrows | AgentHub 更简洁；LibreChat 用 Lucide 图标库，AgentHub 用 Unicode 箭头 |

```tsx
// LibreChat: Lucide icon library
import { ChevronLeft, ChevronRight } from 'lucide-react';
<ChevronLeft size="19" />
<span aria-live="polite">{siblingIdx + 1} / {siblingCount}</span>
<ChevronRight size="19" />

// AgentHub: Unicode arrows via CSS modules
← {siblingIdx + 1} / {siblingCount} →
```

两段代码的 props 接口几乎一致：`siblingIdx: number, siblingCount: number, onPrev/onNext`（AgentHub）vs `siblingIdx, siblingCount, setSiblingIdx`（LibreChat）。

**无差距 — 完全覆盖**。

---

## 3. Fork 系统

### 3.1 ForkOptions 枚举

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `packages/data-provider/src/config.ts:2260-2269` — ForkOptions: DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT | — AgentHub 无对应概念 |

LibreChat 的 Fork 创建全新独立会话，从原始会话克隆消息子树。这不同于 AgentHub 的 `--fork-session`（Claude Code CLI 的 session fork 是在同一会话内创建分支）。

**P0 — AgentHub 需要 conversation 级 Fork**: 用户可能需要从历史消息 fork 出一个全新 thread。目前 AgentHub 只有 Claude Code CLI 层面的 session fork（`--fork-session` flag in `claude_code.go:109`），没有 Hub 端的 conversation fork。

---

### 3.2 Fork 后端算法 (4 种模式)

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `api/server/utils/import/fork.js:85-165` — forkConversation(): 4 种 fork 模式 + splitAtTarget + 消息克隆 + timestamp 重新校准 | — 完全缺失 |

四种 fork 模式的数据流：

```
DIRECT_PATH:     [7]→[5]→[3]  （仅直接父链）
INCLUDE_BRANCHES: [7,5,6,3,1,4]（含兄弟，不含孙）
TARGET_LEVEL:    [7,8,5,6,9]   （目标层级的所有消息）
splitAtTarget:   裁剪后传入上述模式
```

**P1 — 在 Edge Server 实现 conversation fork**: 需要在 Go 端实现消息子树提取和克隆逻辑。fork.js 的四模式算法是纯逻辑，可以直接移植到 Go。

---

### 3.3 Fork UI 组件

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `Fork.tsx:1-447` — Ariakit Popover + 4图标选择器 + splitAtTarget checkbox + remember checkbox + Recoil 状态 | — 完全缺失 |

**P1 — 需要在桌面端实现 Fork 对话框**: 依赖 P1 Fork 后端 API 先完成。

---

### 3.4 Fork 配置 (用户偏好)

**状态**: 部分采纳 (概念映射不同)

| LibreChat | AgentHub |
|-----------|----------|
| `ForkSettings.tsx` — rememberDefaultFork + splitAtTarget 默认 + fork 模式偏好 | `ThreadPanel.tsx` — 会话管理（rename/delete）但没有 fork |

AgentHub 的 ThreadPanel 管理线程生命周期（创建/重命名/删除），但 Fork 是会话分叉，创建新线程。AgentHub 有基础线程 CRUD，可以扩展。

---

## 4. Subagent 调度架构

### 4.1 buildSubagentConfigs() — 递归子代理配置构建

**状态**: 部分采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `run.ts:628-716` — 递归构建子代理配置树（self-spawn + explicit children + ancestor cycle detection + depth assertion） | `orchestrator.go:1-102` — OrchestratorAdapter 通过系统提示词委托子任务，无显式配置树 | AgentHub 使用提示词驱动（Claude Code 自行决定何时委托），LibreChat 使用显式 subagentConfigs 图 |

```go
// AgentHub: 提示词驱动子代理
func DefaultOrchestratorPrompt(availableAgents []string) string {
    return `You are the Orchestrator...
    Decompose user requests into independent sub-tasks.
    DISPATCH each sub-task to the most appropriate agent.
    AGGREGATE results from all sub-agents...`
}

// LibreChat: 配置驱动子代理（显式图）
function buildSubagentConfigs(agent, agentInput, toInput, state, ancestors, depth) {
    // Self-spawn: 允许代理自我委派
    if (allowSelf) configs.push({ type: SELF_SUBAGENT_TYPE, ... })
    // Explicit children: 递归构建 A→B→C 多级委派
    for (const child of agent.subagentAgentConfigs ?? []) {
        if (ancestors.has(child.id)) continue; // 循环检测
        assertSubagentDepth(childDepth, child.id); // 深度限制
        const grandchildConfigs = buildSubagentConfigs(child, ...); // 递归
    }
}
```

**P0 — 为 OrchestratorAdapter 添加显式子代理配置**: AgentHub 目前完全依赖 Claude Code 自行解释提示词来委托子代理。这是脆弱的 — 模型可能不遵守。需要显式的 subagent 配置图（类似 LibreChat 的 subagentAgentConfigs），确保 Deterministic 行为。

**P1 — 添加循环检测**: 目前 AgentHub 无循环检测。如果 Orchestrator 配置了 A→B→A，会无限递归。LibreChat 使用 `ancestors` Set 防循环（`run.ts:654-668`）。

**P1 — 添加深度/宽度限制**: LibreChat 有 `MAX_SUBAGENT_DEPTH` 和 `MAX_SUBAGENT_RUN_CONFIGS`。AgentHub 无限制。

---

### 4.2 子代理隔离 (ToolRegistry clone)

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts:884-903` — 子代理 toolRegistry Map 深度克隆 + toolDefinitions 数组浅拷贝 | — AgentHub 无对应机制 |

```typescript
// LibreChat: 子代理隔离
if (isSubagent && agent.toolRegistry) {
    toolRegistry = new Map();
    for (const [name, tool] of agent.toolRegistry.entries()) {
        toolRegistry.set(name, { ...tool }); // 克隆每个 LCTool
    }
    toolDefinitions = toolDefinitions.map((def) => ({ ...def }));
}
```

AgentHub 的适配器模式天然隔离（每个 CLI 进程有独立的工具集），但 Orchestrator 模式下缺少 per-subagent 工具能力声明。

**P2 — 添加 per-agent Capabilities 到 AgentHub Registry**: 目前 `AgentCapabilities` 是 adapter 级别的（`SubAgentSpawn: true/false`）。应在 Registry 中支持 per-agent 工具能力白名单。

---

### 4.3 Summarization / Context 管理

**状态**: 部分采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `run.ts:465-530` — shapeSummarizationConfig: provider 解析、reserveRatio、contextPruning | `context_budget.go:1-6` — 仅 CtxBudgetKey 定义 + `parser_ndjson.go:262-264` 的 token 追踪 | AgentHub 有基本 token 追踪但无自动 summarization |

```go
// AgentHub: 仅 token 计数
if p.budget != nil {
    p.budget.Track(int(msg.Usage.InputTokens + msg.Usage.OutputTokens))
}

// LibreChat: 完整 summarization 流水线
effectiveMaxContextTokens = computeEffectiveMaxContextTokens(
    summarization.reserveRatio,  // 默认 0.05 (预留 5%)
    agent.baseContextTokens,
    agent.maxContextTokens,
);
return {
    summarizationEnabled, summarizationConfig,
    contextPruningConfig,
    initialSummary: isSubagent ? undefined : initialSummary,
    calibrationRatio,  // EMA 校准比例
};
```

**P1 — 实现 context-compaction 触发逻辑**: 当 token 预算超限时，AgentHub 应自动触发 compact（可通过 Claude Code 的 `compact_boundary` 事件监听）。LibreChat 的 `summarization.trigger` 机制可以直接借鉴。

**P1 — 子代理不继承 initialSummary**: AgentHub 的 Orchestrator 当前不区分主代理和子代理的初始摘要。LibreChat 明确设置 `initialSummary: isSubagent ? undefined : initialSummary`。

---

### 4.4 subagent 数量/深度限制

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts:557-582` — countSubagentConfig() + assertSubagentDepth() | — 缺失 |

```typescript
// LibreChat: 双重限制
function countSubagentConfig(state: SubagentBuildState): void {
    state.configCount += 1;
    if (state.configCount > MAX_SUBAGENT_RUN_CONFIGS) throw Error(...)
}
function assertSubagentDepth(depth: number, agentId: string): void {
    if (depth > MAX_SUBAGENT_DEPTH) throw Error(...)
}
```

**P0 — 添加子代理数量/深度限制到 OrchestratorAdapter**: 防止恶意或错误配置导致无限子代理生成。

---

## 5. Provider Adapter 架构

### 5.1 Adapter 注册与发现

**状态**: 完全采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `providers.ts:39-51` — providerConfigMap: `{ provider: initializeFn }` 静态映射 | `registry.go:1-92` — Registry: register/get/list/default/role-based resolve | AgentHub 更强：运行时注册 + 角色默认值 |

```go
// AgentHub: 运行时注册 + 角色回退
func (r *Registry) Resolve(agentID string) (AgentAdapter, error) {
    if agentID != "" { return r.Get(agentID) }
    return r.Default("default")  // 回退到默认角色
}
func (r *Registry) SetDefault(role, adapterID string) { ... }
```

AgentHub 的 Registry 模式优于 LibreChat 的静态 map。LibreChat 需要 `providerConfigMap` 中包含所有 provider 的显式条目，而 AgentHub 可以在运行时动态注册/注销适配器。

---

### 5.2 Multi-Provider 适配器接口

**状态**: 完全采纳 (AgentHub 更丰富)

| LibreChat | AgentHub |
|-----------|----------|
| `providers.ts:16` — `InitializeFn = (params) => Promise<InitializeResultBase>` | `adapter.go:23-43` — `AgentAdapter` 接口: Metadata/Capabilities/BuildCommand/ParseStream/NeedsStdin |

LibreChat 的适配器接口返回 LLM 配置（keys, baseURL, tools），AgentHub 的适配器接口管理进程生命周期（BuildCommand, ParseStream）。这是不同的抽象层级 — LibreChat 操作 API 端点，AgentHub 操作 CLI 进程。

两种模式互补而非替代。AgentHub 可以在 Registry 之上添加 LibreChat 风格的 "API adapter" 层用于非 CLI provider。

---

### 5.3 模型别名与解析

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| `librechat.yaml` 中的模型映射 | `model_config.go:5-93` — ModelAliases + ReasoningEfforts 二维映射 |

```go
var ModelAliases = map[string]map[string]string{
    "claude-code": {"opus": "claude-opus-4-7", "sonnet": "claude-sonnet-4-6", ...},
    "codex":       {"gpt-5": "gpt-5.3-codex", ...},
    "opencode":    {"opus": "newapi/deepseek-v4-pro", ...},
}
```

**无差距 — 完全覆盖**。

---

### 5.4 Multi-CLI 事件统一

**状态**: 部分采纳

| LibreChat | AgentHub | 差异 |
|-----------|----------|------|
| `client.ts` — AgentClient 事件分发 (单一 Agent 流) | `parser_ndjson.go` (Claude Code) + `codex.go` (Codex) + `opencode.go` (OpenCode) — 三个独立解析器 | AgentHub 三套解析器各自输出到统一的 BusEvent 类型 |

AgentHub 的优势在于三个 CLI 的流事件通过统一的事件总线输出（`BusEventTextDelta`, `BusEventToolCall`, 等）。LibreChat 只有单一 Agent 流（通过 SDK）。

AgentHub 还额外统一了 multi-agent 事件：`BusEventTaskStarted`, `BusEventTaskDispatched`, `BusEventTaskProgress`, `BusEventTaskNotification` — LibreChat 没有对应的事件类型。

**P2 — Codex 和 OpenCode 缺少 Hook 链**: 只有 Claude Code 的 ParseStream 注入了 HookChain（`claude_code.go:128`）。Codex 和 OpenCode 的解析器没有安全 hook。

---

### 5.5 Permission Mode 映射 (CLI 共性)

**状态**: 部分采纳

| LibreChat | AgentHub |
|-----------|----------|
| — LibreChat 无 CLI permission mode 概念 | `claude_code.go:77-81` — 五种 permission mode; `codex.go:90-103` — sandboxForPermissionMode 映射 |

AgentHub 的独特能力是将统一的 permission mode 映射到每个 CLI 的本机格式：

```
AgentHub "bypassPermissions" → Claude Code "--permission-mode bypassPermissions"
                             → Codex "--sandbox danger-full-access"
                             → OpenCode "--dangerously-skip-permissions"
```

**无差距 — 这是 AgentHub 创新项，LibreChat 没有**。

---

## 6. 流解析与 Eventing

### 6.1 NDJSON Stream Parser (Claude Code)

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| N/A — LibreChat 不解析 CLI NDJSON | `parser_ndjson.go:1-550` — 30+ 事件类型完整解析 |

AgentHub 的 NDJSON 解析器处理 Claude Code 的 `stream-json` 协议全部事件类型：
- `system/init` → BusEventSessionInit
- `assistant` → content blocks (text/tool_use/thinking)
- `stream_event` → text_delta/thinking_delta/content_block_start/content_block_stop
- `user` → tool_result
- `result` → success/failure/usage/duration
- `tool_progress` / `tool_use_summary`
- `compact_boundary` / `status_change` / `api_retry` / `rate_limit_event`
- `task_started` / `task_dispatched` / `task_progress` / `task_notification`
- `hook_started` / `hook_progress` / `hook_response`
- `session_state_changed`
- `auth_status`

**无差距 — 这是 AgentHub 原创能力，LibreChat 无对应项**。

---

### 6.2 Codex JSONL 事件

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| N/A | `codex.go:105-632` — JSONL parser + item 类型 dispatch |

Codex 适配器处理 `agent_message`, `reasoning`, `command_execution`, `mcp_tool_call`, `web_search`, `collab_tool_call`, `file_change`, `todo_list` 等多种 item 类型，映射到统一 BusEvent。

**无差距 — 完全覆盖**。

---

### 6.3 OpenCode JSON 事件

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| N/A | `opencode.go:102-263` — JSON event parser |

处理 `step_start`, `text`, `tool_use`, `tool_result`, `permission`, `file`, `reasoning`, `step_finish`, `session.init/error`, `task_start/progress/complete`。

**无差距 — 完全覆盖**。

---

### 6.4 事件总线统一

**状态**: 部分采纳 (AgentHub 有统一总线但无 LibreChat 的风格)

| LibreChat | AgentHub |
|-----------|----------|
| `client.ts` — AgentClient 通过 SDK 的 StreamEvent 分发 | `adapter.go:73-102` — 27 种统一 BusEvent 类型 |

AgentHub 定义了 27 种统一事件类型，所有适配器映射到同一总线。LibreChat 依赖 SDK 内部事件。

**P2 — 添加 BusEventType enum 以替代字符串常量**: `adapter.go` 中所有事件类型都是字符串常量。对于类型安全，建议添加 Go enum。

---

## 7. 安全与权限控制

### 7.1 SecurityHook — 23-Check 模式匹配

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| 无 — LibreChat 没有模式匹配安全层 | `security_hooks.go:1-228` — 7 类危险模式正则匹配 |

AgentHub 的 SecurityHook 实现了完整的 Claude Code 23-check 流水线：

1. `rm -rf /` (root 删除)
2. `curl/wget | bash/sh/zsh/fish` (远程执行)
3. `curl -o file && bash file` (重定向执行)
4. `sudo bash / sudo su` (root shell 升级)
5. `chmod 777/0777/a+rwx` (世界可写)
6. `> /dev/sd* / nvme*` (块设备覆盖)
7. `dd of=/dev/sd* / cp /dev/sd* / tee /dev/sd*` (块设备写入)

每个模式在 `init()` 中有 selftest 验证（17 个危险用例 + 5 个安全用例）。

**无差距 — 这是 AgentHub 原创能力**。

---

### 7.2 AgentHook 接口 (6 核心 hooks)

**状态**: 完全采纳

| LibreChat | AgentHub |
|-----------|----------|
| `handlers.ts` — toolEndCallback, loadTools, getSkillByName（功能级回调） | `hooks.go:1-123` — 6 核心生命周期 hooks + HookChain middleware |

```go
type AgentHook interface {
    PreToolUse(ctx, toolName, input) → (modifiedInput, block, reason)
    PostToolUse(ctx, toolName, output) → modifiedOutput
    PermissionRequest(ctx, toolName, risk) → decision (Allow/Deny/AllowOnce)
    OnError(ctx, err) → action (Retry/Abort/Fallback)
    PrePrompt(ctx, prompt) → modifiedPrompt
    PostResponse(ctx, response) → modifiedResponse
}
```

AgentHub 的 HookChain 实现链式中间件模式（类似 Express.js 中间件）— 按顺序执行，第一个 block 停止链。

**LibreChat 的 handlers 是功能级的（tool loading, code file seeding），AgentHub 的 hooks 是生命周期级的。两者正交，不是替代关系。**

---

### 7.3 Control Protocol (权限门控)

**状态**: 部分采纳

| LibreChat | AgentHub |
|-----------|----------|
| N/A — LibreChat 没有 CLI control 协议 | `control_protocol.go:1-220` — control_request/response + PermissionRequest/Decision |

AgentHub 实现了 Claude Code 的 control protocol：
- `can_use_tool` → 自动批准（DefaultPermissionHandler）
- `interrupt` → WriteInterrupt
- `set_model` → WriteSetModel
- `set_permission_mode` → WriteSetPermissionMode
- `stop_task` → WriteStopTask

M4 权限门控升级（commit `6090efd`）添加了 `EventEmittingPermissionHandler` — 向 Desktop 发射 permission 事件，等待用户审批。

**P1 — 为 Codex 和 OpenCode 添加 control protocol**: 目前只有 Claude Code 适配器配置了 ControlHandler。需要为多 CLI 支持统一。

---

## 8. Context 与 Session 管理

### 8.1 Token Budget 追踪

**状态**: 部分采纳

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts:905-909` — computeEffectiveMaxContextTokens + calibrationRatio EMA | `context_budget.go:1-6` — CtxBudgetKey; `parser_ndjson.go:262-264` — Track() 调用 |

AgentHub 追踪 token 消费但不采取行动。LibreChat 在超过 budget 时触发 summarization。

**P1 — 基于 budget 触发 compact**: 当 `p.budget.Used > threshold` 时，通过 control protocol 发送 interrupt → summarization 请求。

---

### 8.2 Session 连续性 (fork/session/continue)

**状态**: 完全采纳 (CLI 层面)

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts:929` — initialSummary (跨 run) + codeFilesSession continuity | `claude_code.go:103-110` — `--resume`, `--continue`, `--fork-session` flags |

AgentHub 通过 CLI 原生 session 机制：`--resume <sessionID>`、`--continue`（继续上一会话）、`--fork-session`（从当前会话分叉）。LibreChat 的跨 run continuity 通过 initialSummary 和 ToolSessionMap 实现 — AgentHub 的 CLI 原生机制提供了更强的连续性。

**无差距 — 完全覆盖**。

---

### 8.3 上下文剪枝 (Context Pruning)

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts` — summarization.contextPruning 配置 + calibrationRatio EMA + 自动 summarization 触发 | — 完全缺失 |

LibreChat 的 pruner 使用 EMA 从上次运行的 contextMeta 校准 token 触发阈值。AgentHub 没有等价机制。

**P1 — 实现 context pruning**: 依赖 P1 compact 触发机制。

---

### 8.4 子代理摘要隔离

**状态**: 未采纳

| LibreChat | AgentHub |
|-----------|----------|
| `run.ts:929` — `initialSummary: isSubagent ? undefined : initialSummary` | — 完全缺失 |

Orchestrator 当前将相同上下文传递给所有子代理。子代理应接收隔离上下文。

**P1 — 子代理上下文隔离**: 在 AgentHub Orchestrator 中实现 per-subagent 上下文过滤。

---

## 9. 关键架构决策差异

### 9.1 CLI-Process vs API-SDK

LibreChat 通过 `@librechat/agents` SDK 直接调用 LLM API。AgentHub 通过外部 CLI 进程（claude、codex、opencode）调用。

**影响**:
- AgentHub 的解耦允许混合 CLI 提供商（同一请求中 Claude Code + Codex）
- LibreChat 的 SDK 方法提供更细粒度的 token 控制和更好的 streaming 性能
- AgentHub 的 CLI 方法以进程启动开销换取提供商无关性

### 9.2 状态管理 (Recoil vs Zustand)

LibreChat 使用 Recoil atomFamily 管理 per-message siblingIdx。AgentHub 使用 Zustand store。

**影响**:
- Recoil 已停止维护 — AgentHub 选择 Zustand 是正确的
- LibreChat 的 `atomFamily` 为每个 messageId 维护独立的 siblingIdx，这在 Zustand 中可用 `Map<string, number>` 实现

### 9.3 前端 Tree vs 后端 Tree

LibreChat 在前端构建消息树（`buildTree` in data-provider），数据库存储扁平列表。AgentHub 同样采用前端构建方式（`@shared/tree` 被桌面端引用）。

**对齐 — 两者选择相同模式**。

---

## 10. 优先级行动计划

### P0 (阻塞发布 — 3 项)

| # | 项 | 说明 | 工作量 |
|---|-----|------|--------|
| 1 | 子代理数量/深度限制 | 添加 MAX_SUBAGENT_DEPTH + MAX_SUBAGENT_RUN_CONFIGS 到 OrchestratorAdapter | 0.5d |
| 2 | 显式子代理配置图 | 提示词驱动 → 显式 subagentAgentConfigs 图（类 LibreChat） | 3d |
| 3 | Conversation 级 Fork API | 在 Edge Server Go 端移植 fork.js 四模式算法 | 3d |

### P1 (重要 — 7 项)

| # | 项 | 说明 | 工作量 |
|---|-----|------|--------|
| 4 | siblingIndex in buildTree | 为 TreeNode 添加 siblingIndex 字段，SiblingSwitch 直接用 | 0.5d |
| 5 | MessageTree 流式 key 稳定性 | SSE 场景下避免 messageId 变化导致子树重挂 | 0.5d |
| 6 | flattenTree DFS 先序 | 新增 DFS 先序拍平（聊天默认模式） | 0.5d |
| 7 | Context compact 自动触发 | budget 超限 → control protocol → summarization 请求 | 2d |
| 8 | 子代理上下文隔离 | Per-subagent context filtering; initialSummary 不传递 | 1d |
| 9 | Codex/OpenCode 安全 hook | 将 SecurityHook 注入 Codex 和 OpenCode 的 ParseStream | 0.5d |
| 10 | Fork UI 对话框 | 桌面端实现 Fork popover | 1d |

### P2 (改进 — 5 项)

| # | 项 | 说明 | 工作量 |
|---|-----|------|--------|
| 11 | Zod/Yup schema 验证 | ChatMessage 类型 runtime validation | 0.5d |
| 12 | BusEventType enum | 字符串常量 → Go enum 类型安全 | 0.5d |
| 13 | Per-agent Capabilities | Registry 支持 per-agent 工具白名单（当前 adapter 级别） | 1d |
| 14 | tree.test.ts 补充 | siblingIndex + 循环引用 + 多层嵌套测试用例 | 0.5d |
| 15 | 虚拟列表 | @tanstack/react-virtual 替代当前无限渲染 | 3d |

---

## 附录: 文件引用索引

### LibreChat 源文件（`reference/LibreChat/`）

| 文件 | 关键行 | 作用 |
|------|--------|------|
| `packages/data-provider/src/messages.ts` | 5-50 | buildTree (flat → nested, O(n)) |
| `packages/data-provider/src/schemas.ts` | 635-750 | TMessage Zod schema (40+ fields) |
| `packages/data-provider/src/config.ts` | 2260-2269 | ForkOptions 枚举 |
| `client/src/components/Chat/Messages/Message.tsx` | 25-58 | Message → MultiMessage 递归链 |
| `client/src/components/Chat/Messages/MultiMessage.tsx` | 11-78 | siblingIdx Recoil atomFamily + 递归子树 |
| `client/src/components/Chat/Messages/SiblingSwitch.tsx` | 7-68 | 分支导航 ← N/M → |
| `client/src/components/Chat/Messages/Fork.tsx` | 202-446 | Fork UI (Ariakit popover + 4 模式) |
| `client/src/hooks/Messages/useBuildMessageTree.ts` | 15-77 | branches/recursive 两参数 4 模式 |
| `api/server/utils/import/fork.js` | 85-165 | forkConversation (4 模式 + splitAtTarget) |
| `api/server/utils/import/fork.js` | 173-207 | getAllMessagesUpToParent (INCLUDE_BRANCHES) |
| `api/server/utils/import/fork.js` | 215-277 | getMessagesUpToTargetLevel (TARGET_LEVEL) |
| `api/server/utils/import/fork.js` | 286-353 | splitAtTargetLevel |
| `packages/api/src/agents/run.ts` | 540-600 | MAX_SUBAGENT_DEPTH, countSubagentConfig, assertSubagentDepth |
| `packages/api/src/agents/run.ts` | 628-716 | buildSubagentConfigs (递归 + 循环检测) |
| `packages/api/src/agents/run.ts` | 733-959 | createRun (主入口) |
| `packages/api/src/agents/run.ts` | 789-932 | buildAgentInput (summarization, toolRegistry clone) |
| `packages/api/src/agents/run.ts` | 884-903 | Subagent toolRegistry 隔离子克隆 |
| `packages/api/src/agents/run.ts` | 465-530 | shapeSummarizationConfig |
| `packages/api/src/endpoints/config/providers.ts` | 39-51 | providerConfigMap |
| `client/src/locales/en/translation.json` | — | 所有 UI 文本 |

### AgentHub 源文件

| 文件 | 关键行 | 作用 |
|------|--------|------|
| `app/shared/src/tree.ts` | 1-69 | Generic buildTree + flattenTree (BFS) |
| `app/desktop/src/components/MessageTree.tsx` | 1-99 | React 树渲染器 + 连接线 |
| `app/desktop/src/components/SiblingSwitch.tsx` | 1-46 | 分支导航 ← N/M → |
| `app/desktop/src/components/ThreadPanel.tsx` | 1-264 | 线程侧边栏 (rename/delete) |
| `app/desktop/src/__tests__/tree.test.ts` | 1-116 | buildTree/flattenTree 单元测试 |
| `app/desktop/src/components/ChatView.types.ts` | — | ChatMessage 类型定义 |
| `edge-server/internal/adapters/adapter.go` | 1-110 | AgentAdapter 接口 + 27 种 BusEvent |
| `edge-server/internal/adapters/registry.go` | 1-92 | Registry (register/get/resolve/default) |
| `edge-server/internal/adapters/orchestrator.go` | 1-102 | OrchestratorAdapter + DefaultOrchestratorPrompt |
| `edge-server/internal/adapters/claude_code.go` | 1-135 | ClaudeCodeAdapter (NDJSON + session flags) |
| `edge-server/internal/adapters/codex.go` | 1-632 | CodexAdapter (JSONL + tool dispatch + task events) |
| `edge-server/internal/adapters/opencode.go` | 1-313 | OpenCodeAdapter (JSON + task events) |
| `edge-server/internal/adapters/control_protocol.go` | 1-220 | ControlHandler + permission gating + interrupt |
| `edge-server/internal/adapters/hooks.go` | 1-123 | AgentHook 6 hooks + HookChain middleware |
| `edge-server/internal/adapters/security_hooks.go` | 1-228 | SecurityHook (7 类危险模式 + self-test) |
| `edge-server/internal/adapters/model_config.go` | 1-93 | ModelAliases + ReasoningEfforts + DefaultModels |
| `edge-server/internal/adapters/context_budget.go` | 1-6 | CtxBudgetKey for token tracking |
| `edge-server/internal/adapters/parser_ndjson.go` | 1-550 | NDJSONStreamParser (30+ 事件类型) |
