# cc-switch 架构深度调研报告

> 调研日期：2026-05-23
> 源码仓库：`D:\Code\Projects\archive\cc-switch`（farion1231/cc-switch）
> 语言：Rust（Tauri v2 后端） + TypeScript/React（前端），SQLite 持久化
> 定位：跨 AI Agent CLI 的供应商管理与配置切换桌面应用

---

## 1. 项目概述

cc-switch 是一个基于 **Tauri v2** 构建的桌面应用，核心解决一个痛点场景：**为多个 AI Agent CLI 工具统一管理 API 供应商配置**。它支持 Claude Code、Codex、Gemini CLI、OpenCode、OpenClaw 和 Hermes 六种 AI coding agent，内置 50+ 供应商预设（AWS Bedrock、NVIDIA NIM、社区中转服务等），提供系统托盘一键切换。

**核心理念**：用户定义一个供应商（API endpoint + key + model），cc-switch 将其"翻译"为各个 Agent CLI 能理解的本地配置文件格式，写入到对应工具读取的位置，实现一份配置多处生效。

**架构模式**：

```
┌─────────────────────────┐
│    前端 (React + TS)     │  ← TanStack Query v5, shadcn/ui, TailwindCSS
├─────────────────────────┤
│   Tauri IPC (commands)   │  ← serde JSON 序列化边界
├─────────────────────────┤
│   Rust 后端 (src-tauri/)  │
│  ┌───────────────────┐  │
│  │  commands/         │  │  ← Tauri command 层，按领域分文件
│  │  services/         │  │  ← 业务逻辑：provider, mcp, proxy, skill, speedtest
│  │  database/         │  │  ← SQLite DAO 层
│  │  provider.rs       │  │  ← UniversalProvider 核心模型
│  │  codex_config.rs   │  │  ← Codex TOML 动态生成/编辑
│  │  opencode_config.rs│  │  ← OpenCode JSON 配置管理
│  └───────────────────┘  │
├─────────────────────────┤
│  ~/.cc-switch/cc-switch.db  │  ← SQLite SSOT（供应商、MCP、Prompts、Skills）
└─────────────────────────┘
```

**数据存储架构**：

| 层次 | 位置 | 内容 |
|------|------|------|
| SSOT 数据库 | `~/.cc-switch/cc-switch.db` | 所有供应商、MCP、Prompts、Skills 的主数据 |
| 本地设置 | `~/.cc-switch/settings.json` | 设备级 UI 偏好（主题、语言等） |
| Live 文件 | `~/.claude/settings.json`, `~/.codex/auth.json` + `config.toml`, `~/.gemini/.env` | Agent CLI 实际读取的运行时配置 |
| 自动备份 | `~/.cc-switch/backups/` | 最近 10 个轮换备份 |

**双向同步原则**：写入时从 SQLite → Live 文件；编辑当前供应商时从 Live 文件回填 SQLite，防止覆盖用户手动在 Live 文件中的调整。

---

## 2. Universal Provider 模型（核心架构）

### 2.1 设计动机

cc-switch 最关键的架构决策是 **UniversalProvider** 抽象——将 API 供应商的配置（base URL + API key + model preferences）从各个 Agent CLI 的格式细节中解耦出来。用户只需填写一份通用配置，系统自动生成 Claude、Codex、Gemini 各自的 native 配置。

```rust
// src-tauri/src/provider.rs:402-447
pub struct UniversalProvider {
    pub id: String,                    // 唯一标识
    pub name: String,                  // 供应商名称
    pub provider_type: String,         // "newapi" / "custom" / "codex_oauth" ...
    pub apps: UniversalProviderApps,   // {claude, codex, gemini} 启用开关
    pub base_url: String,              // API 基础地址
    pub api_key: String,               // API 密钥
    pub models: UniversalProviderModels, // 各应用的独立模型配置
    pub website_url: Option<String>,
    pub notes: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub meta: Option<ProviderMeta>,    // 扩展元数据
    pub created_at: Option<i64>,
    pub sort_index: Option<usize>,
}
```

其中 `UniversalProviderApps` 是三个 bool 标志：

```rust
// src-tauri/src/provider.rs:340-348
pub struct UniversalProviderApps {
    pub claude: bool,   // 是否为 Claude Code 生成配置
    pub codex: bool,    // 是否为 Codex 生成配置
    pub gemini: bool,   // 是否为 Gemini CLI 生成配置
}
```

