# cc-switch Model Mapping Deep Dive

最后更新：2026-06-10

## 1. Architecture Overview

cc-switch is a Tauri desktop application that acts as a transparent proxy between AI coding tools (Claude Code, Codex CLI, Gemini CLI) and actual AI providers (OpenAI, DeepSeek, Anthropic, etc.). The core value proposition is **invisible model substitution**: the user configures "Claude Sonnet" in Claude Code, but cc-switch intercepts the API call and routes it to a cheaper or faster model like DeepSeek v4 Pro.

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│ Claude Code  │────▶│ cc-switch Proxy      │────▶│ DeepSeek API │
│ (thinks it's │     │ (model_mapper.rs)    │     │ (real model) │
│  Anthropic)  │◀────│ (transform.rs)       │◀────│              │
└─────────────┘     └──────────────────────┘     └──────────────┘
   Anthropic fmt        ↑ maps models                OpenAI fmt
   ANTHROPIC_BASE_URL   ↑ transforms req/resp
   = localhost           ↑ failover + circuit breaker
```

The pipeline for each request:
1. Claude Code sends Anthropic-format request to `ANTHROPIC_BASE_URL` (which points to cc-switch)
2. cc-switch's `RequestForwarder.forward()` applies model mapping via `model_mapper.rs`
3. If the provider requires format conversion, `transform.rs` converts Anthropic to OpenAI format
4. Request is forwarded to the real upstream provider
5. Response is converted back from OpenAI to Anthropic format
6. Claude Code receives a perfectly valid Anthropic response -- none the wiser

---

## 2. Model Mapper Implementation

**Source**: `src-tauri/src/proxy/model_mapper.rs`

### 2.1 Configuration Schema

Model mapping rules are stored inside each Provider's `settings_config.env` object. The mapping uses four environment variable keys:

```json
{
  "settingsConfig": {
    "env": {
      "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
      "ANTHROPIC_AUTH_TOKEN": "sk-deepseek-key",
      "ANTHROPIC_MODEL": "deepseek-v4-pro",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro"
    }
  }
}
```

| Key | Purpose | Example |
|-----|---------|---------|
| `ANTHROPIC_MODEL` | Default/fallback model when no role matches | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Maps any request containing "haiku" | `deepseek-v4-flash` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Maps any request containing "sonnet" | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Maps any request containing "opus" | `deepseek-v4-pro` |

### 2.2 Mapping Algorithm

The `ModelMapping` struct extracts mappings from a Provider:

```rust
pub struct ModelMapping {
    pub haiku_model: Option<String>,
    pub sonnet_model: Option<String>,
    pub opus_model: Option<String>,
    pub default_model: Option<String>,
}
```

The `map_model()` method performs **case-insensitive substring matching** in priority order:

```
1. Check if model name contains "haiku"  → return haiku_model
2. Check if model name contains "opus"   → return opus_model
3. Check if model name contains "sonnet" → return sonnet_model
4. Return default_model (if configured)
5. Return original model name (passthrough)
```

**Important**: The matching is substring-based and case-insensitive. `claude-sonnet-4-5-20250929`, `Claude-SONNET-4-5`, and `claude-sonnet-4-5-20250101` all match the sonnet rule. However, `thinking` parameters in the request body do NOT affect model mapping (verified by tests for `thinking: {type: "enabled"}`, `thinking: {type: "adaptive"}`, and `thinking: {type: "disabled"}`).

### 2.3 Apply Function

```rust
pub fn apply_model_mapping(
    mut body: Value,         // The request JSON body
    provider: &Provider,     // The active provider config
) -> (Value, Option<String>, Option<String>)
```

Returns a tuple of `(modified_body, original_model_name, mapped_model_name)`. If no mapping is configured (`has_mapping()` returns false), the body is returned unchanged with `mapped = None`.

### 2.4 [1M] Suffix Stripping

Claude Code appends `[1M]` (case-insensitive) to model names to declare 1M context capability. Since upstream APIs don't understand this marker, cc-switch strips it before forwarding:

```rust
pub fn strip_one_m_suffix_for_upstream(model: &str) -> &str
// "deepseek-v4-pro[1M]" → "deepseek-v4-pro"
// "deepseek-v4-pro"      → "deepseek-v4-pro" (unchanged)
```

This runs **after** model mapping, so users can configure `"deepseek-v4-pro [1M]"` as a mapped model and the suffix will be cleanly removed.

---

## 3. Proxy Forwarder Flow

**Source**: `src-tauri/src/proxy/forwarder.rs`

### 3.1 Request Processing Pipeline

The `RequestForwarder` processes each request through `forward_with_retry()` → `forward_with_retry_inner()` → `forward()`:

```
forward_with_retry()
  ├── Acquire ActiveConnectionGuard (RAII, tracks active_connections)
  ├── Record total_requests++
  └── forward_with_retry_inner()
        ├── For each provider in failover list:
        │     ├── Circuit breaker check (skip if provider is unhealthy)
        │     ├── Clone body for this provider attempt
        │     ├── Bedrock optimizer (if applicable)
        │     └── forward() ← single provider attempt
        │           ├── Model mapping (model_mapper or claude_desktop route)
        │           ├── Normalize thinking type
        │           ├── Strip [1M] suffix
        │           ├── Copilot optimizer (classification + sanitization)
        │           ├── Claude API format resolution
        │           ├── Format transform (Anthropic → OpenAI/Responses/Gemini)
        │           ├── Filter private params (_prefixed fields)
        │           ├── Build auth headers
        │           ├── Send HTTP request (hyper raw or reqwest pooled)
        │           └── Check response status
        │
        ├── On error: rectifier retry (thinking signature, budget, media)
        ├── On error: categorize (Retryable vs NonRetryable)
        └── On success: record metrics, return ForwardResult
