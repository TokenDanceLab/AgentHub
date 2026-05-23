# Dify Tool Provider 与 MCP 集成深度剖析

> 源码路径：`D:\Code\AgentHub\reference\dify\api\core\tools\`
> 调研日期：2026-05-21

## 1. 总体架构：三层模型

Dify 的 Tool 系统由三个紧密协作的层次构成，各层职责分明：

```
ToolManager（注册 + 路由）
  └─ ToolProviderController（Provider 生命周期 + 凭据）
       └─ Tool（执行单元 + Runtime 上下文）
```

三个类分别定义在：
- `Tool` ABC：`api/core/tools/__base/tool.py:20`
- `ToolProviderController` ABC：`api/core/tools/__base/tool_provider.py:14`
- `ToolManager`（静态路由中心）：`api/core/tools/tool_manager.py:98`

## 2. ToolManager：match 分派模式

### 2.1 核心入口 `get_tool_runtime()`

`ToolManager.get_tool_runtime()`（`tool_manager.py:182-390`）是整个系统的路由总闸。它接收 `provider_type` + `provider_id` + `tool_name` + `tenant_id`，用 Python 3.10+ 的 `match` 语句分派到 6 种不同的 Provider 初始化路径：

```python
match provider_type:
    case ToolProviderType.BUILT_IN:
        # 1. 从缓存或磁盘加载硬编码 Provider
        # 2. 识别 PluginToolProviderController vs BuiltinToolProviderController
        # 3. 查询 DB → 解密凭据 → OAuth 刷新（如到期）→ fork_tool_runtime
    case ToolProviderType.API:
        # 查询 ApiToolProvider → 解密 credentials → fork
    case ToolProviderType.WORKFLOW:
        # 查询 WorkflowToolProvider → ToolTransformService 转换 → fork
    case ToolProviderType.APP:
        raise NotImplementedError  # 预留
    case ToolProviderType.PLUGIN:
        # PluginToolManager 懒加载 → get_tool()
    case ToolProviderType.MCP:
        # MCPToolManageService 查询 → MCPToolProviderController → get_tool()
    case ToolProviderType.DATASET_RETRIEVAL:
        raise ToolProviderNotFoundError  # 走独立路径
```

每种 case 都返回一个具体 Tool 子类实例，**并调用 `fork_tool_runtime(runtime=ToolRuntime(...))` 注入租户、用户、凭据等运行时上下文**。

### 2.2 `fork_tool_runtime` 模式

这是 Dify Tool 系统最核心的运行时注入机制。定义在 `Tool.fork_tool_runtime()`（`__base/tool.py:29-37`）：

```python
def fork_tool_runtime(self, runtime: ToolRuntime) -> Tool:
    return self.__class__(
        entity=self.entity.model_copy(),  # 深拷贝 entity
        runtime=runtime,                   # 新 runtime 上下文
    )
```

每个 Tool 子类（BuiltinTool、ApiTool、MCPTool 等）都 override 此方法以确保返回正确的子类实例。调用路径：

```
AgentRunner / WorkflowNode
  → ToolManager.get_agent_tool_runtime() / get_workflow_tool_runtime()
    → get_tool_runtime() → fork_tool_runtime(ToolRuntime)
      → runtime_parameters 解密 + variable pool 注入
        → ToolEngine.agent_invoke(tool, params)
```

### 2.3 ToolRuntime 上下文

`ToolRuntime`（`__base/tool_runtime.py:10-25`）是 Pydantic BaseModel：

| 字段 | 用途 |
|------|------|
| `tenant_id` | 租户隔离 |
| `user_id` | 调用者身份（可选） |
| `invoke_from` | InvokeFrom.DEBUGGER / SERVICE_API |
| `tool_invoke_from` | AGENT / WORKFLOW / PLUGIN |
| `credentials` | 解密后的凭据 dict |
| `runtime_parameters` | Agent 配置参数（如覆盖 tool 默认值） |

被调方 `Tool._invoke()` 使用 `runtime.runtime_parameters` 合并参数后执行。

### 2.4 两个上层适配器

`ToolManager` 还提供两个上层入口，在 `get_tool_runtime()` 基础上增加参数处理：

- `get_agent_tool_runtime()`（`tool_manager.py:393-433`）：处理 Agent 的 tool_parameters → 解密 → 写入 `runtime.runtime_parameters`
- `get_workflow_tool_runtime()`（`tool_manager.py:436-478`）：处理 Workflow 节点的 tool_configurations → variable pool 注入

二者都依赖同一个 `_convert_tool_parameters_type()` 方法将配置值按 parameter type 做类型转换。

## 3. Provider 层级：6 种 ProviderController

### 3.1 抽象基类

`ToolProviderController`（`__base/tool_provider.py:14-108`）定义：

```python
class ToolProviderController(ABC):
    entity: ToolProviderEntity           # 元数据（identity、credentials_schema、tools）

    def get_credentials_schema() -> list[ProviderConfig]
    @abstractmethod def get_tool(tool_name: str) -> Tool  # 核心方法
    @property def provider_type -> ToolProviderType        # 子类返回具体类型
    def validate_credentials_format(credentials)           # 格式校验 + 默认值