`UniversalProviderModels` 为每个应用提供独立的模型选择：

```rust
// src-tauri/src/provider.rs:391-399
pub struct UniversalProviderModels {
    pub claude: Option<ClaudeModelConfig>,
    pub codex: Option<CodexModelConfig>,
    pub gemini: Option<GeminiModelConfig>,
}
```

### 2.2 从 Universal → Agent 配置的映射链

UniversalProvider 提供了三个核心方法，分别生成对应 Agent 的 `Provider` 对象：

```rust
impl UniversalProvider {
    fn to_claude_provider(&self) -> Option<Provider> { ... }
    fn to_codex_provider(&self) -> Option<Provider> { ... }
    fn to_gemini_provider(&self) -> Option<Provider> { ... }
}
```

每个方法如果对应的 `apps.{agent}` 为 `false` 则返回 `None`，否则生成一个 `Provider`，其 `id` 被加前缀区分（如 `universal-claude-{id}`），`category` 固定为 `"aggregator"`。

生成的 `Provider` 再经过 `write_live_snapshot(app_type, &provider)` 路由到各 Agent 的磁盘写入逻辑：

```
UniversalProvider
  │
  ├── to_claude_provider() → Provider { settings_config: { "env": { ANTHROPIC_BASE_URL, ... } } }
  │         │
  │         └── write_live_snapshot(AppType::Claude, provider)
  │               └── 写入 ~/.claude/settings.json
  │
  ├── to_codex_provider() → Provider { settings_config: { "auth": { OPENAI_API_KEY }, "config": "<TOML>" } }
  │         │
  │         └── write_live_snapshot(AppType::Codex, provider)
  │               ├── 写入 ~/.codex/auth.json  (auth 字段)
  │               └── 写入 ~/.codex/config.toml (config 字段)
  │
  └── to_gemini_provider() → Provider { settings_config: { "env": { GEMINI_API_KEY, ... } } }
            │
            └── write_live_snapshot(AppType::Gemini, provider)
                  └── write_gemini_live(provider)
                        ├── 写入 ~/.gemini/.env  (env 键值对)
                        └── 写入 ~/.gemini/settings.json (config 字段)
```

### 2.3 settings_config 的两种结构模式

Universal 生成的 `Provider.settings_config` 是一个 `serde_json::Value`，但不同 Agent 使用**完全不同的 JSON 结构**：

**Claude/Gemini 使用 `env` 模式**：

```json
{
    "env": {
        "ANTHROPIC_BASE_URL": "https://api.example.com",
        "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
        "ANTHROPIC_MODEL": "claude-sonnet-4-20250514",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-20250514",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-20250514",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-20250514"
    }
}
```

**Codex 使用 `auth` + `config` 模式**（config 是完整 TOML 字符串）：

```json
{
    "auth": {
        "OPENAI_API_KEY": "sk-xxx"
    },
    "config": "model_provider = \"newapi\"\nmodel = \"gpt-4o\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.newapi]\nname = \"NewAPI\"\nbase_url = \"https://api.example.com/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
}
```

这种差异化的 `settings_config` 结构是 cc-switch 的核心设计——它不是简单的 key-value 泛化，而是**针对每个 Agent 的配置格式做了深度耦合**。`write_live_snapshot` 函数在写入时从 `settings_config` 中提取对应字段并路由到正确的文件路径。

---

## 3. 各 Agent 的配置转换细节

### 3.1 Claude Code 配置

Claude Code 使用 **环境变量 + settings.json** 模式。cc-switch 直接写入 `~/.claude/settings.json`。

**四个独立模型环境变量**是 Claude 配置最独特的设计（`provider.rs:496-504`）：

```rust
let settings_config = json!({
    "env": {
        "ANTHROPIC_BASE_URL": self.base_url,
        "ANTHROPIC_AUTH_TOKEN": self.api_key,
        "ANTHROPIC_MODEL": model,                    // 主模型
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku,      // Haiku 子模型
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet,    // Sonnet 子模型
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus,        // Opus 子模型
    }
});
```

这允许用户为 Claude Code 的四个模型系列分别指定不同的模型名。如果用户未指定子模型，所有四个环境变量都会回落为同一个 `model` 值。默认主模型为 `claude-sonnet-4-20250514`。

**写入机制**（`live.rs:669-672`）：

