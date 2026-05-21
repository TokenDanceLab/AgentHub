# LibreChat 深度调研报告

> 调研日期: 2026-05-21 | 仓库: `danny-avila/LibreChat` (MIT) | 分支: `main` (shallow clone)

## 1. IM 产品设计借鉴

### 1.1 消息树 (Message Tree) 与分支 (Branching)

**核心数据模型**: `buildTree({ messages, fileMap })` (`client/src/components/Chat/ChatView.tsx:45-50`)

LibreChat 将所有消息构建为一棵树，而非线性列表。每个节点的 `children` 字段为子消息数组，根节点为第一个消息。用户可以从任意消息出发生成新回复，形成 sibling（兄弟节点）关系。

**分支切换 UI** (`client/src/components/Chat/Messages/SiblingSwitch.tsx:7-61`):
- `siblingIdx` / `siblingCount` 双指针驱动，左右箭头切换兄弟消息
- 显示 `{siblingIdx + 1} / {siblingCount}` 导航指示器
- `siblingCount > 1` 时才渲染，不污染单个分支的 UI

**Message 渲染链**: `Message.tsx` -> `MessageRender` (ui/MessageRender.tsx) -> `ContentRender.tsx` -> `Content/` 子目录 (Markdown/Code/Image 等) -> 子消息通过 `MultiMessage.tsx` 递归展开 `children` 树

### 1.2 Fork (会话分叉) 机制

**组件**: `client/src/components/Chat/Messages/Fork.tsx`

**四种 Fork 模式** (`ForkOptions` 枚举):

| 模式 | 含义 | 实现效果 |
|------|------|---------|
| `DIRECT_PATH` | 可见路径 | 仅复制从根消息到目标消息的直接父链 |
| `INCLUDE_BRANCHES` | 含兄弟分支 | 复制完整消息树，保留所有兄弟分支 |
| `TARGET_LEVEL` | 目标层级 | 复制目标消息所在层级的所有消息（默认） |
| `DEFAULT` | 从消息开始 | 从当前消息开始 fork，不包含祖先 |

**实现**: 使用 `useForkConvoMutation` hook 触发 `forkConvo.mutate({ messageId, conversationId, option })`。Git 风格的视觉隐喻 (`GitFork` / `GitCommit` / `GitBranchPlus` icons)。

### 1.3 会话列表

**组件**: `client/src/components/Conversations/Conversations.tsx`
- 使用 `react-virtualized` 的 `AutoSizer` + `List` + `CellMeasurer` 实现虚拟化大列表
- 按日期分组: `groupConversationsByDate()`
- 支持收藏列表、搜索过滤、活跃 job 状态指示

每个 `Convo` 卡片 (`Convo.tsx`) 显示: 模型图标、标题、最后消息摘要、时间、`HoverToggle`(可隐藏/显示)。

### 1.4 Artifacts 渲染

**核心组件**: `client/src/components/Artifacts/Artifacts.tsx`

**架构**:
- **Tab 系统** (`@radix-ui/react-tabs`): Code 标签 + Preview 标签
- **Code 编辑器**: `@codesandbox/sandpack-react` 提供实时代码编辑/预览
- **支持格式**: React/HTML 通过 Sandpack 渲染; Mermaid 图表独立渲染 (`Mermaid.tsx`)
- **分屏模式**: 移动端响应式面板，可拖拽调整高度 (`setIsDragging` 拖拽手柄)
- **版本管理**: `ArtifactVersion.tsx` / `ArtifactTabs.tsx` 支持多版本切换
- **下载**: `DownloadArtifact.tsx` 导出 artifact 文件
- **宽度控制**: 通过 CSS变量 `--artifact-width` 控制 Artifacts 面板宽度

**Code vs Preview 判定** (`client/src/common/artifacts.ts`): `isCodeOnlyArtifact` / `isPreviewOnlyArtifact` 函数判断 artifact 类型，决定显示哪些 tab。

### 1.5 SidePanel (侧边栏面板)

**目录**: `client/src/components/SidePanel/`
- `AgentsPanel.tsx` - Agent 编辑/配置面板
- `BuilderPanel.tsx` - Assistant Builder
- `MCPBuilder/` - MCP Server 配置面板
- `Parameters/Panel.tsx` - 模型参数调整
- `Bookmarks/Panel.tsx` - 书签管理
- `Files/` - 文件管理 (含 Vector Store)
- `Memories/Panel.tsx` - 记忆管理