```

### 3.2 6 种 ProviderType 枚举

`ToolProviderType`（`entities/tool_entities.py:65-89`）：

```python
class ToolProviderType(StrEnum):
    PLUGIN           = auto()   # → "plugin"
    BUILT_IN         = "builtin"
    WORKFLOW         = auto()
    API              = auto()
    APP              = auto()   # 未实现
    DATASET_RETRIEVAL= "dataset-retrieval"
    MCP              = auto()
```

### 3.3 Provider 发现与提供者列表

`ToolManager.list_providers_from_api()`（`tool_manager.py:687-803`）在单个 DB session 中批量查询四类 Provider（builtin、api、workflow、mcp）并合并为统一列表。MCP 类通过 `MCPToolManageService` 查询。

## 4. ToolEngine：统一执行引擎

`ToolEngine`（`tool_engine.py:42-377`）是 Tool 执行的统一门面，提供两种调用模式：

### 4.1 Agent 调用路径

```python
ToolEngine.agent_invoke(tool, tool_parameters, user_id, tenant_id, message, ...)
  → 参数标准化（单参数工具支持 string 简写）
  → on_tool_start callback
  → _invoke() → tool.invoke() → Generator[ToolInvokeMessage]
  → ToolFileMessageTransformer 处理文件/图片/JSON
  → _extract_tool_response_binary_and_text() 提取二进制
  → _create_message_files() 存 MessageFile
  → _convert_tool_response_to_str() 转 LLM 友好字符串
  → on_tool_end callback
  → 返回 (plain_text, file_ids, meta)
```

### 4.2 Workflow 调用路径

```python
ToolEngine.generic_invoke(tool, tool_parameters, user_id, workflow_tool_callback, ...)
  → 合并 runtime_parameters
  → tool.invoke() 直接返回 Generator[ToolInvokeMessage]
  → 不截断流式输出（workflow 场景需要保留变量消息）
```

两层差异：Agent 调用需要将结果序列化为 LLM 可读的文本 + 附件 ID；Workflow 调用保留完整的结构化消息流用于变量传递。

## 5. MCP 集成详解

MCP 集成由三个文件完成：
- `mcp_tool/provider.py`：Provider 控制器，管理 MCP Server 连接
- `mcp_tool/tool.py`：将 MCP RemoteTool 转为 Dify Tool
- `mcp/auth_client.py`：带 OAuth 自动重试的 MCP 客户端
- `mcp/mcp_client.py`：底层 MCP 协议客户端（stdio/sse transport）
- `mcp/types.py`：MCP 协议 Pydantic 类型定义

### 5.1 MCPToolProviderController

`MCPToolProviderController`（`mcp_tool/provider.py:21-157`）关键职责：

**构造参数**：
```
entity: ToolProviderEntityWithPlugin
provider_id, tenant_id
server_url, headers, timeout, sse_read_timeout
```

**from_entity() 工厂方法**（`provider.py:60-108`）：
1. 将 `entity.tools`（`list[dict]`）反序列化为 `list[RemoteMCPTool]`（MCP 协议 Pydantic 模型）
2. 对每个 RemoteMCPTool 调用 `ToolTransformService.convert_mcp_schema_to_parameter(tool.inputSchema)` 转换参数
3. 构造 `ToolEntity` 列表挂载到 `ToolProviderEntityWithPlugin.tools`

```python
tools = [
    ToolEntity(
        identity=ToolIdentity(
            author="Anonymous",
            name=remote_mcp_tool.name,
            label=I18nObject(en_US=remote_mcp_tool.name, zh_Hans=remote_mcp_tool.name),
            provider=entity.provider_id,
        ),
        parameters=ToolTransformService.convert_mcp_schema_to_parameter(
            remote_mcp_tool.inputSchema
        ),
        description=ToolDescription(
            human=I18nObject(en_US=remote_mcp_tool.description or "", ...),
            llm=remote_mcp_tool.description or "",
        ),
        output_schema=remote_mcp_tool.outputSchema or {},
        has_runtime_parameters=len(remote_mcp_tool.inputSchema) > 0,
    )
    for remote_mcp_tool in remote_mcp_tools
]
```

**get_tool()**：从 `self.entity.tools` 列表中按 `tool_name` 匹配，返回带 `ToolRuntime(tenant_id=...)` 的 `MCPTool` 实例。

### 5.2 MCPTool：运行时执行

`MCPTool`（`mcp_tool/tool.py:29-289`）继承自 `Tool`，关键方法：

**`_invoke()` 主流程**（`tool.py:55-98`）：
```python
def _invoke(self, user_id, tool_parameters, ...):
    # 1. 调用远程 MCP 工具
    result = self.invoke_remote_mcp_tool(tool_parameters)

    # 2. 提取 usage metadata
    self._latest_usage = self._derive_usage_from_result(result)

    # 3. 处理 MCP content（match 语句分派）
    for content in result.content:
        match content:
            case TextContent():
                yield from self._process_text_content(content)  # JSON 检测
            case ImageContent() | AudioContent():
                yield self.create_blob_message(blob=base64.b64decode(...), meta={...})
            case EmbeddedResource():
                match resource:
                    case TextResourceContents(): yield self.create_text_message(resource.text)
                    case BlobResourceContents(): yield self.create_blob_message(...)

    # 4. 处理 MCP structuredContent（映射到 variable message）
    if self.entity.output_schema and result.structuredContent:
        for k, v in result.structuredContent.items():
            yield self.create_variable_message(k, v)