```rust
AppType::Claude => {
    let path = get_claude_settings_path();  // ~/.claude/settings.json
    let settings = sanitize_claude_settings_for_live(&provider.settings_config);
    write_json_file(&path, &settings)?;
}
```

写入前会调用 `sanitize_claude_settings_for_live` 移除内部管理字段（`api_format`, `apiFormat`, `openrouter_compat_mode` 等），确保这些字段不会泄漏到 Claude Code 实际读取的配置中。

### 3.2 Codex 配置

Codex 使用 **auth.json + config.toml 双文件** 模式，是三个 agent 中配置最复杂的。

**TOML 动态生成**（`provider.rs:551-563`）：

```rust
let config_toml = format!(
    r#"model_provider = "newapi"
model = "{model}"
model_reasoning_effort = "{reasoning_effort}"
disable_response_storage = true

[model_providers.newapi]
name = "NewAPI"
base_url = "{codex_base_url}"
wire_api = "responses"
requires_openai_auth = true"#
);
```

**base_url 智能 /v1 后缀逻辑**（`provider.rs:537-549`）：

```rust
let base_trimmed = self.base_url.trim_end_matches('/');
let origin_only = match base_trimmed.split_once("://") {
    Some((_scheme, rest)) => !rest.contains('/'),
    None => !base_trimmed.contains('/'),
};
let codex_base_url = if base_trimmed.ends_with("/v1") {
    base_trimmed.to_string()       // 已有 /v1 → 保持
} else if origin_only {
    format!("{base_trimmed}/v1")  // 纯 origin → 追加 /v1
} else {
    base_trimmed.to_string()       // 自定义前缀 → 不追加
};
```

三种情况的测试用例覆盖完整（`provider.rs:859-1025`）：

| 输入 base_url | 结果 | 说明 |
|---------------|------|------|
| `https://api.openai.com` | `https://api.openai.com/v1` | 纯 origin，追加 /v1 |
| `https://api.example.com/v1` | `https://api.example.com/v1` | 已有 /v1，保持 |
| `https://example.com/openai` | `https://example.com/openai` | 自定义路径，不追加 |

**写入机制**（`live.rs:674-689`）采用原子回滚式写入：

```rust
AppType::Codex => {
    // 从 settings_config JSON 的 "auth" 和 "config" 字段提取
    let auth = obj.get("auth")...;
    let config_str = obj.get("config").and_then(|v| v.as_str())...;
    // 写入 ~/.codex/auth.json
    write_json_file(&auth_path, auth)?;
    // 写入 ~/.codex/config.toml
    std::fs::write(&config_path, config_str)?;
}
```

**TOML 现场编辑**（`codex_config.rs:148-203`）：`update_codex_toml_field` 使用 `toml_edit` 库实现语法保留式编辑——修改 `model_providers.<current>.base_url` 或顶层 `model` 字段时，会保留原有的注释和空白格式。编辑语法为 TOML，注释以 `#` 开头。

**OAuth 认证模式**：Provider 支持通过 `meta.provider_type = "codex_oauth"` 标记为 Codex OAuth 供应商。`Provider.is_codex_oauth()`（`provider.rs:69-71`）检查此标记。OAuth 模式还支持 FAST mode（`meta.codex_fast_mode`），注入 `service_tier = "priority"` 来降低延迟。

### 3.3 Gemini CLI 配置

Gemini 使用 **.env 文件 + settings.json** 模式。cc-switch 写入 `~/.gemini/.env` 和 `~/.gemini/settings.json`。

**生成的 env 环境变量**（`provider.rs:599-605`）：

```rust
let settings_config = json!({
    "env": {
        "GOOGLE_GEMINI_BASE_URL": self.base_url,
        "GEMINI_API_KEY": self.api_key,
        "GEMINI_MODEL": model,   // 默认 "gemini-2.5-pro"
    }
});
```

**认证类型自动检测**（`services/provider/gemini_auth.rs`）：`detect_gemini_auth_type(provider)` 识别三种认证模式：

| 认证模式 | 行为 |
|----------|------|
| GoogleOfficial | OAuth 模式，不验证 API key，保留 GEMINI_MODEL 等自定义变量 |
| Packycode | API Key 模式，要求 GEMINI_API_KEY 必须存在 |
| Generic | API Key 模式，标准验证 |

**写入机制**（`live.rs:1112-1191`）：