### 1.6 Agent 市场与发现

**组件**: `client/src/components/Agents/Marketplace.tsx`
- Agent 网格卡片 (`AgentGrid.tsx`) 带虚拟化 (`VirtualizedAgentGrid.tsx`)
- 分类标签 (`CategoryTabs.tsx`)、搜索 (`SearchBar.tsx`)
- Agent 详情 (`AgentDetail.tsx` / `AgentDetailContent.tsx`)
- 权限管理: `Sharing/` 目录提供 People Picker + Access Roles

---

## 2. Subagent 调度架构

### 2.1 核心入口: `createRun()`

**文件**: `packages/api/src/agents/run.ts:733-959`

```
createRun({ agents, signal, messages, summarizationConfig, initialSummary, ... })
  │
  ├─ extractDiscoveredToolsFromHistory(messages)    // line 784-787
  ├─ buildAgentInput = (agent, {isSubagent}) => {}  // line 789-932
  │   ├─ shapeSummarizationConfig()                 // line 797-804
  │   ├─ normalizeAgentModelParameters()            // line 806
  │   ├─ 构建 systemContent / additionalInstructions // line 822-828
  │   ├─ Subagent隔离: 深度克隆 toolRegistry Map    // line 884-902
  │   └─ 构造 RunConfig 对象                        // line 910-932
  │
  ├─ buildSubagentConfigs(agent, ...) for each agent // line 942-947
  └─ 组装 graphConfig + runId                       // line 954-959
```

### 2.2 `buildSubagentConfigs()`: 递归子代理配置

**文件**: `packages/api/src/agents/run.ts:628-716`

**参数签名**:
```typescript
function buildSubagentConfigs(
  agent: RunAgent,
  agentInput: AgentInputs,
  toInput: (child: RunAgent, opts?: { isSubagent?: boolean }) => AgentInputs,
  state: SubagentBuildState,      // { configCount, rootAgentIds }
  ancestors: Set<string> = new Set(), // 循环检测
  depth = 0,                       // 深度计数
): SubagentConfig[]
```

**关键步骤**:

1. **Self-spawn** (line 643-651): 当 `agent.subagents.enabled && allowSelf !== false` 时插入 `type: SELF_SUBAGENT_TYPE` 配置项，允许 agent 自我委派

2. **循环检测** (line 654-660): 
   - 将当前 `agent.id` 加入 `ancestors` Set
   - 遍历孩子时，如果 `ancestors.has(child.id)` 则跳过（line 666-668）
   - 额外护盾: `child.id === agent.id` 一并跳过（line 663-665）
   - **保证 `A -> B -> A` 配置停在第二次碰到 A**，不会无限递归

3. **深度断言** (line 669-670): 
   ```typescript
   assertSubagentDepth(childDepth, child.id);  // 调用 line 571-582
   // depth > MAX_SUBAGENT_DEPTH 时抛出 Error
   ```

4. **递归 Build** (line 694-701):
   ```typescript
   const grandchildConfigs = buildSubagentConfigs(
     child, childInputs, toInput, state,
     nextAncestors,     // 携带祖先集合
     childDepth,        // +1
   );
   ```
   实现 **A -> B -> C 三级委派**，而非仅顶层展开

5. **数量限制** (line 556-568):
   ```typescript
   function countSubagentConfig(state) {
     // state.configCount > MAX_SUBAGENT_RUN_CONFIGS 时抛出
   }
   ```

### 2.3 Subagent 隔离: ToolRegistry 克隆

**文件**: `packages/api/src/agents/run.ts:884-903`

当 `isSubagent === true` 时:
```typescript
// Clone Map + 每个 LCTool 对象（浅拷贝隔离 defer_loading flag）
toolRegistry = new Map();
for (const [name, tool] of agent.toolRegistry.entries()) {
  toolRegistry.set(name, { ...tool });
}
// Clone toolDefinitions 数组（浅拷贝每个定义对象）
toolDefinitions = toolDefinitions.map((def) => ({ ...def }));
```

**设计意图**: 父级 agent 的 `overrideDeferLoadingForDiscoveredTools` 会 write-through 修改 tool 对象上的 flag。如果不克隆，子 agent 的 tool 定义会被父级后续 mutation 污染。

### 2.4 容器限制汇总