```

**`invoke_remote_mcp_tool()` 连接管理**（`tool.py:249-288`）：
1. 短生命周期 DB session 加载 `MCPProviderEntity`（解密 headers/URL）
2. 构建 `MCPClientWithAuthRetry`（带 OAuth 自动重试）
3. `mcp_client.invoke_tool(tool_name, tool_args)` → `CallToolResult`

### 5.3 MCP 客户端的双 transport 支持

`MCPClient`（`mcp/mcp_client.py:17-116`）：

- 解析 server URL path 判断 transport：
  - path 以 `mcp` 结尾 → `streamablehttp_client`
  - path 以 `sse` 结尾 → `sse_client`
  - 否则 → 先试 sse，失败后 fallback 到 streamablehttp
- 使用 Python `ExitStack` 管理 context manager 生命周期
- 连接成功后调用 `ClientSession.initialize()` 完成 MCP 握手

`MCPClientWithAuthRetry`（`mcp/auth_client.py:23-198`）：
- 包装所有 MCP 操作（`list_tools`、`invoke_tool`）的 auth 重试
- 遇到 `MCPAuthError` → 创建短生命周期 DB session → 刷新 OAuth token → 重新初始化连接 → 重试
- 最多重试 1 次（`_has_retried` 标志）

### 5.4 MCP Schema → ToolParameter 转换

`ToolTransformService.convert_mcp_schema_to_parameter()`（`tools_transform_service.py:444-524`）：

核心算法：
```
输入：{"type": "object", "properties": {...}, "required": [...]}

1. resolve_property_type(prop, depth=0):
   - prop["type"] 是 str → 直接返回
   - prop["type"] 是 list → 取第一个非 "null" 类型
   - 处理 anyOf/oneOf → 递归找第一个非 null 类型
   - 处理 allOf → 递归合并
   - 深度 > _MCP_SCHEMA_TYPE_RESOLUTION_MAX_DEPTH (10) → fallback "string"

2. TYPE_MAPPING = {"integer": "number", "float": "number"}
   - 将 JSON Schema integer/float 统一为 Dify 的 number 类型

3. COMPLEX_TYPES = ["array", "object"]
   - 复杂类型保留 input_schema 字段（用于嵌套参数 UI）

4. process_properties(props, required):
   - 逐 property 生成 ToolParameter(
       name, llm_description, label,
       form=ToolParameterForm.LLM,  # 由 LLM 填充
       required=(name in required),
       type=ToolParameterType(prop_type),
       input_schema=prop if complex else None
     )