```rust
fn write_gemini_live(provider: &Provider) -> Result<(), AppError> {
    let auth_type = detect_gemini_auth_type(provider);
    let env_map = json_to_env(&provider.settings_config)?;
    // 合并 config 字段到现有 settings.json（保留 mcpServers 等）
    // 根据 auth_type 写入 ~/.gemini/.env
    // 根据 auth_type 设置 security.auth.selectedType
}
```

Gemini 特殊之处在于 `.env` 文件以 `KEY=VALUE` 行格式存储，cc-switch 实现了完整的 `parse_env_file` / `json_to_env` 双向转换（`gemini_config.rs`）。

### 3.4 OpenCode 配置（累加模式）

OpenCode 与 Claude/Codex/Gemini 不同，它使用**累加模式（additive mode）**——不是用新的配置替换旧配置，而是在 `~/.config/opencode/opencode.json` 中增加/更新 provider 条目。

**OpenCode 的配置格式**基于 AI SDK 的 npm 包名（`opencode_config.rs:629-655`）：

```rust
pub struct OpenCodeProviderConfig {
    pub npm: String,                              // "@ai-sdk/openai-compatible", "@ai-sdk/anthropic" 等
    pub name: Option<String>,                     // 供应商显示名称
    pub options: OpenCodeProviderOptions,         // baseURL, apiKey, headers, extra
    pub models: HashMap<String, OpenCodeModel>,   // "model-id" → { name, limit, options }
}
```

**模型定义**（`provider.rs:690-719`）：

```rust
pub struct OpenCodeModel {
    pub name: String,
    pub limit: Option<OpenCodeModelLimit>,  // context, output token 限制
    pub options: Option<HashMap<String, Value>>,
    pub extra: HashMap<String, Value>,      // cost, modalities, thinking, variants 等
}
```

**累加写入**（`opencode_config.rs:89-104`）：

```rust
pub fn set_provider(id: &str, config: Value) -> Result<(), AppError> {
    let mut full_config = read_opencode_config()?;  // 读取完整的 opencode.json
    if full_config.get("provider").is_none() {
        full_config["provider"] = json!({});
    }
    // 在顶层 provider 对象中加入/更新此 id 对应的条目
    providers.insert(id.to_string(), config);
    write_opencode_config(&full_config)  // 写回完整文件
}
```

### 3.5 OpenClaw / Hermes 配置

- **OpenClaw**（`openclaw_config.rs`）：类似 OpenCode，使用累加模式写入 `~/.openclaw/openclaw.json`，包含 `baseUrl`, `api`, `models` 等字段。
- **Hermes**（`hermes_config.rs`）：写入 `~/.hermes/config.yaml`（YAML 格式），累加模式管理 providers。

---

## 4. config.json 通用配置片段机制

cc-switch 的 **通用配置片段** 是一个精巧的设计：用户可以在 config.json 中定义一份跨供应商共享的配置（如 MCP servers、allowed tools、自定义 env），在写入 live 文件时，如果 provider 标记了 `meta.common_config_enabled`，片段会自动 merge 到 settings_config 中。

**片段格式因 App 而异**（`live.rs:479-502`）：

```
Claude:  JSON 对象 → json_deep_merge 到 settings_config
Codex:   TOML 文本 → merge_toml_table_like 到 config 字段的 TOML AST
Gemini:  JSON 对象 → json_deep_merge 到 settings_config 的 env 子对象
```

`build_effective_settings_with_common_config` 负责这个合并过程。反向操作 `sanitize_claude_settings_for_live` / `remove_common_config_from_settings` 确保回填时通用片段被正确剥离，防止重复写入。

**检测逻辑**：对于未显式设置 `common_config_enabled` 的旧 provider，通过 `json_is_subset` / `toml_item_is_subset` 做子集检测——如果 live 配置中已包含片段内容，自动推断为启用了通用配置。

### 4.1 通用片段的数据流闭环

通用配置片段涉及三个关键函数，形成一个完整的写入/回填/存储闭环：

```
写入链路（SSOT → Live）：
  provider.settings_config
    → build_effective_settings_with_common_config()  [合并 config.json 片段]
      → write_live_with_common_config()
        → write_live_snapshot()  [写入磁盘]

回填链路（Live → SSOT）：
  live 文件内容
    → read_live_settings()
      → strip_common_config_from_live_settings()  [剥离通用片段]
        → 存储到 SQLite provider.settings_config

存储链路（用户编辑 → SQLite）：
  provider.settings_config (含通用片段内容)
    → normalize_provider_common_config_for_storage()  [保存前剥离]
      → db.save_provider()
```