```

### 3.2 Model Mapping Dispatch Point

In `forward()`, model mapping happens at line ~1112, **before** format transformation:

```rust
// Claude Desktop proxy mode uses explicit route mapping
let mapped_body = if matches!(app_type, AppType::ClaudeDesktop) {
    crate::claude_desktop_config::map_proxy_request_model(body.clone(), provider)?
} else {
    // Claude Code uses keyword-based model mapping
    let (mapped_body, _, _) = super::model_mapper::apply_model_mapping(body.clone(), provider);
    mapped_body
};
```

### 3.3 Two Mapping Modes

| Mode | Used For | Mapping Logic |
|------|----------|---------------|
| **Keyword mapping** | Claude Code | Substring match on "haiku"/"sonnet"/"opus" + default fallback |
| **Route mapping** | Claude Desktop | Explicit `claude_desktop_model_routes` map: route_id → upstream_model |

### 3.4 Failover and Circuit Breaker

The forwarder supports multi-provider failover:

- **Provider list**: Multiple providers can be configured per app; the forwarder tries each in order
- **Circuit breaker**: Each provider has circuit breaker state (Closed/Open/HalfOpen); unhealthy providers are skipped
- **Max attempts**: Controlled by `AppProxyConfig.max_retries` (default: 3 retries = 4 max attempts)
- **Error categorization**: Network/upstream 5xx errors are retryable; 400/422/405/etc are client errors that fail immediately
- **Rectifier retries**: Special retry paths for thinking signature issues and thinking budget issues (only for Claude/ClaudeAuth providers)

### 3.5 Thinking Parameter Handling

The forwarder normalizes thinking parameters via `normalize_thinking_type()` but does NOT proactively rewrite thinking. Two rectifier paths handle upstream rejections:

1. **Signature rectifier**: If upstream rejects thinking signatures, strips `signature` fields and `thinking`/`redacted_thinking` blocks, then retries
2. **Budget rectifier**: If upstream rejects thinking budget, adjusts `budget_tokens` and retries

---

## 4. Provider Configuration

**Sources**: `src-tauri/src/provider.rs`, `src-tauri/src/provider_defaults.rs`

### 4.1 Provider Data Model

```rust
pub struct Provider {
    pub id: String,
    pub name: String,
    pub settings_config: Value,       // The env/config/auth payload
    pub website_url: Option<String>,
    pub category: Option<String>,
    pub meta: Option<ProviderMeta>,   // Extended metadata (not in live config)
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub in_failover_queue: bool,
    // ...
}
```

The `settings_config` field is a JSON blob whose structure varies by AppType:

| AppType | settings_config shape | Key fields |
|---------|-----------------------|------------|
| Claude/ClaudeDesktop | `{ "env": { "ANTHROPIC_BASE_URL": ..., "ANTHROPIC_AUTH_TOKEN": ... } }` | env map |
| Codex | `{ "auth": { "OPENAI_API_KEY": ... }, "config": "TOML string" }` | auth + TOML config |
| Gemini | `{ "env": { "GEMINI_API_KEY": ..., "GOOGLE_GEMINI_BASE_URL": ... } }` | env map |

### 4.2 ProviderMeta (Extended Metadata)

`ProviderMeta` is stored in cc-switch's internal database only; it is **never written to live config files**:

```rust
pub struct ProviderMeta {
    pub api_format: Option<String>,           // "anthropic" | "openai_chat" | "openai_responses" | "gemini_native"
    pub claude_desktop_mode: Option<ClaudeDesktopMode>,  // Direct | Proxy
    pub claude_desktop_model_routes: HashMap<String, ClaudeDesktopModelRoute>,
    pub provider_type: Option<String>,        // "github_copilot" | "codex_oauth"
    pub is_full_url: Option<bool>,
    pub prompt_cache_key: Option<String>,
    pub custom_endpoints: HashMap<String, CustomEndpoint>,
    pub usage_script: Option<UsageScript>,
    // ... many more fields
}
```

The `api_format` field determines whether format transformation is needed:

- `"anthropic"` (default): Direct passthrough, no transformation
- `"openai_chat"`: Transform Anthropic Messages → OpenAI Chat Completions
- `"openai_responses"`: Transform Anthropic Messages → OpenAI Responses API
- `"gemini_native"`: Transform Anthropic Messages → Google Gemini format

### 4.3 Universal Provider (Cross-App)

cc-switch has a `UniversalProvider` concept that generates per-app Provider configs from a single shared definition:

```rust
pub struct UniversalProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub apps: UniversalProviderApps,     // { claude: bool, codex: bool, gemini: bool }
    pub models: UniversalProviderModels, // Per-app model configs
    // ...
}
```

The `to_claude_provider()` method generates a Provider with all four model mapping env vars populated. The `to_codex_provider()` generates TOML config. This is how a single provider definition (e.g., a NewAPI endpoint) can serve multiple apps with different model names.

### 4.4 Persistence

Providers are stored in SQLite (`~/.cc-switch/config.json` is the DB path):

```sql
CREATE TABLE providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,      -- "claude", "claude-desktop", "codex", "gemini", etc.
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,  -- JSON blob
    website_url TEXT,
    icon TEXT,
    icon_color TEXT,
    category TEXT,
    notes TEXT,
    meta TEXT,                      -- JSON blob (ProviderMeta)
    sort_index INTEGER,
    created_at INTEGER,
    in_failover_queue INTEGER DEFAULT 0,
    PRIMARY KEY (id, app_type)
);
```

The "current provider" for each app is tracked in a separate `current_providers` table.

---

## 5. Environment Variable Injection

**Sources**: `src-tauri/src/config.rs`, `src-tauri/src/services/provider/live.rs`, `src-tauri/src/deeplink/provider.rs`

### 5.1 Claude Code Configuration Path

cc-switch writes to Claude Code's settings file:

```
Windows: %USERPROFILE%\.claude\settings.json
macOS:   ~/.claude/settings.json
Legacy:  ~/.claude/claude.json (fallback)
```

The path is resolved by `get_claude_settings_path()` → `get_claude_config_dir()` + `"settings.json"`.

### 5.2 Live Config Writing

When the user switches providers in cc-switch, `write_live_snapshot()` writes the provider's `settings_config` directly to Claude Code's settings file:

```rust
// Simplified flow:
pub fn write_live_snapshot(app_type, provider) {
    match app_type {
        AppType::Claude => {
            let path = get_claude_settings_path();  // ~/.claude/settings.json
            let settings = sanitize_claude_settings_for_live(&provider.settings_config);
            write_json_file(&path, &settings)?;
        }
        // ...
    }
}
```

The `sanitize_claude_settings_for_live()` function strips internal-only fields (`api_format`, `openrouter_compat_mode`) before writing.

### 5.3 What Gets Written to settings.json

For a Claude provider with model mapping, the written file looks like:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-deepseek-key",
    "ANTHROPIC_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro"
  }
}
```