```

参数类型映射：
| MCP JSON Schema | Dify ToolParameterType |
|-----------------|----------------------|
| string | STRING |
| integer | NUMBER |
| float | NUMBER |
| number | NUMBER |
| boolean | BOOLEAN |
| array | ARRAY (带 input_schema) |
| object | OBJECT (带 input_schema) |
| null | fallback to STRING |

### 5.5 MCP 鉴权体系

`MCPProviderEntity`（`entities/mcp_provider.py:50-341`）封装了完整的 MCP OAuth 流程：

- OAuth 2.0 Authorization Code + Client Credentials 双 grant type
- 动态客户端注册（Dynamic Client Registration）
- Token 刷新 / 加密存储 / 解密读取
- `retrieve_tokens()` → `OAuthTokens`
- Header 注入：`Authorization: Bearer <access_token>`

## 6. Tool 基类与消息模型

### 6.1 Tool ABC

`Tool`（`__base/tool.py:20-236`）：
- `entity: ToolEntity` — 元数据（identity、parameters、description）
- `runtime: ToolRuntime` — 运行时上下文
- `fork_tool_runtime(runtime) -> Tool` — 深拷贝 entity + 新 runtime
- `invoke(user_id, tool_parameters, ...) -> Generator[ToolInvokeMessage]` — 公共入口
- `_transform_tool_parameters_type()` — 按参数类型 cast 值（如 string → int）
- `_invoke()` — 抽象方法，子类实现具体执行逻辑

### 6.2 ToolInvokeMessage 多态消息

Tool 输出通过 Generator 流式返回 `ToolInvokeMessage`，支持 12 种消息类型（`entities/tool_entities.py:230-242`）：

| MessageType | message 载体 | 用途 |
|-------------|-------------|------|
| TEXT | TextMessage(text) | 纯文本 |
| JSON | JsonMessage(json_object, suppress_output) | 结构化 JSON |
| IMAGE | TextMessage(url) | 图片 URL |
| IMAGE_LINK | TextMessage(url) | 图片链接 |
| LINK | TextMessage(url) | 超链接 |
| BLOB | BlobMessage(blob) | 二进制数据 |
| BLOB_CHUNK | BlobChunkMessage(id, seq, blob, end) | 流式二进制分片 |
| FILE | FileMessage(file_marker) | 文件引用 |
| VARIABLE | VariableMessage(name, value, stream) | 变量（workflow 用） |
| LOG | LogMessage(id, label, status, data) | 执行日志 |
| RETRIEVER_RESOURCES | RetrieverResourceMessage(...) | 检索结果 |

### 6.3 消息处理器链

`ToolEngine` 内部的消息处理流程：
1. `ToolFileMessageTransformer` — 将 URL 图片/文件转为 `MessageFile` 记录
2. `_convert_tool_response_to_str()` — 将消息列表转为 LLM 可读的纯文本（Agent 专用）
3. `_extract_tool_response_binary_and_text()` — 提取二进制附件

## 7. 对 AgentHub Go 实现的设计建议

### 7.1 match 分派 → Go type switch

Python 的 `match provider_type` 在 Go 中等价于 `switch` 语句 + 接口：

```go
// packages/tool-core/registry.go

type ToolRegistry struct {
    builtinProvider  BuiltinToolProvider
    mcpProvider      MCPToolProvider
    apiProvider      APIToolProvider
    workflowProvider WorkflowToolProvider
    pluginProvider   PluginToolProvider
}

func (r *ToolRegistry) GetToolRuntime(ctx context.Context, spec ToolRuntimeSpec) (Tool, error) {
    switch spec.ProviderType {
    case ProviderBuiltin:
        return r.resolveBuiltinTool(ctx, spec)
    case ProviderMCP:
        return r.resolveMCPTool(ctx, spec)
    case ProviderAPI:
        return r.resolveAPITool(ctx, spec)
    // ...
    }
}
```

不需要对应 Dify 全部的 6 种类型；AgentHub 的 P0 场景可简化为 `builtin | mcp | api | composite` 四类（见 `cross-analysis-sandbox-tools.md` 第 2.3 节）。

### 7.2 Runtime 上下文注入

Dify 的 `fork_tool_runtime` 模式可以直接翻译为 Go 的不可变风格：

```go
// packages/tool-core/tool.go

type ToolRuntime struct {
    TenantID          string
    UserID            string
    Credentials       map[string]string
    RuntimeParameters map[string]interface{}
    WorkspaceID       string
}

