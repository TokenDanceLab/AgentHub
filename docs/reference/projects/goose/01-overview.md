# Goose 架构深度调研报告

> 调研日期：2026-05-23
> 源码仓库：`D:\Code\AgentHub\reference\goose`（Block 开发的 Goose AI Agent 框架）
> 语言：Rust（`crates/goose/` 为核心 monorepo，含 8 个 crate）
> 版本：基于 `goose` crate 源码分析

---

## 1. Provider 特征模式：ProviderDef 与 Provider 双层抽象

### 1.1 设计动机

Goose 的 provider 系统采用了**工厂特征（ProviderDef）与实例特征（Provider）分离**的设计，这是整个框架最核心的架构决策。

**文件**：`crates/goose/src/providers/base.rs:802-866`（ProviderDef），`:866-1208`（Provider）

```rust
// ProviderDef — 编译期已知的工厂 trait，用于注册、元数据查询、构造实例
pub trait ProviderDef: Send + Sync {
    type Provider: Provider + 'static;  // 关联类型：具体 Provider 实现

    fn metadata() -> ProviderMetadata where Self: Sized;   // 静态方法：元数据
    fn from_env(model: ModelConfig, extensions: Vec<ExtensionConfig>)
        -> BoxFuture<'static, Result<Self::Provider>>;      // 工厂：从环境配置创建

    fn supports_inventory_refresh() -> bool { false }       // 可选能力声明
    fn inventory_identity() -> Result<InventoryIdentityInput> { .. }
    fn inventory_configured() -> bool { .. }
}

// Provider — 运行时实例 trait，处理实际的 AI 推理
#[async_trait]
pub trait Provider: Send + Sync {
    fn get_name(&self) -> &str;                             // 实例名称
    async fn stream(..) -> Result<MessageStream, ProviderError>;  // 核心流式方法
    async fn complete(..) -> Result<(Message, ProviderUsage), ProviderError>;  // 合并版
    async fn complete_fast(..) -> Result<(Message, ProviderUsage), ProviderError>;  // fast-model fallback
    fn get_model_config(&self) -> ModelConfig;
    fn retry_config(&self) -> RetryConfig { .. }
    // 模型管理、OAuth、权限路由等 15+ 方法，均有默认实现
}
```

### 1.2 ProviderRegistry 注册机制

**文件**：`crates/goose/src/providers/provider_registry.rs:106-310`

```rust
pub struct ProviderRegistry {
    entries: HashMap<String, ProviderEntry>,
}

impl ProviderRegistry {
    // 注册泛型 ProviderDef 实现
    pub fn register<F>(&mut self, preferred: bool)
    where F: ProviderDef + 'static,
    {
        let metadata = F::metadata();
        self.entries.insert(name, ProviderEntry {
            metadata,
            // constructor 将 ModelConfig → Arc<dyn Provider>
            constructor: Arc::new(|model, extensions, working_dir| {
                Box::pin(async move {
                    let provider = F::from_env(model, extensions).await?;
                    Ok(Arc::new(provider) as Arc<dyn Provider>)
                })
            }),
            provider_type: if preferred { ProviderType::Preferred }
                           else { ProviderType::Builtin },
            // ...
        });
    }
}
```

**ProviderType 分类**（`base.rs:468-475`）：
- `Preferred` — 首选的官方 provider（如 Anthropic、OpenAI）
- `Builtin` — 内置支持的 provider（如 Ollama、OpenRouter）
- `Declarative` — JSON 声明式 provider（通过 `providers/declarative/*.json` 注册）
- `Custom` — 用户自定义 provider（`custom_` 前缀命名）

### 1.3 对 AgentHub 的验证价值

这个设计与 AgentHub 的 `AgentAdapter` 设计**完全同构**：

| Goose | AgentHub | 说明 |
|-------|----------|------|
| `ProviderDef` (trait) | `AgentAdapter` (interface) | 编译/构建期工厂：元数据 + 创建实例 |
| `Provider` (trait) | `AgentInstance` (interface) | 运行期实例：stream/complete/model 管理 |
| `ProviderRegistry` | `AgentRegistry` | 注册表：按名称查找、构造、清理 |
| `ProviderConstructor` | `AgentFactory` | 闭包/工厂函数：model config → 实例 |
| `ProviderType` | `AgentSource` | 来源分类：builtin / declarative / custom |