Claude Code reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` to determine where to send requests. When the user has cc-switch's **proxy mode** enabled, these point to the cc-switch local proxy server instead of the real provider.

### 5.4 Claude Desktop Proxy Mode

For Claude Desktop, cc-switch can operate in **Proxy mode** where:

1. A local HTTP proxy is started on a port (default: 15721)
2. Claude Desktop's profile is configured to point to `http://127.0.0.1:15721/claude-desktop`
3. A gateway token (`ccs-<uuid>`) is generated as the API key
4. Model routes (claude-safe IDs like `claude-sonnet-4-6`) are written to Claude Desktop's `inferenceModels` list
5. When Claude Desktop makes a request, cc-switch's proxy maps the claude-safe route to the real upstream model

The profile is written to:
```
Windows: %LOCALAPPDATA%\Claude-3p\configLibrary\{PROFILE_ID}.json
macOS:   ~/Library/Application Support/Claude-3p/configLibrary/{PROFILE_ID}.json
```

### 5.5 Deeplink Import

Providers can be imported via `ccswitch://` URLs:

```
ccswitch://import/provider?app=claude&name=DeepSeek&endpoint=https://api.deepseek.com/anthropic&apiKey=sk-xxx&model=deepseek-v4-pro&sonnetModel=deepseek-v4-pro&haikuModel=deepseek-v4-flash&enabled=true
```

The deeplink handler (`deeplink/provider.rs`) builds the Provider's `settings_config` from URL parameters, mapping:
- `model` → `ANTHROPIC_MODEL`
- `haikuModel` → `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `sonnetModel` → `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `opusModel` → `ANTHROPIC_DEFAULT_OPUS_MODEL`

---

## 6. Format Transformation

**Source**: `src-tauri/src/proxy/providers/transform.rs`

### 6.1 Anthropic Messages → OpenAI Chat Completions

The `anthropic_to_openai()` function converts an Anthropic Messages API request body to OpenAI Chat Completions format:

