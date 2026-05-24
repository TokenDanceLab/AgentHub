# dify Source Adoption Map → AgentHub

> 从 Dify Python 源码到 AgentHub Go 实现的精确映射。
> 每项: Dify file:line → AgentHub file:line → 具体变更 → P0/P1/P2。
> 已有文档: `01-overview.md`, `02-tool-provider.md` — 本文件聚焦未被已有文档覆盖的代码级映射。

---

## 1. ToolManager match 分派 → AgentHub Tool Registry

### 1.1 Provider 类型路由

```
Dify: api/core/tools/tool_manager.py:182-390
  match provider_type:
      BUILT_IN → BuiltinToolProviderController
      API      → ApiToolProviderController
      WORKFLOW → WorkflowToolProviderController
      MCP      → MCPToolProviderController
      PLUGIN   → PluginToolProviderController
      DATASET_RETRIEVAL → raise ToolProviderNotFoundError

AgentHub: edge-server/internal/adapters/registry.go:76-91
  func (r *Registry) Resolve(agentID string) (AgentAdapter, error)
  仅按 agentID 字符串查找 adapter，无 provider type 分派。
```

**差异**: Dify 的 `match` 语句按 tool provider 类型路由到不同的 Controller。AgentHub 的 `Registry` 仅按 agent ID 字符串查找，不区分 provider 类型。

**建议 P0**: 在 hub-server 中引入 `ToolRegistry` 和 `ToolProvider` 抽象。将 6 种 Dify provider type 简化为 4 种 AgentHub 类型：`builtin | mcp | api | composite`。

```go
// hub-server/internal/tool/registry.go 新增
type ToolProviderType string
const (
    ProviderBuiltin   ToolProviderType = "builtin"
    ProviderMCP       ToolProviderType = "mcp"
    ProviderAPI       ToolProviderType = "api"
    ProviderComposite ToolProviderType = "composite" // workflow as tool
)

type ToolProvider interface {
    ListTools(ctx context.Context) ([]ToolDescriptor, error)
    GetTool(ctx context.Context, name string) (Tool, error)
    ProviderType() ToolProviderType
}
```

### 1.2 fork_tool_runtime 模式

```
Dify: api/core/tools/__base/tool.py:29-37
  def fork_tool_runtime(self, runtime: ToolRuntime) -> Tool:
      return self.__class__(
          entity=self.entity.model_copy(),  # 深拷贝 entity
          runtime=runtime,                   # 注入租户/凭据/参数上下文
      )

AgentHub: edge-server/internal/adapters/adapter.go:23-43
  AgentAdapter 接口无 runtime 注入方法。BuildCommand 直接在参数中构造 exec.Cmd。
```

**建议 P1**: 引入 `ToolRuntime` 上下文注入模式。在 Tool 实例化后注入 `tenant_id`、`credentials`、`runtime_parameters`，使同一 Tool 定义在不同上下文中安全复用。

```go
// hub-server/internal/tool/tool.go 新增
type ToolRuntime struct {
    TenantID          string
    UserID            string
    Credentials       map[string]string
    RuntimeParameters map[string]any
}

type Tool interface {
    WithRuntime(runtime ToolRuntime) Tool
    Invoke(ctx context.Context, params map[string]any) (<-chan ToolMessage, error)
}
```

---

## 2. MCP Tool 集成 → AgentHub MCP Support

### 2.1 MCPToolProviderController.from_entity()

```
Dify: api/core/tools/mcp_tool/provider.py:60-108
  from_entity():
    1. entity.tools → 反序列化为 list[RemoteMCPTool]
    2. 对每个 RemoteMCPTool → convert_mcp_schema_to_parameter(inputSchema)
    3. 构造 ToolEntity 列表 → 挂载到 ToolProviderEntityWithPlugin
    4. 返回 MCPToolProviderController 实例

AgentHub: edge-server/internal/adapters/adapter.go:58-68
  AgentCapabilities.MCPIntegration: true (Claude Code)
  Proxy 模式 — 通过 Claude Code CLI 的 --mcp-config 间接使用 MCP。
```

**差异**: Dify 直接管理 MCP 连接（sse/streamablehttp transport、OAuth 自动重试、schema 转换）。AgentHub 将 MCP 完全委托给 Claude Code CLI。

**建议 P1**: 在 hub-server 中实现独立的 MCP tool discovery。不依赖 Claude CLI 的内置 MCP 支持，直接通过 `mcp-go` SDK 连接 MCP server，获取 tool 列表并转换为 AgentHub 的 ToolDescriptor。

```go
// hub-server/internal/tool/mcp_provider.go 新增
type MCPToolProvider struct {
    connections map[string]*mcp.Client  // server name → MCP client
}

func (p *MCPToolProvider) ListTools(ctx context.Context) ([]ToolDescriptor, error) {
    // 1. 遍历所有已注册 MCP Server
    // 2. 对每个 Server 调用 tools/list
    // 3. 将 MCP Tool → AgentHub ToolDescriptor (原始 JSON Schema)
}
```

### 2.2 MCPTool._invoke() 内容分发

```
Dify: api/core/tools/mcp_tool/tool.py:55-98,224-239
  for content in result.content:
      match content:
          TextContent → process_text_content (JSON 检测)
          ImageContent/AudioContent → create_blob_message(base64 decode)
          EmbeddedResource → TextResourceContents / BlobResourceContents
  structuredContent → create_variable_message

AgentHub: edge-server/internal/adapters/codex.go → Codex Event Parser
  mapToolItem() 将 4 种 Codex item type 归一化，但无 MCP content 类型处理。
```