| 限制 | 常量 | 作用位置 | 错误处理 |
|------|------|---------|---------|
| 子代理最大深度 | `MAX_SUBAGENT_DEPTH` | `run.ts:572` | 抛出 Error |
| 子代理配置总数 | `MAX_SUBAGENT_RUN_CONFIGS` | `run.ts:561` | 抛出 Error |
| 每轮最多 skill primes | `MAX_PRIMED_SKILLS_PER_TURN` | `initialize.ts:642` | truncate (先裁 always-apply) |

### 2.5 其他 Agent 文件概览

| 文件 | 职责 |
|------|------|
| `initialize.ts` (1030 lines) | Agent 初始化: 文件加载、工具解析、provider 配置、skill catalog 注入、code execution 注册、context token 计算 |
| `handlers.ts` | 工具执行回调: `loadTools`、`toolEndCallback`、`getSkillByName`、`batchUploadCodeEnvFiles` |
| `skills.ts` | Skill 注入逻辑: `injectSkillCatalog`、`resolveManualSkills`、`resolveAlwaysApplySkills` |
| `skillConfigurable.ts` | 运行时 configurable 字段注入 (userMCPAuthMap 等) |
| `skillFiles.ts` | Skill 文件操作: `primeSkillFiles`、文件流式下载 |
| `client.ts` | AgentClient 封装: 事件分发、message formatting |
| `memory.ts` | 记忆工具: `set_memory` / `delete_memory` / `getFormattedMemories` |
| `chain.ts` | Agent 链: `createSequentialChainEdges` (顺序边 + buffer prompt) |
| `added.ts` | 动态 agent 添加: ephemeral agent 与持久化 agent 的统一入口 |

---

## 3. Provider Adapter 与 MCP 机制

### 3.1 Provider Adapter 模式

**Dispatcher Map** (`packages/api/src/endpoints/config/providers.ts:39-51`):

```typescript
export const providerConfigMap: Record<string, InitializeFn> = {
  xai:          initializeCustom,        // openAI兼容
  deepseek:     initializeCustom,        // openAI兼容
  moonshot:     initializeCustom,        // openAI兼容
  openrouter:   initializeCustom,        // openAI兼容
  vertexai:     initializeGoogle,        // Google 路径(Service Account)
  openAI:       initializeOpenAI,        // OpenAI + Azure
  google:       initializeGoogle,        // Google Gemini
  bedrock:      initializeBedrock,       // AWS Bedrock
  azureOpenAI:  initializeOpenAI,        // Azure OpenAI
  anthropic:    initializeAnthropic,     // Anthropic Claude + Vertex AI
};
```

**适配器接口** (`providers.ts:16`):
```typescript
type InitializeFn = (params: BaseInitializeParams) => Promise<InitializeResultBase>;
// BaseInitializeParams: { req, endpoint, model_parameters, db }
// InitializeResultBase: { llmConfig, tools, provider, endpointTokenConfig, useLegacyContent, configOptions }
```

**每个 Provider 适配器的职责**:
1. 解析认证凭据 (API key / Service Account / user-provided key / Vertex AI OAuth)
2. 组装 `llmConfig` (包含 baseURL、headers、model 参数)
3. 解析工具列表 (provider native tools)
4. 返回 provider 名、token 配置、legacy-content 标志

**示例** - Anthropic (`packages/api/src/endpoints/anthropic/initialize.ts:15-80`):
- 支持 Direct API Key + Vertex AI 两种认证模式
- Vertex AI: 从 YAML config 读取 `credentials`、`region`、`projectId`
- Direct API: 支持 reverse proxy (`ANTHROPIC_REVERSE_PROXY`) 和 user-provided key

### 3.2 MCP Server 集成架构

**核心类关系**:
```
MCPManager (singleton)                       packages/api/src/mcp/MCPManager.ts
  ├─ MCPServersInitializer.initialize()      registry/MCPServersInitializer.ts
  ├─ MCPServersRegistry.getInstance()        registry/MCPServersRegistry.ts
  │    ├─ getServerConfig(name, userId)      // YAML/DB/User sourced
  │    ├─ getAllServerConfigs()
  │    ├─ shouldEnableSSRFProtection()
  │    └─ getAllowedDomains() / getAllowedAddresses()
  ├─ ConnectionsRepository (app-level)      ConnectionsRepository.ts
  ├─ UserConnectionManager (user-specific)  UserConnectionManager.ts
  ├─ MCPConnectionFactory.discoverTools()    MCPConnectionFactory.ts
  │    └─ MCPConnection (per-server)         connection.ts
  │         ├─ StdioClientTransport          @modelcontextprotocol/sdk
  │         ├─ SSEClientTransport
  │         ├─ WebSocketClientTransport
  │         └─ StreamableHTTPClientTransport
  ├─ MCPServerInspector.getToolFunctions()   registry/MCPServerInspector.ts
  └─ formatToolContent()                     parsers.ts
```