| Anthropic Field | OpenAI Equivalent | Notes |
|-----------------|-------------------|-------|
| `model` | `model` (passthrough) | Model mapping happens before transform |
| `system` (string or array) | `messages[0].role="system"` | Array parts are merged; `cache_control` stripped |
| `messages[].content` (blocks) | `messages[].content` (string/array) | Simplified to string when single text block |
| `messages[].content[type="tool_use"]` | `messages[].tool_calls[]` | `input_schema` → `function.arguments` (JSON string) |
| `messages[].content[type="tool_result"]` | Separate `role="tool"` message | `tool_use_id` → `tool_call_id` |
| `messages[].content[type="thinking"]` | Extracted to `reasoning_content` | Only when `preserve_reasoning_content=true` |
| `messages[].content[type="image"]` | `image_url` with data URI | `source.data` → `data:{media_type};base64,{data}` |
| `tools[]` (Anthropic format) | `tools[]` (OpenAI function format) | `input_schema` → `parameters`; BatchTool filtered |
| `tool_choice` | `tool_choice` | `"any"` → `"required"`; `{type:"tool",name:X}` → `{type:"function",function:{name:X}}` |
| `max_tokens` | `max_tokens` or `max_completion_tokens` | o-series models use `max_completion_tokens` |
| `thinking.budget_tokens` | `reasoning_effort` | <4k→"low", 4k-16k→"medium", ≥16k→"high"; "adaptive"→"xhigh" |
| `stop_sequences` | `stop` | Direct rename |
| `stream` | `stream` | Passthrough |

**Special handling**:
- Leading `x-anthropic-billing-header:` lines in system prompts are stripped (prevents cache busting)
- `cache_control` fields are stripped from all messages, tools, and system prompts
- o-series models (o1, o3, o4-mini) use `max_completion_tokens` instead of `max_tokens`
- GPT-5+ models get `reasoning_effort` mapped from Anthropic thinking parameters

### 6.2 OpenAI Chat Completions → Anthropic Messages

The `openai_to_anthropic()` function converts responses back:

| OpenAI Field | Anthropic Equivalent |
|--------------|---------------------|
| `choices[0].message.content` | `content[{type:"text",text:...}]` |
| `choices[0].message.tool_calls[]` | `content[{type:"tool_use",id:...,name:...,input:...}]` |
| `choices[0].message.reasoning_content` | `content[{type:"thinking",thinking:...}]` (prepended) |
| `choices[0].message.refusal` | `content[{type:"text",text:...}]` |
| `choices[0].finish_reason` | `stop_reason` ("stop"→"end_turn", "length"→"max_tokens", "tool_calls"→"tool_use") |
| `usage.prompt_tokens` | `usage.input_tokens` |
| `usage.completion_tokens` | `usage.output_tokens` |
| `usage.prompt_tokens_details.cached_tokens` | `usage.cache_read_input_tokens` |

### 6.3 Streaming SSE Transformation

For streaming requests, cc-switch intercepts the SSE byte stream and transforms events in-flight:

- **OpenAI Chat → Anthropic**: `create_anthropic_sse_stream()` converts OpenAI delta events to Anthropic `content_block_delta` events
- **OpenAI Responses → Anthropic**: Handled via `transform_responses.rs`
- **Gemini → Anthropic**: `create_anthropic_sse_stream_from_gemini()` in `streaming_gemini.rs`

The streaming transform rewrites each SSE event's `data:` payload from the source format to Anthropic's `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, and `message_stop` events.

### 6.4 Reasoning Effort Mapping

When forwarding to OpenAI reasoning models (o-series, GPT-5+), Anthropic's `thinking` parameter is mapped to OpenAI's `reasoning_effort`:

```
Priority 1: output_config.effort (explicit)
  "low"    → "low"
  "medium" → "medium"
  "high"   → "high"
  "max"    → "xhigh"

Priority 2: thinking.type + budget_tokens (fallback)
  "adaptive"           → "xhigh"
  "enabled" < 4000     → "low"
  "enabled" 4000-15999 → "medium"
  "enabled" >= 16000   → "high"
  "enabled" no budget  → "high"
  "disabled"/absent    → None (no reasoning_effort sent)