**关键要点**：Goose 用 Rust 的关联类型（`type Provider: Provider`）在编译期绑定具体实现类型，而 AgentHub 在 Go 中可通过泛型接口或 factory 函数实现相同的编译期安全。

---

## 2. MessageStream：统一流式接口

### 2.1 类型定义

**文件**：`crates/goose/src/providers/base.rs:1213-1215`

```rust
pub type MessageStream = Pin<
    Box<dyn Stream<Item = Result<(Option<Message>, Option<ProviderUsage>), ProviderError>> + Send>,
>;
```

**设计要点**：
- **Pin + Box**：保证流在堆上分配，可安全地跨 async 边界传递
- **`Option<Message>`**：文本增量场景下 Message 只含部分文本（可能仅一个词），工具调用 Message 只在完整装配后 emit
- **`Option<ProviderUsage>`**：token 使用量信息随流式响应逐块累积，最后一块带完整 usage
- **`ProviderError`**：统一错误类型，所有 provider 实现必须将自身错误映射到此类型

### 2.2 流式收集器 collect_stream

**文件**：`crates/goose/src/providers/base.rs:1223-1272`

```rust
pub async fn collect_stream(mut stream: MessageStream)
    -> Result<(Message, ProviderUsage), ProviderError>
{
    let mut final_message: Option<Message> = None;
    let mut final_usage: Option<ProviderUsage> = None;

    while let Some(result) = stream.next().await {
        let (msg_opt, usage_opt) = result?;
        if let Some(msg) = msg_opt {
            final_message = Some(match final_message {
                Some(mut prev) => {
                    for new_content in msg.content {
                        match (&mut prev.content.last_mut(), &new_content) {
                            // 合并连续的文本块
                            (Some(MessageContent::Text(last_text)),
                             MessageContent::Text(new_text)) => {
                                last_text.text.push_str(&new_text.text);
                            }
                            _ => { prev.content.push(new_content); }
                        }
                    }
                    prev
                }
                None => msg,
            });
        }
        if let Some(usage) = usage_opt { final_usage = Some(usage); }
    }
    // ...
}
```

**文本合并策略**：只合并相邻的 `MessageContent::Text` 块，遇到 `Image`、`ToolRequest` 等非文本块时停止合并。

### 2.3 ThinkFilter：流式 thinking 分离

**文件**：`crates/goose/src/providers/base.rs:40-149`

Goose 实现了一个零拷贝的流式 `ThinkFilter`，在 streaming 过程中实时将 `＜think＞...＜/think＞` 标签内的推理内容分离到 thinking 通道。支持：
- 大小写不敏感（`<THINK>` / `<thinking>`）
- 跨 chunk 边界的标签解析（`<thi` + `nk>` 分两个 chunk 到达）
- 自关闭标签 `<think/>` 处理
- 属性容忍（`<think class="deep">`）
- 嵌套深度追踪（depth 计数）

### 2.4 对 AgentHub 的建议

AgentHub 的 AgentAdapter 应定义一个等价的 Go 接口：

```go
type MessageStream = <-chan StreamItem

type StreamItem struct {
    Message *Message
    Usage   *ProviderUsage
    Err     error
}
```

或使用 Go 1.23+ 的 `iter.Seq2` 模式：

```go
type MessageStream iter.Seq2[*Message, error]
```

---

## 3. ExtensionManager：一切皆为 MCP

### 3.1 核心设计

**文件**：`crates/goose/src/agents/extension_manager.rs:139-147`

```rust
pub struct ExtensionManager {
    extensions: Mutex<HashMap<String, Extension>>,  // 所有扩展
    context: PlatformExtensionContext,               // 平台上下文
    provider: SharedProvider,                        // 共享的 LLM provider
    tools_cache: Mutex<Option<Arc<Vec<Tool>>>>,      // 工具缓存
    tools_cache_version: AtomicU64,                   // 缓存版本号（invalidate 用）
    client_name: String,
    capabilities: ExtensionManagerCapabilities,
}
```