这种闭环设计确保了：用户既看不到通用片段内容混入自己的 provider 配置，也不会在切换 provider 时丢失通用配置。

### 4.2 子集检测的递归算法

`json_is_subset(target, source)`（`live.rs:51-71`）实现递归深度比较：

- 对象：source 的每个 key 必须在 target 中存在且值也满足子集关系
- 数组：使用贪心匹配（`json_array_contains_subset`），source 的每个元素在 target 中找一个未匹配的对应元素
- 标量：直接相等比较

数组的子集匹配不是简单的位置匹配，而是元素级别的"存在性匹配"——只要 target 数组中能找齐 source 的所有元素（每个元素匹配一次）即为子集。对应的删除操作 `json_remove_array_items` 也只删除匹配到的元素，保留 target 中的额外项。

TOML 版本的 `toml_item_is_subset`（`live.rs:213-231`）使用相同的算法但操作 `toml_edit` 的 AST 节点，支持 InlineTable 的递归比较。

---

## 5. 默认供应商导入与初始化流程

### 5.1 冷启动导入链路

cc-switch 初次启动时，如果用户已经安装了某个 Agent CLI 且有现存配置，会自动导入为默认供应商：

```rust
// live.rs:1014-1109
pub fn import_default_config(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
    // 如果已有非 seed 的 provider → 跳过
    if state.db.has_non_official_seed_provider(app_type.as_str())? {
        return Ok(false);
    }

    // 根据 AppType 读取对应的 live 文件
    let settings_config = match app_type {
        AppType::Codex => {
            // 读取 ~/.codex/auth.json + config.toml → { "auth": ..., "config": "..." }
            json!({ "auth": auth, "config": config_str })
        }
        AppType::Claude => {
            // 读取 ~/.claude/settings.json → 直接作为 settings_config
            let mut v = read_json_file::<Value>(&settings_path)?;
            normalize_claude_models_in_value(&mut v);  // 规范化模型字段
            v
        }
        AppType::Gemini => {
            // 读取 ~/.gemini/.env + settings.json → { "env": {...}, "config": {...} }
            json!({ "env": env_obj, "config": config_obj })
        }
        // ...
    };

    let mut provider = Provider::with_id("default".to_string(), "default".to_string(), settings_config, None);
    provider.category = Some("custom".to_string());
    state.db.save_provider(app_type.as_str(), &provider)?;
    state.db.set_current_provider(app_type.as_str(), &provider.id)?;
    Ok(true)
}
```

关键逻辑：
1. **Seed 保护**：只跳过"非官方 seed 的 provider"，确保新用户（providers 为空）的导入不被阻塞
2. **模型规范化**：`normalize_claude_models_in_value` 处理旧格式模型字段的兼容
3. **累加模式跳过**：OpenCode/OpenClaw/Hermes 等累加模式使用专门的 `import_xxx_providers_from_live` 函数

### 5.2 累加模式的导入

OpenCode 的导入（`live.rs:1217-1267`）遍历 `opencode.json` 中的所有 provider 条目，对每个条目：

```rust
for (id, config) in providers {
    if existing_ids.contains(&id) { continue; }  // 去重
    let settings_config = serde_json::to_value(&config)?;
    let mut provider = Provider::with_id(id.clone(), display_name, settings_config, None);
    provider.meta = Some(ProviderMeta { live_config_managed: Some(true), ..Default::default() });
    state.db.save_provider("opencode", &provider)?;
}
```

`live_config_managed: Some(true)` 标记该 provider 由 Live 导入管理，后续同步时会被正确处理。

---

## 6. ProviderManager 和故障转移

### 6.1 ProviderManager 结构

```rust
// src-tauri/src/provider.rs:90-94
pub struct ProviderManager {
    pub providers: IndexMap<String, Provider>,  // 有序 map，保持插入顺序
    pub current: String,                         // 当前激活的 provider ID
}
```

使用 `IndexMap` 而非 `HashMap` 是因为需要保持 provider 的添加/排序顺序（支持前端拖拽排序）。

### 6.2 故障转移队列