```

### 6.5 Other Format Transforms

cc-switch also supports:

- **Anthropic → OpenAI Responses API** (`transform_responses.rs`): For Codex/Copilot providers
- **Anthropic → Gemini Native** (`transform_gemini.rs`): For Google Gemini providers
- **Codex Responses → Chat Completions** (`transform_codex_chat.rs`): Special path for Codex→Chat conversion

---

## 7. Claude Desktop Route Mapping

**Source**: `src-tauri/src/claude_desktop_config.rs`

### 7.1 Two Modes

Claude Desktop has two integration modes:

| Mode | How it works | Model names visible to Desktop |
|------|-------------|-------------------------------|
| **Direct** | Point Desktop directly at Anthropic-compatible upstream | Only claude-safe IDs (`claude-sonnet-4-6`, etc.) |
| **Proxy** | Route through cc-switch's local proxy with route mapping | claude-safe IDs that map to any upstream model |

### 7.2 Route Mapping (Proxy Mode)

In proxy mode, `claude_desktop_model_routes` in ProviderMeta defines the mapping:

```json
{
  "meta": {
    "claudeDesktopMode": "proxy",
    "apiFormat": "openai_chat",
    "claudeDesktopModelRoutes": {
      "claude-sonnet-4-6": {
        "model": "deepseek-v4-pro",
        "labelOverride": "DeepSeek V4 Pro",
        "supports1m": true
      },
      "claude-opus-4-8": {
        "model": "deepseek-v4-pro",
        "labelOverride": "DeepSeek V4 Pro",
        "supports1m": true
      },
      "claude-haiku-4-5": {
        "model": "deepseek-v4-flash",
        "labelOverride": "DeepSeek V4 Flash",
        "supports1m": true
      }
    }
  }
}
```

When Claude Desktop requests `claude-sonnet-4-6`, cc-switch maps it to `deepseek-v4-pro`. The `map_proxy_request_model()` function:

1. Strips `[1M]` suffix
2. Looks up exact route_id match
3. Falls back to opus version aliasing (4-7 ↔ 4-8)
4. Falls back to legacy raw route match
5. Falls back to **role keyword** matching (haiku/opus/sonnet) -- handles dated model names like `claude-haiku-4-5-20251001`
6. Errors if no match found (unlike Claude Code's keyword mapper, there is NO default fallback)

### 7.3 Model List Response

The proxy also serves a model list endpoint that returns claude-safe IDs:

```json
{
  "data": [
    { "type": "model", "id": "claude-sonnet-4-6", "supports1m": true },
    { "type": "model", "id": "claude-opus-4-8", "supports1m": true },
    { "type": "model", "id": "claude-haiku-4-5", "supports1m": true }
  ],
  "has_more": false
}
```

### 7.4 Non-Claude Route Auto-Repair

If a route_id doesn't match the `claude-*` pattern (e.g., `"claude-deepseek-v4-pro"`), it's automatically repaired to an available claude-safe slot (e.g., `"claude-opus-4-8"`) with `labelOverride` set to the upstream model name.

---

## 8. AgentHub Integration Plan

### 8.1 Reading cc-switch State

AgentHub Edge needs to detect what models are **actually** in use behind cc-switch. There are three approaches:

#### Option A: Read cc-switch Database Directly

cc-switch stores all provider data in SQLite at `~/.cc-switch/config.json` (despite the `.json` extension, it's actually a SQLite database).

```sql
-- Get current provider for Claude Code
SELECT p.id, p.name, p.settings_config, p.meta
FROM providers p
JOIN current_providers cp ON cp.provider_id = p.id
WHERE cp.app_type = 'claude';

-- Get all providers for Claude Code
SELECT id, name, settings_config, meta
FROM providers
WHERE app_type = 'claude'
ORDER BY sort_index;
```

From `settings_config`, extract:
- `env.ANTHROPIC_BASE_URL` → real upstream endpoint
- `env.ANTHROPIC_MODEL` → what "default" maps to
- `env.ANTHROPIC_DEFAULT_SONNET_MODEL` → what "sonnet" maps to
- etc.

From `meta` (JSON), extract:
- `apiFormat` → whether format transformation is applied
- `claudeDesktopModelRoutes` → Claude Desktop route mapping

#### Option B: Parse Claude Code's settings.json

Read `~/.claude/settings.json` directly. This gives the current active mapping but not the full provider catalog:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro"
  }
}
```

#### Option C: cc-switch API / Tauri Events

If cc-switch exposes a local API or Tauri event system, AgentHub could subscribe to provider change events. This requires cc-switch to be running.

**Recommendation**: Option A (read SQLite) is the most reliable for getting the full picture. Option B is a simpler fallback for detecting the current active mapping.

### 8.2 Data Model for AgentHub

```typescript
interface CCSwitchMapping {
  // The model Claude Code thinks it's using
  apparentModel: string;       // e.g., "claude-sonnet-4-5"

  // The model actually being used
  realModel: string;           // e.g., "deepseek-v4-pro"

  // The provider serving the request
  providerId: string;
  providerName: string;
  providerEndpoint: string;    // e.g., "https://api.deepseek.com/anthropic"

  // Format info
  apiFormat: "anthropic" | "openai_chat" | "openai_responses" | "gemini_native";

  // Whether cc-switch is proxying or direct
  isProxied: boolean;
}

interface CCSwitchState {
  activeProvider: CCSwitchMapping | null;
  allMappings: CCSwitchMapping[];
  failoverProviders: CCSwitchMapping[];
}
```

### 8.3 Implementation Steps for AgentHub Edge