Goose 的核心理念：**所有工具都以 MCP server 的形式接入**。无论底层是 stdio 子进程、HTTP 服务、内联 Python 脚本还是浏览器前端，统一通过 `McpClientTrait` 接口暴露。

### 3.2 六大传输层

**文件**：`crates/goose/src/agents/extension_manager.rs:827-1032`

| 传输类型 | ExtensionConfig 变体 | 连接方式 |
|---------|---------------------|---------|
| **Stdio** | `ExtensionConfig::Stdio` | 子进程 stdin/stdout JSON-RPC |
| **Streamable HTTP** | `ExtensionConfig::StreamableHttp` | HTTP 流式传输 + OAuth 认证 |
| **Builtin** | `ExtensionConfig::Builtin` | Tokio 内存 duplex channel（零拷贝） |
| **Platform** | `ExtensionConfig::Platform` | 进程内 client factory（直接函数调用） |
| **Inline Python** | `ExtensionConfig::InlinePython` | `uvx --with mcp python <script>` |
| **Frontend** | `ExtensionConfig::Frontend` | UI 注册（仅客户端，不能用于 server） |

**统一连接流程**：
```
add_extension(config)
  -> match config {
       Stdio => child_process_client(command)
       StreamableHttp => create_streamable_http_client(uri)
       Builtin => duplex + McpClient::connect
       Platform => def.client_factory(context)
       InlinePython => tempfile + uvx + child_process_client
       Frontend => Err (not supported as server extension)
     }
  -> client.get_info()  // 获取 ServerInfo
  -> insert into extensions HashMap
  -> invalidate_tools_cache_and_bump_version()
```

### 3.3 工具前缀与可见性

**文件**：`crates/goose/src/agents/extension_manager.rs:1277-1302`

```rust
// 标准扩展：前缀命名
let public_name = format!("{}__{}", name, tool.name);  // "developer__shell"

// 一等扩展（platform extensions）：无前缀
if expose_unprefixed {
    public_name = tool.name.to_string();  // "shell"
}
```

**工具归属元数据**：每个工具的 `meta` 中注入 `goose_extension` 字段，标记所属扩展，供 UI 渲染和权限决策使用。

### 3.4 工具缓存策略

```rust
// tools_cache_version: 每次 add/remove extension 时 AtomicU64::fetch_add(1)
// tools_cache: Option<Arc<Vec<Tool>>>, 失效时设为 None
// 首次调用 get_all_tools_cached 时重建并填充缓存
async fn get_all_tools_cached(&self, session_id: &str)
    -> ExtensionResult<Arc<Vec<Tool>>>
{
    // 快路径：缓存命中
    if let Some(ref tools) = *self.tools_cache.lock().await {
        return Ok(Arc::clone(tools));
    }
    // 慢路径：重建缓存（使用 version 做乐观并发控制）
    let version_before = self.tools_cache_version.load(Ordering::SeqCst);
    let tools = Arc::new(self.fetch_all_tools(session_id).await?);
    // 如果版本未变且缓存仍为空，写入缓存
}
```

### 3.5 对 AgentHub 的建议

AgentHub 的 MCP 管理可参考此设计：
1. **统一 MCP 传输层**：无论 Source 是 stdio/HTTP/builtin，统一 `McpClient` 接口
2. **工具前缀规范**：`extension__tool` 命名约定，与 Claude Code / Codex 对齐（`mcp__server__tool`）
3. **版本化缓存**：`AtomicU64` 做 cache versioning，避免频繁锁竞争
4. **安全审查集成**：`extension_malware_check` 检查恶意命令后执行

---

## 4. 工具检查流水线（Tool Inspection Pipeline）

### 4.1 责任链架构

**文件**：`crates/goose/src/tool_inspection.rs:34-166`

```rust
#[async_trait]
pub trait ToolInspector: Send + Sync {
    fn name(&self) -> &'static str;
    async fn inspect(&self, session_id: &str, tool_requests: &[ToolRequest],
                     messages: &[Message], goose_mode: GooseMode)
        -> Result<Vec<InspectionResult>>;
    fn is_enabled(&self) -> bool { true }
}

pub struct ToolInspectionManager {
    inspectors: Vec<Box<dyn ToolInspector>>,  // 有序链
}
```