Provider 的 `in_failover_queue` 字段（`provider.rs:41-42`）标记该供应商是否参与自动故障转移队列。当当前供应商不可用时，系统按队列顺序切换到下一个可用供应商。

### 6.3 端点自动选择

`ProviderMeta.endpoint_auto_select`（`provider.rs:236`）启用后，系统对自定义端点列表进行测速，自动切换到延迟最低的端点。测速通过 `SpeedtestService`（`services/speedtest.rs`）执行。

### 6.4 本地代理热切换

cc-switch 内置 Proxy 模块（`proxy/` 目录和 `services/proxy.rs`），支持：
- 为 Claude、Codex、Gemini 分别配置代理
- 格式转换（Claude Messages API ↔ OpenAI Chat Completions / Responses API）
- 熔断器、健康监控和整流器
- 代理 URL 的自动注入和清理（`codex_config.rs:208-252` 的 `remove_codex_toml_base_url_if` 函数专门用于清理本地代理 URL）

---

## 7. 用量追踪、会话管理与云同步

### 7.1 用量追踪

`UsageScript`（`provider.rs:97-131`）定义了用量查询脚本配置，支持：
- 自定义脚本语言和代码
- NewAPI 模板（内建 query 逻辑）
- 通用模板（提供 baseUrl + apiKey + accessToken + userId）
- 自动查询间隔
- Coding Plan 供应商标记（kimi, zhipu, minimax 等）

用量数据使用 `UsageData` 结构（`provider.rs:135-156`），包含 planName、total/used/remaining 和 unit。

### 7.2 会话管理器

对应前端 `sessions/` 目录和后端 `session_manager/` 目录，支持浏览、搜索和恢复全部六个应用（Claude Code / Codex / Gemini / OpenCode / OpenClaw / Hermes）的对话历史。

### 7.3 云同步

通过 `WebDavSyncSettings`（`settings.rs`）支持 Dropbox、OneDrive、iCloud、WebDAV 等云存储同步供应商数据。同步内容包括 SQLite 数据库，使用 manifest hash 做增量同步。

---

## 8. 技术栈总结

| 层次 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | Vite 构建，shadcn/ui 组件库 |
| 状态管理 | TanStack Query v5 | 前端缓存与同步 |
| 样式 | TailwindCSS 3.4 | Utility-first CSS |
| 表单 | react-hook-form + zod | 类型安全表单验证 |
| 拖拽 | @dnd-kit | 供应商拖拽排序 |
| 桌面框架 | Tauri 2.8 | Rust 后端 + 系统托盘 + 原生窗口 |
| 数据库 | SQLite (via rusqlite) | SSOT 数据存储 |
| 序列化 | serde + serde_json + toml_edit | JSON/TOML 双向序列化 |
| 并发 | tokio | 异步 Runtime |
| 国际化 | react-i18next | 中/英/日 三语 |
| 测试 | vitest + MSW + testing-library | 前端单元/组件测试 |
| Rust 测试 | cargo test (内置) | 后端单元测试（大量覆盖关键路径） |
| 原子写入 | 临时文件 + rename | 防止配置文件半写损坏 |
| 配置格式 | JSON (Claude/OpenCode/OpenClaw), TOML (Codex), .env (Gemini), YAML (Hermes) | 五种不同的 live 配置格式 |

---

## 9. 对 AgentHub 的借鉴意义

按实用优先级排列，附带 Go 端实现建议：

### 9.1 UniversalProvider 模式 -- 一个配置驱动多 Agent

AgentHub 的 `model_config.go` 可以采用相同的抽象层。定义一个通用配置结构，然后为每个 Adapter 提供 `BuildEnv()` 方法生成环境变量：

```go
// 示意：AgentHub 可以引入的 UniversalModelConfig
type UniversalModelConfig struct {
    APIKey   string
    BaseURL  string
    Claude   *ClaudeModels  // opus, sonnet, haiku 独立模型名
    Codex    *CodexModels    // model, reasoning_effort
    Gemini   *GeminiModels   // model
}

type ClaudeModels struct {
    Main, Haiku, Sonnet, Opus string
}

type CodexModels struct {
    Model string; ReasoningEffort string
}

// 每个 Adapter 实现 ToEnvVars()
func (c *UniversalModelConfig) ToClaudeEnvVars() map[string]string {
    return map[string]string{
        "ANTHROPIC_BASE_URL":             c.BaseURL,
        "ANTHROPIC_AUTH_TOKEN":           c.APIKey,
        "ANTHROPIC_MODEL":                c.Claude.Main,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL":  c.Claude.Haiku,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": c.Claude.Sonnet,
        "ANTHROPIC_DEFAULT_OPUS_MODEL":   c.Claude.Opus,
    }
}
```