1. **Detect cc-switch installation**: Check for `~/.cc-switch/config.json` (SQLite DB)
2. **Read current provider**: Query `current_providers` + `providers` tables for `app_type='claude'`
3. **Parse model mappings**: Extract `ANTHROPIC_DEFAULT_*_MODEL` env vars from `settings_config`
4. **Build mapping table**: Create `{ apparent → real }` map for all three roles (haiku/sonnet/opus) + default
5. **Surface in UI**: Show real model names with a "via cc-switch" badge in AgentHub's model selector
6. **Watch for changes**: Poll `current_providers` table or use filesystem watcher on the DB file

### 8.4 What AgentHub Should Show

When cc-switch is active, AgentHub's UI should display:

| Field | Value | Source |
|-------|-------|--------|
| Apparent model | `claude-sonnet-4-5` | What Claude Code reports |
| Real model | `deepseek-v4-pro` | From `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| Provider | "DeepSeek" | From `provider.name` |
| API format | `openai_chat` | From `meta.apiFormat` |
| Proxy status | Active | Detection of cc-switch proxy URL |

This gives the user full visibility into what model is **actually** processing their code, not just what Claude Code thinks it's using.

---

## 9. Key File Index

| File | Purpose |
|------|---------|
| `src-tauri/src/proxy/model_mapper.rs` | Model name mapping (keyword-based for Claude Code) |
| `src-tauri/src/proxy/forwarder.rs` | Request forwarding with failover, circuit breaker, rectifiers |
| `src-tauri/src/proxy/providers/transform.rs` | Anthropic ↔ OpenAI Chat Completions format conversion |
| `src-tauri/src/proxy/providers/transform_responses.rs` | Anthropic ↔ OpenAI Responses API conversion |
| `src-tauri/src/proxy/providers/transform_gemini.rs` | Anthropic ↔ Gemini Native conversion |
| `src-tauri/src/proxy/providers/transform_codex_chat.rs` | Codex Responses → Chat Completions conversion |
| `src-tauri/src/provider.rs` | Provider, ProviderMeta, UniversalProvider data models |
| `src-tauri/src/claude_desktop_config.rs` | Claude Desktop 3P config, route mapping, proxy gateway |
| `src-tauri/src/services/provider/live.rs` | Live config writing (settings.json, auth.json, etc.) |
| `src-tauri/src/config.rs` | Config file path resolution (`get_claude_settings_path`) |
| `src-tauri/src/deeplink/provider.rs` | Deeplink import, Provider construction from URL params |
| `src-tauri/src/database/schema.rs` | SQLite schema (providers table, etc.) |
| `src-tauri/src/proxy/providers/claude.rs` | Claude adapter: format detection, transform dispatch |

---

<!-- 合并自 cc-switch-providers-models.md -->

## 10. Provider Preset System

### 10.1 Preset Files by App

| File | App | Config Target |
|------|-----|---------------|
| `src/config/claudeProviderPresets.ts` | Claude Code | `~/.claude/settings.json` (env vars) |
| `src/config/claudeDesktopProviderPresets.ts` | Claude Desktop | `~/.claude/settings.json` + profile routes |
| `src/config/codexProviderPresets.ts` | Codex (OpenAI) | `~/.codex/config.toml` + `~/.codex/auth.json` |
| `src/config/geminiProviderPresets.ts` | Gemini CLI | `~/.gemini/config.yaml` (env vars) |
| `src/config/opencodeProviderPresets.ts` | OpenCode | `~/.opencode/config.json` (AI SDK format) |
| `src/config/openclawProviderPresets.ts` | OpenClaw | `~/.openclaw/openclaw.json` |
| `src/config/hermesProviderPresets.ts` | Hermes | `~/.hermes/config.yaml` |
| `src/config/universalProviderPresets.ts` | Cross-app | Generates per-app providers from shared config |

### 10.2 Provider Categories

```typescript
type ProviderCategory =
  | "official"        // Anthropic, OpenAI, Google
  | "cn_official"     // Chinese domestic providers (Volcengine, Baidu, Zhipu, etc.)
  | "cloud_provider"  // AWS Bedrock
  | "aggregator"      // API gateways (OpenRouter, SiliconFlow, AiHubMix, etc.)
  | "third_party"     // Third-party resellers
  | "custom"          // User-defined