### 3.3 MCP Tool 执行流程

**文件**: `packages/api/src/mcp/MCPManager.ts:262-379`

```typescript
async callTool({
  user, serverName, toolName, provider, toolArguments,
  options, flowManager, graphTokenResolver, customUserVars,
  tokenMethods, oauthStart, oauthEnd, requestBody,
  serverConfig      // 预解析的 config，避免 readThrough TTL 和跨租户问题
}): Promise<FormattedToolResponse> {
  // 1. 获取连接 (app-level 或 user-specific)
  connection = await this.getConnection({ serverName, user, ... });

  // 2. 获取 server config (重新解析 env placeholders)
  rawConfig = await MCPServersRegistry.getServerConfig(serverName, userId);

  // 3. Pre-process Graph API tokens (OBO flow) - async
  graphProcessedConfig = await preProcessGraphTokens(rawConfig, { graphTokenResolver });

  // 4. 同步 env 变量注入
  currentOptions = processMCPEnv({ user, body, options: graphProcessedConfig, customUserVars });

  // 5. 更新 request headers (处理 cookie/session 等)
  if ('headers' in currentOptions) connection.setRequestHeaders(currentOptions.headers);

  // 6. 发起 tools/call 请求
  result = await connection.client.request(
    { method: 'tools/call', params: { name: toolName, arguments: toolArguments } },
    CallToolResultSchema,
    { timeout: connection.timeout, resetTimeoutOnProgress: true, ...options },
  );

  // 7. 格式化输出
  return formatToolContent(result, provider);
}
```

### 3.4 MCP Tool 缓存

**文件**: `packages/api/src/mcp/tools.ts`

`createMCPToolCacheService(deps)`:
- `updateMCPServerTools()`: 将 MCP server tools 前缀化为 `{toolName}___{serverName}` 格式，存入缓存
- `mergeAppTools()`: 合并 app-level tools 到共享缓存
- `cacheMCPServerTools()`: 按 userId + serverName 维度缓存

**Tool 命名约定**: 使用 `Constants.mcp_delimiter` (即 `___`) 分隔 tool name 和 server name

### 3.5 MCP Connection 传输层

**文件**: `packages/api/src/mcp/connection.ts:29-68`

**传输类型检测**:
| 方法 | 条件 | Transport |
|------|------|-----------|
| `isStdioOptions` | 有 `command` 字段 | `StdioClientTransport` |
| `isWebSocketOptions` | URL protocol 为 `ws:`/`wss:` | `WebSocketClientTransport` |
| `isStreamableHTTPOptions` | `type` 为 `streamable-http`/`http` | `StreamableHTTPClientTransport` |
| `isSSEOptions` | 其余 URL-based | `SSEClientTransport` |

**SSRF 防护** (`createSSRFSafeUndiciConnect`): 对非 stdio transport 应用 SSRF 安全代理，限制请求域。

### 3.6 MCP OAuth 流程

**目录**: `packages/api/src/mcp/oauth/`

- `detectOAuth.ts`: 检测 MCP server 是否需要 OAuth
- `handler.ts`: OAuth callback 处理（含 CSRF 回退）
- `tokens.ts`: Token 管理与过期处理
- `OAuthReconnectionManager.ts`: OAuth 重连管理
- `FlowStateManager` (`packages/api/src/flow/manager.ts`): 基于 Keyv 的异步 Flow 状态机（PENDING -> COMPLETED/FAILED），用于 OAuth 回调等待

### 3.7 客户端 MCP UI

**组件目录**: `client/src/components/MCP/`
- `MCPConfigDialog.tsx`: MCP 服务器配置对话框
- `MCPServerMenuItem.tsx`: 侧栏服务器菜单项
- `MCPServerStatusIcon.tsx`: 连接状态指示器
- `StackedMCPIcons.tsx`: 堆叠图标显示多个 MCP 服务器