**建议 P2**: 当实现独立 MCP tool provider 后，参考 Dify 的 `match content` 分派模式处理 MCP 返回的多种 content 类型。

---

## 3. ToolInvokeMessage 多态消息模型

### 3.1 12 种消息类型

```
Dify: api/core/tools/entities/tool_entities.py:230-242
  MessageType: TEXT, JSON, IMAGE, IMAGE_LINK, LINK, BLOB, BLOB_CHUNK,
               FILE, VARIABLE, LOG, RETRIEVER_RESOURCES

AgentHub: edge-server/internal/adapters/adapter.go:73-102
  BusEventTextDelta, BusEventTextBlock, BusEventThinking, BusEventToolCall,
  BusEventToolResult, BusEventFileChange, BusEventSessionInit, BusEventResult,
  ... (共 20+ 事件类型)
```

**差异**: Dify 的消息类型更细粒度（区分 JSON/IMAGE/LINK/BLOB）。AgentHub 的事件类型更偏向 agent 生命周期（session/compact/retry/auth/hook）。

**建议 P2**: 在 AgentHub 的事件类型中补充 `JSON`、`BLOB`、`FILE` 三个消息类型。当前 AgentHub 将 tool 输出全部封装为 `tool_result` events，不区分结构化内容类型。

---

## 4. ToolEngine 双模式执行

### 4.1 agent_invoke vs generic_invoke

```
Dify: api/core/tools/tool_engine.py:42-377
  agent_invoke():
    → tool.invoke() → Generator[ToolInvokeMessage]
    → ToolFileMessageTransformer 处理文件/图片
    → _convert_tool_response_to_str() → LLM 可读纯文本
    → 返回 (plain_text, file_ids, meta)

  generic_invoke():
    → tool.invoke() → Generator[ToolInvokeMessage]
    → 不截断流式输出 (保留完整结构化消息用于 workflow variable 传递)

AgentHub: edge-server/internal/adapters/parser_ndjson.go
  ParseStream 单一模式 — 解析 NDJSON → 发射事件。不区分 agent/workflow 场景。
```

**建议 P2**: 当 AgentHub 引入 workflow 能力后，为 tool 执行提供两种模式：agent 模式（结果序列化为 LLM 可读文本）和 workflow 模式（保留结构化消息流）。

---

## 5. SecurityHook → Dify Moderation 对比

### 5.1 代码结构对比

```
Dify: api/core/moderation/ (OpenAI moderation API + keyword filter)
  input_moderation() → 调用 OpenAI moderation endpoint
  output_moderation() → 同上

AgentHub: edge-server/internal/adapters/security_hooks.go:1-228
  SecurityHook.PreToolUse() → 正则匹配 7 类危险 pattern → block
  SecurityHook.PermissionRequest() → RiskBlocked → deny; RiskHigh → allow_once
```

**差异**: Dify 使用 OpenAI moderation API（第三方服务，网络依赖）。AgentHub 使用本地正则匹配（离线，零延迟，但模式覆盖有限）。

**建议 P2**: 保持 AgentHub 的本地正则方案作为 P0 安全层，补充可选的 OpenAI moderation API 集成作为 P3 语义安全层。Dify 的双层策略（input + output moderation）值得参考——在 agent 模式下输出 moderation 尤为重要。

---

## 6. RAG Pipeline → AgentHub RAG 策略

```
Dify: api/core/rag/
  doc → Extractor → Cleaner → Splitter → IndexProcessor → VectorStore → Embedding
  query → Embedding → RetrievalService → Rerank → DataPostProcessor → result

AgentHub: 无独立 RAG 模块。RAG 通过 agent CLI 的 tool 能力间接实现。
```

**建议 P2**: P0 阶段不需要完整的 RAG pipeline。但当 AgentHub 需要独立的知识库能力时，应优先参考 Dify 的 Tenant-Isolated Queue（`api/core/rag/pipeline/queue.py`）——基于 Redis List 的轻量设计，适合多租户场景。

---

## 7. 许可证约束下的合理借鉴边界

```
Dify: LICENSE (Dify Open Source License)
  限制: 多租户 SaaS 需商业许可; LOGO/版权不可移除; Producer 可变更协议

AgentHub: LICENSE (Apache-2.0)
```

**建议**: AgentHub 可借鉴 Dify 的架构模式（Provider 抽象、MCP 集成路径、RAG 管道设计），但不可直接复制代码。优先参考设计范式而非代码实现。

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | ToolManager match 分派 → ToolRegistry | **P0** | 新增 `hub-server/tool/registry.go` |
| 2 | fork_tool_runtime 注入模式 | **P1** | 新增 `hub-server/tool/tool.go` |
| 3 | 独立 MCP tool discovery | **P1** | 新增 `hub-server/tool/mcp_provider.go` |
| 4 | MCP content 类型分派 | **P2** | `hub-server/tool/mcp_provider.go` |
| 5 | ToolInvokeMessage 多态消息 | **P2** | `adapters/adapter.go` 事件类型扩展 |
| 6 | agent/workflow 双模式执行 | **P2** | `adapters/parser_ndjson.go` |
| 7 | 双层 moderation 策略 | **P2** | `adapters/security_hooks.go` |
| 8 | RAG pipeline 架构参考 | **P2** | 新增 `hub-server/rag/` |