// Tool 接口：每个 Tool 实现各自创建 runtime 副本
type Tool interface {
    WithRuntime(runtime ToolRuntime) Tool
    Invoke(ctx context.Context, params map[string]interface{}) (<-chan ToolMessage, error)
    Descriptor() ToolDescriptor
}
```

### 7.3 MCP 集成 Go 实现建议

与 Dify 相比，AgentHub 的 MCP 集成可以更轻量：
- 不需要 OAuth 刷新：P0 场景用 claude code 的 `--mcp-config` 或本地 mcp-go SDK
- 不需要 `inputSchema → ToolParameter` 转换：AgentHub 直接使用 MCP Tool 的原始 JSON Schema 作为 ToolDescriptor.Schema
- Transport 只需 stdio + SSE（不需 streamablehttp 的全面支持）

```go
// packages/tool-core/mcp_provider.go

type mcpToolProvider struct {
    connections map[string]*mcp.Client  // name → MCP client
}

func (p *mcpToolProvider) ListTools(ctx context.Context) ([]ToolDescriptor, error) {
    // 1. 遍历所有已注册 MCP Server
    // 2. 对每个 Server 调用 tools/list
    // 3. 将 MCP Tool → AgentHub ToolDescriptor
}

func (p *mcpToolProvider) Invoke(ctx context.Context, name string, params map[string]interface{}, runtime ToolRuntime) (<-chan ToolMessage, error) {
    // 1. 解析 tool name: "mcp/<server_name>/<tool_name>"
    // 2. 获取对应 MCP client
    // 3. tools/call
    // 4. 流式返回 ToolMessage
}
```

### 7.4 不建议照搬的部分

1. **硬编码 Provider 磁盘加载**（`_list_hardcoded_providers` 扫描 `builtin_tool/providers/` 目录）：AgentHub 只有少量内置 CLI 工具（read/write/bash/edit），不需要磁盘扫描。
2. **Plugin 系统**（PluginToolManager + PluginToolProviderController）：AgentHub P0 不需要插件机制。
3. **Workflow as Tool**（WorkflowToolProviderController）：P0 没有 Workflow Builder。
4. **ToolLabelManager**（batch label 查询）：AgentHub 的工具数量少，不需要批量标签优化。
5. **OAuth credential refresh**：MCP 客户端的 OAuth 重试在 AgentHub 本地场景不需要。

## 8. 关键源码速查

| 文件 | 关键内容 | 对 AgentHub 价值 |
|------|---------|-----------------|
| `tool_manager.py:98-391` | `ToolManager` class + `get_tool_runtime()` match 分派 | Provider 路由模式参考 |
| `tool_engine.py:42-377` | `ToolEngine` 统一执行 + agent_invoke/generic_invoke 双模式 | Tool 执行门面模式 |
| `__base/tool.py:20-236` | `Tool` ABC + `fork_tool_runtime()` + `ToolInvokeMessage` builder | 工具接口定义参考 |
| `__base/tool_provider.py:14-108` | `ToolProviderController` ABC | Provider 接口定义 |
| `__base/tool_runtime.py:10-25` | `ToolRuntime` Pydantic model | Runtime 上下文注入 |
| `mcp_tool/provider.py:21-157` | `MCPToolProviderController.from_entity()` | MCP 工具注册 |
| `mcp_tool/tool.py:55-288` | `MCPTool._invoke()` + `invoke_remote_mcp_tool()` | MCP 运行时调用 |
| `tools_transform_service.py:444-524` | `convert_mcp_schema_to_parameter()` | MCP schema 转换 |
| `mcp/types.py:833-883` | `Tool` MCP model (`inputSchema`/`outputSchema`/`ToolAnnotations`) | MCP Tool 协议定义 |
| `mcp/types.py:876-883` | `CallToolResult` (`content`/`structuredContent`/`isError`) | MCP 调用结果模型 |
| `mcp/mcp_client.py:17-116` | `MCPClient` + dual transport (sse/streamablehttp) | MCP 客户端实现 |
| `mcp/auth_client.py:23-198` | `MCPClientWithAuthRetry` | MCP OAuth 自动重试 |
| `entities/tool_entities.py:65-89` | `ToolProviderType` enum (6 types) | Provider 类型枚举 |
| `entities/tool_entities.py:294-383` | `ToolParameter` + `ToolParameterType` | 参数模型定义 |
| `entities/tool_entities.py:147-286` | `ToolInvokeMessage` + 12 MessageTypes | 输出消息多态模型 |
| `entities/tool_entities.py:411-420` | `ToolEntity` (identity + parameters + description) | 工具实体定义 |
| `entities/mcp_provider.py:50-341` | `MCPProviderEntity` + OAuth 流程 | MCP 鉴权参考 |