**MCP UI 资源渲染**: `client/src/components/MCPUIResource/`
- 支持 MCP server 返回 UI 资源 (通过 SSE 事件流)
- 轮播视图 (`MCPUIResourceCarousel.tsx`)

---

## 4. Session 管理 (fork/compact/checkpoint)

### 4.1 会话 Fork

**四种 Fork 选项** (见第 1.2 节)，后端通过 `useForkConvoMutation` 触发，创建新的 conversationId 并复制对应的消息子树。

### 4.2 上下文 Summarization (摘要 = Compact)

**配置源头**: `agent.summarization ?? summarizationConfig`

**`shapeSummarizationConfig()`** (`run.ts:315-530`):
- 解析 `summarization.provider` (可能是 custom endpoint 名称如 `"Ollama"`)
- 通过 `getOpenAIConfig` 获得 LLM client options
- 支持户提供覆盖参数 `summarization.parameters`
- 返回 `{ enabled, config, reserveRatio, contextPruning }`

**在 `buildAgentInput` 中的应用** (`run.ts:905-931`):
```typescript
effectiveMaxContextTokens = computeEffectiveMaxContextTokens(
  summarization.reserveRatio,      // 预留比例 (默认 0.05)
  agent.baseContextTokens,         // agentMaxContextNum - maxOutputTokensNum
  agent.maxContextTokens,          // user-configured max
);
// 传递给 SDK 的 RunConfig:
return {
  maxContextTokens: effectiveMaxContextTokens,
  summarizationEnabled: summarization.enabled,
  summarizationConfig: summarization.config,
  contextPruningConfig: summarization.contextPruning,
  initialSummary: isSubagent ? undefined : initialSummary,  // subagent 不继承
  calibrationRatio,  // 前次运行的 contextMeta 校准比例，seed pruner EMA
};
```

**Subagent 独立**: `isSubagent ? undefined : initialSummary` -- 子代理不继承父级 initialSummary，保证隔离。

### 4.3 Context Pruning (上下文剪枝)

**机制**: `summarization.contextPruning` 配置传递给 SDK 的 `RunConfig`，由 `@librechat/agents` SDK 在运行时执行：
- `calibrationRatio`: 从上一次运行的 `contextMeta` 透传，用于初始化 pruner 的 EMA
- Token counter 持续跟踪 context 使用量
- 超出 `maxContextTokens` 时触发 automaticsummarization/pruning

### 4.4 Session 级代码文件管理

**文件**: `packages/api/src/agents/codeFilesSession.ts`

**`seedCodeFilesIntoSessions()`** (`codeFilesSession.ts:44-80`):
- 构建 `ToolSessionMap` 供 Graph 的 `ToolNode` 读取
- 在首次 `execute_code` 调用前注入 `_injected_files`
- 文件去重: 以 `storage_session_id + id` 为复合 key
- 跨 agent 合并: 多个 agent 的 `primedCodeFiles` 合并为一个 session
- `session_id` 由首次 `/exec` 调用返回填充

**`buildInitialToolSessions()`**: 递归遍历 agent 树 (包括 subagents)，收集所有 `primedCodeFiles`。

### 4.5 运行间状态传递

**`initialSummary`**: `createRun` 接收上次运行总结 `{ text: string, tokenCount: number }`，注入到 `AgentContext` 供 agent 读取
**`initialSessions`**: 跨运行传递 `ToolSessionMap`，维护代码执行 session 连续性
**`indexTokenCountMap`**: 在 `RunConfig` 中传递 token 计数索引

---

## 5. 对 AgentHub 的具体建议

### 5.1 消息树与分支 (借鉴 LibreChat)

AgentHub 的 Conversation Authority 模型 (`docs/authority.md`) 已经定义了消息序列所有权，但**尚未处理 branching/scenario 探索场景**。

建议:
1. **消息树数据模型**: 类似 LibreChat 的 `buildTree()`，将消息组织为 `{message, children[]}` 树结构。AgentHub 在 Hub 端自然支持 branching（用户从历史消息重试不同 prompt），在 Edge 端通过 Event 同步复制分支。
2. **Fork 机制**: 借鉴 LibreChat 的四种 Fork 选项，AgentHub 应支持 `DIRECT_PATH` (最小 fork) 和 `INCLUDE_BRANCHES` (完整树 fork) 两种模式。Authority 方面：fork 后的 conversation 默认继承原 conversation 的 authority 类型，除非用户显式迁移到不同 Edge。
3. **SiblingSwitch**: 对多分支探索天然友好的切换 UI，直接复用思路。