**执行顺序**（按 `add_inspector` 顺序）：

```
Security Inspector     → Prompt injection 检测 + ML 分类
Egress Inspector       → 数据外泄检查（敏感信息离开沙箱）
Adversary Inspector    → 对抗性输入检测
Permission Inspector   → 用户权限规则匹配 (allow/deny/ask)
Repetition Inspector   → 循环/重复调用检测
```

### 4.2 检查结果合并逻辑

**文件**：`crates/goose/src/tool_inspection.rs:170-250`

```rust
pub fn apply_inspection_results_to_permissions(
    mut permission_result: PermissionCheckResult,
    inspection_results: &[InspectionResult],
) -> PermissionCheckResult {
    for result in inspection_results {
        match result.action {
            InspectionAction::Deny => {
                // 从 approved/needs_approval 移除，加入 denied
                permission_result.approved.retain(|req| req.id != request_id);
                permission_result.denied.push(request.clone());
            }
            InspectionAction::RequireApproval(_) => {
                // 从 approved 移到 needs_approval
                permission_result.approved.retain(|req| req.id != request_id);
                permission_result.needs_approval.push(request.clone());
            }
            InspectionAction::Allow => {
                // 当前 inspector 允许，不覆盖其他 inspector 的决策
            }
        }
    }
    permission_result
}
```

**关键规则**：`Deny` 优先级最高（任何 inspector deny 即最终 deny），`RequireApproval` 次之，`Allow` 不改变之前 inspector 的决策。

### 4.3 Security Inspector 详细

**文件**：`crates/goose/src/security/mod.rs:53-241`

Security inspector 支持两种模式：
- **Pattern-only**：基于正则的 prompt injection 检测（默认开启）
- **ML-enhanced**：接入外部 ML 分类器（需配置 `SECURITY_PROMPT_CLASSIFIER_ENABLED`）

```rust
pub async fn analyze_tool_requests(...) -> Result<Vec<SecurityResult>> {
    for tool_request in tool_requests.iter() {
        let analysis_result = scanner
            .analyze_tool_call_with_context(tool_call, messages).await?;
        if analysis_result.is_malicious
            && analysis_result.confidence > config_threshold
        {
            results.push(SecurityResult {
                is_malicious: true,
                should_ask_user: true,   // 超过阈值：强制用户确认
                finding_id: format!("SEC-{}", Uuid::new_v4().simple()),
                // ...
            });
        }
    }
}
```

### 4.4 对 AgentHub 的建议

1. **可组合的 inspector 链**：AgentHub 的工具权限引擎可借鉴此责任链模式，每个 inspector 独立决策，最终合并
2. **Deny > RequireApproval > Allow 优先级**：此语义简单直观，适合 AgentHub 的多层安全审查
3. **ML 分类器可插拔**：pattern-only 降级策略保证核心安全能力不依赖外部服务

---

## 5. Session 管理与事件总线

### 5.1 SessionManager 架构

**文件**：`crates/goose/src/session/session_manager.rs`

Goose 的 session 管理采用 SQLite 持久化 + 内存缓存的混合模型：

```
SessionManager
  ├── SQLite 持久化（会话状态、消息历史、token 使用量）
  ├── SessionCache（LRU 内存缓存，热 session 避免重复读 DB）
  ├── Session 对象（持有 model_config, total_tokens, session_type）
  └── SessionUpdateBuilder（批量更新 API）
```

### 5.2 Session 数据结构

```rust
pub struct Session {
    pub id: String,
    pub session_type: SessionType,   // Chat | Task | Subagent
    pub model_config: Option<ModelConfig>,
    pub total_tokens: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // ...
}
```

### 5.3 Session 事件广播

Goose 的服务端（`goose-server`）通过 ACP (Agent Communication Protocol) 向连接的客户端广播 session 状态变更：

- **SSE (Server-Sent Events)**：流式文本增量 + 工具调用状态
- **WebSocket**：双向通信（client → server command, server → client notification）
- **Last-Event-ID reconnection**：客户端重连后从上次接收的事件继续（类似 Kanna 的 snapshot replay 机制）