### 9.2 Codex config.toml 动态生成逻辑

AgentHub 的 `CodexAdapter` 应参考 cc-switch 的自动生成逻辑，特别是 base_url /v1 后缀的智能判断。关键是三种情况的处理：

```go
func buildCodexBaseURL(rawURL string) string {
    u, _ := url.Parse(strings.TrimRight(rawURL, "/"))
    // 情况1: 已有 /v1 后缀 → 保持
    if strings.HasSuffix(u.Path, "/v1") {
        return u.String()
    }
    // 情况2: 纯 origin (path == "" 或 "/") → 追加 /v1
    if u.Path == "" || u.Path == "/" {
        return u.String() + "/v1"
    }
    // 情况3: 自定义路径前缀 → 不追加
    return u.String()
}
```

config.toml 模板应包含完整的 `model_providers` 节：

```toml
model_provider = "newapi"
model = "{model}"
model_reasoning_effort = "{effort}"
disable_response_storage = true

[model_providers.newapi]
name = "NewAPI"
base_url = "{base_url}"
wire_api = "responses"
requires_openai_auth = true
```

### 9.3 Claude 多模型分离

cc-switch 使用 4 个独立环境变量分离 Haiku/Sonnet/Opus 模型设置。AgentHub 的 `ClaudeAdapter` 在构建启动进程的环境变量时，应分别设置这四个值，允许用户在配置中为不同复杂度任务指定不同模型：

```
ANTHROPIC_MODEL              → 主模型（默认 claude-sonnet-4-20250514）
ANTHROPIC_DEFAULT_HAIKU_MODEL → 轻量级快速模型
ANTHROPIC_DEFAULT_SONNET_MODEL → 平衡模型
ANTHROPIC_DEFAULT_OPUS_MODEL  → 重量级深度推理模型
```

如果用户只配置了一个模型名，四个环境变量都指向同一值（fallback 逻辑）。

### 9.4 OpenCode npm 包配置

AgentHub 的 `OpenCodeAdapter` 需要构造类似结构写入 `opencode.json` 的 `provider` 字段：

```json
{
    "npm": "@ai-sdk/openai-compatible",
    "options": {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "sk-xxx"
    },
    "models": {
        "gpt-4o": { "name": "GPT-4o", "limit": { "context": 128000, "output": 16384 } }
    }
}
```

关键点是 `npm` 字段——它决定了 OpenCode 使用哪个 AI SDK 包来发起请求。常用值包括 `@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`、`@ai-sdk/google` 等。

### 9.5 api_format 桥接

cc-switch 通过 `ProviderMeta.api_format` 控制 Claude 的 API 格式。AgentHub 可以为 ClaudeAdapter 添加一个 `APIMode` 字段：

```go
type ClaudeAdapterConfig struct {
    // "anthropic" (默认): 原生 Anthropic Messages API
    // "openai_chat":      OpenAI Chat Completions 格式（需转换）
    // "openai_responses": OpenAI Responses API 格式（需转换）
    APIMode string
}
```

配合 cc-switch 的 `prompt_cache_key` 字段（`ProviderMeta.prompt_cache_key`），在 openai_responses 模式下可注入缓存键提缓存命中率。

### 9.6 原子写入策略

cc-switch 的原子写入模式可直接转换为 Go 实现：

```go
func AtomicWrite(path string, data []byte) error {
    dir := filepath.Dir(path)
    base := filepath.Base(path)
    tmp := filepath.Join(dir, fmt.Sprintf("%s.tmp.%d", base, time.Now().UnixNano()))

    if err := os.WriteFile(tmp, data, 0644); err != nil {
        return err
    }
    // 跨平台原子替换
    return os.Rename(tmp, path)
}
```

对于 Codex 的 auth.json + config.toml 双文件原子写入，应实现回滚机制：先写第一个文件，第二个失败时恢复第一个。

### 9.7 Live 配置双向同步

cc-switch 的核心闭环流程可直接在 AgentHub 中复制。在 AgentHub 的 Edge Server 配置管理逻辑中：