### 5.2 Subagent 调度 (借鉴 LibreChat)

AgentHub 的 Runner 模型已经天然支持远程执行，但**调度层尚未涉及子代理递归委托**。

建议:
1. **借鉴 `buildSubagentConfigs` 的递归+循环检测+深度限制模型**:
   - 每个 Agent 声明 `subagents: { enabled, allowSelf, children[] }`
   - 调度层递归展开子图，维护 `ancestors` Set 防循环
   - `MAX_SUBAGENT_DEPTH` + `MAX_SUBAGENT_RUN_CONFIGS` 双上限
2. **子代理 context 隔离**:
   - 借鉴 `toolRegistry` 深度克隆模式（Map clone + 每个 LCTool 浅拷贝）
   - `initialSummary` 对子代理设为 `undefined`，保证隔离
3. **执行 Authority 与 subagent**:
   - 子代理的 Execution Authority 可指向不同 Remote Edge，实现真正的分布式子任务委托
   - Hub 通过 `run.start` -> target Edge 的模式管理子代理生命周期

### 5.3 Provider Adapter (借鉴 LibreChat)

AgentHub 作为多模型 router，需要统一的 provider 适配层。

建议:
1. **Adapter Dispatch Map**: 采用 `providerConfigMap` 模式 (`{provider: initializeFn}`)，每个 provider 模块导出标准 `initialize(params) => {llmConfig, tools, provider, endpointTokenConfig}` 接口
2. **Custom Endpoint 回退**: 未识别的 provider fallback 到 `initializeCustom` (OpenAI-compatible 模式)，通过 `getCustomEndpointConfig` 查找 YAML/DB 配置
3. **Provider Auth 分层**: 
   - `user_provided` key -> 从 DB 读取 `getUserKey()`
   - Env-based -> 环境变量
   - Service Account -> Vertex AI OAuth 模式

### 5.4 MCP 集成 (直接借鉴)

LibreChat 的 MCP 架构是目前开源项目中**最完善的 MCP client 实现之一**。

建议:
1. **MCPManager Singleton + Registry 模式**: 单例管理所有连接，通过 `MCPServersRegistry` 统一配置来源 (YAML/DB/User)
2. **多传输层支持**: Stdio + SSE + WebSocket + StreamableHTTP，自动检测
3. **MCP Tool 缓存**: 前缀化命名 (`{toolName}___{serverName}`) + per-user per-server 缓存
4. **OAuth Flow 状态机**: `FlowStateManager` 的 PENDING/COMPLETED/FAILED 三态 + Keyv 持久化 + Polling 模式，可直接借鉴到 AgentHub 的异步操作等待模型
5. **SSRF 防护**: 对 StreamableHTTP/SSE/WebSocket transport 应用 `createSSRFSafeUndiciConnect`
6. **Graph Token Resolver**: `preProcessGraphTokens` 的 OBO flow，用于 MCP server 访问 Microsoft Graph API

### 5.5 Session 与 Context 管理

1. **Summarization Engine**: 借鉴 LibreChat 的 `shapeSummarizationConfig` + `summarization.reserveRatio` 模式。AgentHub 可以在 Hub 端实现 context compaction（Hub 有完整的消息历史），Edge 端只接收 compacted context。
2. **Session 连续性**: 借鉴 `codeFilesSession.ts` 的 `ToolSessionMap` 模型，在 run 间传递代码执行上下文。
3. **Checkpoint within conversation**: 对 Hub 端的 conversation 引入可恢复 checkpoint (不是 agent-level，是模型请求级重试点)。

### 5.6 不推荐借鉴的部分

1. **Recoil 状态管理**: LibreChat 使用 Recoil (`client/src/store/`)，但 Recoil 已停维护。AgentHub 建议用 Zustand 或 Jotai。
2. **CJS/ESM 双模块历史包袱**: `packages/api/` 中部分文件保留 CommonJS 兼容逻辑 (`api/server/services/` 目录)，AgentHub 新项目可直接全 ESM。
3. **Monolithic 客户端**: `client/src/` 是单 React SPA，AgentHub 的 Web/Mobile/Desktop 三端分离架构需要更模块化的 UI 层。