### 5.4 对 AgentHub 的建议

AgentHub 的 session 管理可参考：
1. **SessionType 枚举**区分 Chat/Task/Subagent 三种对话模式
2. **token 使用量追踪**：persist 到 SQLite，用于 context window meter
3. **session token 生命周期**：创建 → 复用 → fork → 过期清理

---

## 6. 对话可见性标志（Visibility Flags）

### 6.1 MessageContent 的受众过滤

**文件**：`crates/goose/src/conversation/message.rs:260-274`

```rust
pub enum MessageContent {
    Text(TextContent),
    Image(ImageContent),
    ToolRequest(ToolRequest),
    ToolResponse(ToolResponse),
    ToolConfirmationRequest(ToolConfirmationRequest),
    ActionRequired(ActionRequired),
    FrontendToolRequest(FrontendToolRequest),
    Thinking(ThinkingContent),             // 模型推理过程
    RedactedThinking(RedactedThinkingContent), // 脱敏推理
    SystemNotification(SystemNotificationContent), // 系统通知
}
```

### 6.2 角色过滤逻辑

```rust
// base.rs:1097-1113 — get_preprompt_context()
// 过滤出仅对 assistant 可见的内容块（用户不可见）
fn get_preprompt_context(&self, messages: &Conversation) -> String {
    messages.iter()
        .filter(|m| m.role == Role::User)
        .take(1)
        .flat_map(|m| m.content.iter())
        .filter_map(|c| {
            // 如果此块对 User 不可见 → 即为 preprompt/assistant-only
            if c.filter_for_audience(Role::User).is_none() {
                c.as_text().map(|s| s.to_string())
            } else { None }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
```

### 6.3 Thinking 内容管理

- **Thinking**：模型推理过程，对 assistant 可见，用户可选查看
- **RedactedThinking**：脱敏后的推理内容（移除敏感信息后的替代品）
- **SystemNotification**：系统级通知（thinking_message / inline_message / credits_exhausted）

### 6.4 对 AgentHub 的建议

AgentHub 的消息模型应支持：
1. **per-role 可见性标记**：每条消息/内容块标记 `visible_to: [User, Assistant, System]`
2. **thinking 内容分离存储**：不混入主文本流，独立渲染
3. **preprompt context**：系统指令和工具描述对用户隐藏

---

## 7. Hooks 系统

### 7.1 事件类型（13 个生命周期事件）

**文件**：`crates/goose/src/hooks/mod.rs:48-63`

```rust
pub enum HookEvent {
    PreToolUse,          // 工具调用前（可阻塞）
    PostToolUse,         // 工具调用成功后
    PostToolUseFailure,  // 工具调用失败后
    SessionStart,        // 会话启动
    SessionEnd,          // 会话结束
    UserPromptSubmit,    // 用户提交消息前（可阻塞）
    BeforeReadFile,      // 读文件前
    AfterFileEdit,       // 文件编辑后
    BeforeShellExecution,// shell 执行前
    AfterShellExecution, // shell 执行后
    Stop,                // stop 事件（可继续对话）
    SubagentStart,       // 子 agent 启动
    SubagentStop,        // 子 agent 停止
}
```

### 7.2 两种执行模式

**非阻塞 emit**：fire-and-forget，错误不传播
```rust
pub async fn emit(&self, event: HookEvent, ctx: HookContext) {
    for rule in rules {
        if matcher.is_match(target) {
            for action in &rule.actions {
                let res = run_command_hook(command, ...).await;
                if let Err(err) = res {
                    warn!("Plugin hook failed: {}", err);  // 仅日志，不阻塞
                }
            }
        }
    }
}
```

**阻塞 emit_blocking**：支持 deny 决策
```rust
pub async fn emit_blocking(&self, event: HookEvent, ctx: HookContext)
    -> HookDecision
{
    // exit code 2 → Deny（stderr 作为原因）
    // stdout {"decision":"block","reason":"..."} → Deny
    // 其他 → Allow（misbehaving hook MUST NOT block）
}
```