```

### 10.3 Complete Provider Preset Inventory

**Claude Code Presets (40+)**:

| Category | Providers |
|----------|-----------|
| Official | Claude Official |
| CN Official | Volcengine Agentplan, BytePlus, DouBaoSeed, Zhipu GLM (CN/EN), Baidu Qianfan, Bailian (x2), Kimi (x2), StepFun (CN/EN), MiniMax (CN/EN), BaiLing, Xiaomi MiMo (x2) |
| Cloud Provider | AWS Bedrock (AKSK + API Key) |
| Aggregator | Shengsuanyun, AiHubMix, CherryIN, SiliconFlow (CN/EN), DMXAPI, Compshare (x2), ModelScope, OpenRouter, TheRouter, Novita AI, CCSub, AtlasCloud, PIPELLM |
| Third Party | PatewayAI, DeepSeek, OpenCode Go, Longcat, KAT-Coder, PackyCode, APIKEY.FUN, APINebula, SudoCode, ClaudeAPI, ClaudeCN, RunAPI, RelaxyCode, Cubence, AIGoCode, RightCode, AICodeMirror, CrazyRouter, SSSSAiCode, Micu, CTok.ai, E-FlowCode, LemonData, Nvidia, GitHub Copilot, Codex |

**Gemini Native and API Format Support**:

Special presets with non-Anthropic API formats:
- **Gemini Native** (`apiFormat: "gemini_native"`): Full Gemini generateContent protocol
- **GitHub Copilot** (`providerType: "github_copilot"`, `apiFormat: "openai_chat"`): OAuth + format transform
- **Codex** (`providerType: "codex_oauth"`, `apiFormat: "openai_responses"`): ChatGPT Plus/Pro OAuth
- **OpenCode Go** (`apiFormat: "openai_chat"`): OpenAI Chat Completions
- **Nvidia** (`apiFormat: "openai_chat"`): NVIDIA NIM endpoint

---

## 11. MCP Configuration Injection

### 11.1 Multi-App MCP Architecture

CC-Switch manages MCP servers in a **unified structure** with per-app enable flags:

```typescript
interface McpServer {
  id: string;
  name: string;
  server: McpServerSpec;      // { command, args, env } or { url, headers }
  apps: McpApps;               // { claude, codex, gemini, opencode, openclaw, hermes }
  description?: string;
  tags?: string[];
}
```

### 11.2 Per-App MCP Sync

Each app has its own sync module that writes to the app's native config:

| Module | Target File |
|--------|-------------|
| `mcp/claude.rs` | `~/.claude.json` (mcpServers field) |
| `mcp/codex.rs` | `~/.codex/config.toml` (mcp_servers section) |
| `mcp/gemini.rs` | `~/.gemini/config.yaml` (mcpServers section) |
| `mcp/opencode.rs` | `~/.opencode/config.json` (mcpServers section) |
| `mcp/hermes.rs` | `~/.hermes/config.yaml` (mcp_servers section) |

### 11.3 Claude MCP Write Path

```rust
// src-tauri/src/mcp/claude.rs
pub fn sync_enabled_to_claude(config: &MultiAppConfig) -> Result<(), AppError> {
    let enabled = collect_enabled_servers(&config.mcp.claude);
    crate::claude_mcp::set_mcp_servers_map(&enabled)
}
```

The actual write happens in `claude_mcp.rs`:
1. Reads `~/.claude.json`
2. Filters servers with `enabled == true`
3. Strips UI-only fields (`enabled`, `source`, `id`, `name`, `description`, `tags`)
4. On Windows, wraps `npx`/`npm` commands in `cmd /c` (unless WSL path detected)
5. Writes back to `~/.claude.json`

### 11.4 Smart Write Behavior

- **Skip if Claude not installed**: If `~/.claude/` directory doesn't exist and `~/.claude.json` doesn't exist, MCP sync is silently skipped
- **Directory override support**: If user overrides Claude config dir, MCP path is derived from the override's parent
- **Atomic writes**: All config writes use temp file + rename for crash safety

---

## 12. Session State Machine

### 12.1 Session Scanning

Sessions are **read-only scans** of each app's native session storage. CC-Switch does not create or manage CLI processes.

```rust
// src-tauri/src/session_manager/mod.rs
pub fn scan_sessions() -> Vec<SessionMeta> {
    // Parallel scan across all providers
    let (r1, r2, r3, r4, r5, r6) = std::thread::scope(|s| {
        let h1 = s.spawn(codex::scan_sessions);
        let h2 = s.spawn(claude::scan_sessions);
        let h3 = s.spawn(opencode::scan_sessions);
        let h4 = s.spawn(openclaw::scan_sessions);
        let h5 = s.spawn(gemini::scan_sessions);
        let h6 = s.spawn(hermes::scan_sessions);
        // ...
    });
}
```

### 12.2 Session Storage Locations

| Provider | Session Root | Format |
|----------|-------------|--------|
| Claude | `~/.claude/projects/` | JSONL (one JSON object per line) |
| Codex | `~/.codex/sessions/` (multiple roots) | JSONL |
| OpenCode | `~/.opencode/` | SQLite (`sqlite:` prefix) or JSONL |
| OpenClaw | `~/.openclaw/agents/` | JSONL |
| Gemini | `~/.gemini/tmp/` | JSONL |
| Hermes | `~/.hermes/sessions/` | SQLite or JSONL |

### 12.3 Session Metadata

```rust
pub struct SessionMeta {
    pub provider_id: String,       // "claude" | "codex" | "gemini" | ...
    pub session_id: String,
    pub title: Option<String>,     // Custom title > first user message > dir basename
    pub summary: Option<String>,   // Last non-empty assistant message
    pub project_dir: Option<String>,
    pub created_at: Option<i64>,
    pub last_active_at: Option<i64>,
    pub source_path: Option<String>,
    pub resume_command: Option<String>,  // e.g., "claude --resume {session_id}"
}
```

### 12.4 Claude Session Parsing

Claude sessions are JSONL files in `~/.claude/projects/<path-hash>/`:
- `sessionId` extracted from first line
- `cwd` extracted as project directory
- Title priority: `custom-title` entry > first user message (excluding command caveats) > directory basename
- Agent sessions (prefixed `agent-`) are excluded from listing
- Tool results inside user messages are reclassified as "tool" role

### 12.5 Session Deletion

Deletion validates that the source path is within the provider's allowed root(s) before removing:
- The main `.jsonl` file
- The sidecar directory (same name without extension), which contains subagents and tool results

---

## 13. Settings / Runtime Config

### 13.1 Settings Storage

- **Database** (`~/.cc-switch/cc-switch.db`): Providers, MCP servers, failover config, prompts, usage data
- **Device-local** (`~/.cc-switch/settings.json`): UI preferences, current provider per app, directory overrides, sync settings

### 13.2 Current Provider Resolution

```rust
// src-tauri/src/settings.rs
pub fn get_effective_current_provider(db: &Database, app_type: &AppType) -> Option<String> {
    // 1. Read from local settings.json (device-level)
    // 2. Validate ID exists in database
    // 3. If invalid, clean up local settings and fallback to database is_current
}
```

This allows multi-device sync where each device can have a different active provider.

### 13.3 Directory Override System

Each app's config directory can be overridden via settings:

```rust
claude_config_dir: Option<String>,    // Overrides ~/.claude
codex_config_dir: Option<String>,     // Overrides ~/.codex
gemini_config_dir: Option<String>,    // Overrides ~/.gemini
opencode_config_dir: Option<String>,  // Overrides ~/.opencode
openclaw_config_dir: Option<String>,  // Overrides ~/.openclaw
hermes_config_dir: Option<String>,    // Overrides ~/.hermes
```

Supports `~` expansion and relative paths.

---

## 14. Universal Provider (Cross-App)

### 14.1 Concept

Universal providers (e.g., NewAPI) share a single base URL and API key across multiple apps, with per-app model configuration:

```typescript
interface UniversalProvider {
    id: string;
    providerType: string;     // "newapi" | "custom_gateway"
    apps: { claude, codex, gemini };  // Which apps to enable
    baseUrl: string;          // Shared API endpoint
    apiKey: string;           // Shared API key
    models: {
        claude?: { model, haikuModel, sonnetModel, opusModel },
        codex?:  { model, reasoningEffort },
        gemini?: { model },
    };
}
```

### 14.2 Per-App Generation

When a universal provider is saved, it generates separate per-app `Provider` instances:
- `to_claude_provider()`: Writes env vars to Claude settings
- `to_codex_provider()`: Generates TOML config + auth.json for Codex
- `to_gemini_provider()`: Writes Gemini env vars

---

## 15. Source File Reference (Extended)

### Backend (Rust)
- `src-tauri/src/provider.rs` - Provider, ProviderMeta, UniversalProvider structs
- `src-tauri/src/settings.rs` - AppSettings, current provider, directory overrides
- `src-tauri/src/config.rs` - Path resolution, JSON file I/O
- `src-tauri/src/proxy/model_mapper.rs` - Model alias mapping logic
- `src-tauri/src/proxy/providers/mod.rs` - ProviderType enum, adapter dispatch
- `src-tauri/src/proxy/providers/claude.rs` - Claude adapter, API format detection
- `src-tauri/src/proxy/providers/transform.rs` - Format conversion (Anthropic <-> OpenAI)
- `src-tauri/src/mcp/claude.rs` - MCP sync to ~/.claude.json
- `src-tauri/src/claude_mcp.rs` - Low-level ~/.claude.json read/write
- `src-tauri/src/session_manager/mod.rs` - Session scanning/dispatch
- `src-tauri/src/session_manager/providers/claude.rs` - Claude session parsing
- `src-tauri/src/commands/provider.rs` - Tauri commands for provider CRUD
- `src-tauri/src/services/config.rs` - Live config writing to app native paths

### Frontend (TypeScript/React)
- `src/config/claudeProviderPresets.ts` - 40+ Claude Code provider presets
- `src/config/claudeDesktopProviderPresets.ts` - Claude Desktop presets with route mapping
- `src/config/codexProviderPresets.ts` - Codex presets with TOML templates
- `src/config/geminiProviderPresets.ts` - Gemini CLI presets
- `src/config/universalProviderPresets.ts` - Cross-app universal provider presets
- `src/types.ts` - Full type definitions
- `src/components/providers/forms/ProviderPresetSelector.tsx` - Preset picker UI
- `src/components/providers/forms/ProviderForm.tsx` - Provider creation/edit form
- `src/components/providers/forms/ClaudeFormFields.tsx` - Claude-specific fields
- `src/components/providers/forms/CodexFormFields.tsx` - Codex-specific fields