```
写入链路：
  AgentHub config.json (SSOT)
    → AgentAdapter.BuildLiveConfig()
      → 写入 Agent CLI 的 live 配置文件

回填链路：
  用户手动编辑 live 文件
    → AgentAdapter.ReadLiveConfig()
      → 差异检测 → 提示用户是否覆盖 SSOT
```

与 cc-switch 不同的是，AgentHub 作为服务端网关，可以采用"配置哈希快照"来检测用户手动修改，而非 cc-switch 的数据库查询比较。

### 9.8 通用配置片段模式

如果 AgentHub 支持多个 API 供应商共享相同的基础配置（如 MCP servers、权限设置等），可以引入 fragment merge：

```go
type CommonConfigFragment struct {
    McpServers map[string]McpServer `json:"mcpServers"`
    Permissions map[string]string    `json:"permissions"`
    // ...
}

func ApplyFragment(appType AppType, baseConfig, fragment []byte) ([]byte, error) {
    // Claude: JSON deep merge
    // Codex:  TOML AST merge (保留注释)
    // Gemini: merge 到 .env 的 key-value 对
}
```

---

## 10. AppType 枚举：六种 Agent 的协议感知

```rust
// src-tauri/src/app_config.rs
pub enum AppType {
    Claude,    // 替换式：写入 ~/.claude/settings.json
    Codex,     // 替换式：写入 ~/.codex/auth.json + config.toml
    Gemini,    // 替换式：写入 ~/.gemini/.env + settings.json
    OpenCode,  // 累加式：写入 opencode.json 的 provider 子对象
    OpenClaw,  // 累加式：写入 openclaw.json 的 provider 子对象
    Hermes,    // 累加式：写入 config.yaml 的 provider 子对象
}
```

`is_additive_mode()` 方法区分两种配置同步模式：
- **替换式**（Claude, Codex, Gemini）：当前激活的 provider 完全替换 live 文件
- **累加式**（OpenCode, OpenClaw, Hermes）：所有 provider 累加到同一个 live 配置文件中

两种模式的同步逻辑统一在 `sync_current_to_live`（`live.rs:867-902`）中处理。

---

## 11. 总结

cc-switch 是一个设计精巧的供应商管理工具，其核心价值在于：

1. **UniversalProvider 抽象层**：将 API 供应商配置从各 Agent CLI 的格式细节中解耦，一次配置多处生效
2. **Agent-aware 的 settings_config 设计**：不是简单的 key-value 泛化，而是为每个 Agent 定制 JSON 结构（env 模式 vs auth+config 模式）
3. **原子写 + 回滚**：对关键配置文件采用临时文件 rename + 失败回滚策略，杜绝半写损坏
4. **双向同步**：SSOT 数据库与 Live 文件的相互填充，容忍用户直接编辑 Live 文件
5. **通用配置片段**：跨供应商共享 MCP/prompts 等配置的创新方案

对 AgentHub 而言，cc-switch 的 UniversalProvider 模式是最具迁移价值的架构设计——将 API 供应商与 Agent CLI 的耦合从 Adapter 层提升到 Model 层，用一个统一的模型配置生成多个 Agent 的专用配置。

---

## 附录：关键文件索引

| 文件 | 核心内容 |
|------|----------|
| `src-tauri/src/provider.rs` | UniversalProvider 模型、ProviderManager、OpenCodeProviderConfig、UsageScript |
| `src-tauri/src/provider_defaults.rs` | 默认供应商图标映射（20+ 供应商） |
| `src-tauri/src/services/provider/live.rs` | Live 配置读写、common config merge/strip、sync 逻辑 |
| `src-tauri/src/codex_config.rs` | Codex auth.json + config.toml 读写、原子回滚、TOML 字段编辑 |
| `src-tauri/src/opencode_config.rs` | OpenCode 累加式 provider 管理、plugin 管理 |
| `src-tauri/src/gemini_config.rs` | Gemini .env 解析/生成、认证类型检测 |
| `src-tauri/src/config.rs` | 路径管理、原子写入、config 读写工具 |
| `src-tauri/src/settings.rs` | VisibleApps、WebDAV 同步设置 |
| `src-tauri/src/error.rs` | AppError 类型定义 |
| `README_ZH.md` | 项目中文概述（功能特性、架构总览、开发指南） |