### 7.3 配置格式（Open Plugins 规范）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "developer__shell|developer__text_editor",
        "hooks": [
          { "type": "command", "command": "${PLUGIN_ROOT}/scripts/log.sh" }
        ]
      }
    ]
  }
}
```

- **matcher**：正则过滤工具名（如 `developer__.*`）
- **command**：shell 命令，`${PLUGIN_ROOT}` 自动展开
- **timeout**：默认 30s，可配置

### 7.4 对 AgentHub 的建议

1. **阻塞/非阻塞双模式**：PreToolUse/UserPromptSubmit 等需要返回决策的事件用 blocking 模式
2. **matcher 正则过滤**：减小 hook 触发范围，仅对关心的工具生效
3. **exit code 语义简单清晰**：0=成功，2=拒绝，其他=错误（不阻塞）
4. **Open Plugins 规范**对齐：社区标准，降低用户学习成本

---

## 8. 配置系统：YAML + 环境变量 + Keyring

### 8.1 配置加载优先级

**文件**：`crates/goose/src/config/base.rs:81-99`

```
优先级（高→低）：
1. 环境变量（exact key match，snake_case → UPPERCASE 自动转换）
2. ~/.config/goose/config.yaml（用户配置）
3. /etc/goose/config.yaml（系统配置）
4. GOOSE_ADDITIONAL_CONFIG_FILES 指定的额外文件
```

### 8.2 Secrets 三层存储

```
环境变量           → 最高优先级，不持久化
System Keyring     → macOS Keychain / Windows Credential Manager / Linux Secret Service
Secrets File       → ~/.config/goose/secrets.yaml (600 权限，keyring 被禁用时的降级方案)
```

**配置项 trait**：
```rust
pub trait ConfigValue {
    const KEY: &'static str;     // 配置键名
    const DEFAULT: &'static str; // 默认值
}
```

### 8.3 声明式 Provider 配置

**文件**：`crates/goose/src/providers/declarative/`

通过 JSON 文件声明 provider，无需编译 Rust 代码：

```json
// providers/declarative/deepseek.json
{
  "name": "deepseek",
  "display_name": "DeepSeek",
  "description": "DeepSeek API provider",
  "requires_auth": true,
  "api_key_env": "DEEPSEEK_API_KEY",
  "base_url": "https://api.deepseek.com/v1",
  "models": [
    { "name": "deepseek-chat", "context_limit": 65536 },
    { "name": "deepseek-reasoner", "context_limit": 65536, "reasoning": true }
  ]
}
```

### 8.4 Canonical Model Registry

**文件**：`crates/goose/src/providers/canonical/`

Goose 维护了一个 **bundled canonical model registry**（JSON 格式，编译进二进制），用于：

- **模型发现**：provider 返回的模型名 → canonical model ID 映射
- **能力查询**：context_limit、tool_call、reasoning、modalities (text/image/audio)
- **成本信息**：input/output token 定价
- **推荐排序**：按发布日期降序，text+tool_call 模型优先

```rust
pub struct CanonicalModel {
    pub id: String,                    // "anthropic/claude-sonnet-4-20250514"
    pub name: String,                  // "Claude Sonnet 4"
    pub limit: Limit,                  // { context: 200_000, output: 64_000 }
    pub modalities: Modalities,        // { input: [Text, Image], output: [Text] }
    pub cost: Pricing,                 // { input: 3.0, output: 15.0 }
    pub tool_call: bool,               // true
    pub reasoning: Option<bool>,       // true
    pub release_date: Option<String>,   // "2025-05-14"
}
```

本地 provider（Ollama/local）的 cost 会自动归零：

```rust
fn is_local_provider(provider: &str) -> bool {
    matches!(provider, "ollama" | "local")
}
// local provider → canonical.cost = Pricing::default()  // 全部归零
```

### 8.5 对 AgentHub 的建议

1. **声明式 provider** 允许用户通过 JSON/YAML 快速接入新 LLM，无需写 Go 代码
2. **三层配置优先级**（env > file > default）简洁可靠，适合 AgentHub 的多环境部署
3. **Canonical model registry** 是 Goose 最有价值的资产之一——AgentHub 可借鉴其上下文窗口、token 定价、能力标记的数据模型
4. **Secret 管理**：AgentHub 的 credential storage 可参考 keyring → secrets file 的降级模式

---

## 9. 对 AgentHub 的 10 条关键建议

### 9.1 ProviderDef/Provider 双层抽象（P0 采纳）

**建议**：AgentHub 的 `AgentAdapter` 应分离为 `AgentFactory`（元数据 + 构造）和 `AgentInstance`（运行时执行）两层。Goose 用 Rust 关联类型实现编译期绑定，AgentHub 在 Go 中可通过泛型接口实现。

### 9.2 统一 MessageStream 类型（P0 采纳）

**建议**：定义 `type MessageStream = chan StreamItem` 或使用 Go 1.23+ 的 `iter.Seq2`，作为所有 provider 的唯一输出接口。避免每个 adapter 返回不同类型的事件流。

### 9.3 ExtensionManager：一切皆 MCP（P1 采纳）

**建议**：AgentHub 的内置工具和第三方插件统一通过 MCP 协议暴露。实现 `ExtensionManager` 等效组件，管理多个 MCP server 的连接生命周期、工具缓存和前缀命名。

### 9.4 工具检查责任链（P1 采纳）

**建议**：将当前 AgentHub 的权限检查重构为可组合的 inspector 链（Security → Sandbox → Permission → RateLimit），每个 inspector 独立决策，最终合并。

### 9.5 阻塞/非阻塞双模式 Hooks（P1 采纳）

**建议**：参考 Goose 的 `emit()` vs `emit_blocking()` 模式，PreToolUse/UserPromptSubmit 等需要决策的事件走 blocking 模式，其他事件走 fire-and-forget。

### 9.6 Canonical Model Registry（P1 采纳）

**建议**：维护一个 Go embedded JSON 的模型注册表，包含 context_limit、capabilities、pricing 等字段，支持模型发现、智能推荐和成本计算。

### 9.7 声明式 Provider（P2 采纳）

**建议**：支持通过 JSON/YAML 声明新 provider（兼容 OpenAI API 格式的），降低接入新 LLM 的成本。Goose 的 `declarative/*.json` 模式可直接翻译为 Go struct tag 配置。

### 9.8 三层配置优先级（P2 采纳）

**建议**：AgentHub 的配置系统采用 `环境变量 > 配置文件 > 代码默认值` 的优先级链，secrets 走系统 keychain/credential manager 存储。

### 9.9 流式 ThinkFilter（P2 采纳）

**建议**：AgentHub 应实现等效的流式 thinking 标签解析器，在 streaming 过程中实时将 `＜think＞...＜/think＞` 内容分离到单独的 thinking 通道。

### 9.10 工具缓存版本化（P2 采纳）

**建议**：使用 `atomic.Uint64` 作为工具列表的版本号，每次 add/remove extension 时递增，避免频繁的全局锁竞争。

---

## 附录：关键文件索引

| 用途 | 文件路径 |
|------|---------|
| Provider trait 定义 | `crates/goose/src/providers/base.rs` |
| ProviderDef trait | `crates/goose/src/providers/base.rs:802-866` |
| Provider trait | `crates/goose/src/providers/base.rs:866-1208` |
| ProviderRegistry | `crates/goose/src/providers/provider_registry.rs` |
| MessageStream 类型 | `crates/goose/src/providers/base.rs:1213-1215` |
| ThinkFilter | `crates/goose/src/providers/base.rs:40-149` |
| ExtensionManager | `crates/goose/src/agents/extension_manager.rs` |
| Tool inspection pipeline | `crates/goose/src/tool_inspection.rs` |
| Security inspector | `crates/goose/src/security/mod.rs` |
| Hooks 系统 | `crates/goose/src/hooks/mod.rs` |
| Session 管理 | `crates/goose/src/session/session_manager.rs` |
| 对话消息模型 | `crates/goose/src/conversation/message.rs` |
| Config 系统 | `crates/goose/src/config/base.rs` |
| Canonical model registry | `crates/goose/src/providers/canonical/mod.rs` |
| 声明式 Provider 定义 | `crates/goose/src/providers/declarative/*.json` |
| Agent 主循环 | `crates/goose/src/agents/agent.rs` |
