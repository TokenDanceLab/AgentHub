# CC-Switch Provider Preset System, Model Alias Mapping, and CLI Integration

> Source: `D:\Code\Projects\archive\cc-switch`
> Generated: 2026-06-10

---

## 1. Architecture Overview

CC-Switch is a Tauri (Rust backend + React frontend) desktop application that manages provider configurations for multiple AI coding tools: **Claude Code**, **Claude Desktop**, **Codex (OpenAI)**, **Gemini CLI**, **OpenCode**, **OpenClaw**, and **Hermes**. It acts as a configuration switcher, proxy, and session manager.

```
Frontend (React/TS)          Backend (Rust/Tauri)
src/config/*Presets.ts   ->  src-tauri/src/provider.rs          (Provider struct)
src/components/providers/ -> src-tauri/src/commands/provider.rs  (Tauri commands)
src/lib/api/providers.ts  -> src-tauri/src/services/provider/    (Business logic)
                               src-tauri/src/proxy/              (Local proxy server)
                               src-tauri/src/mcp/                (MCP config sync)
                               src-tauri/src/session_manager/    (Session scanning)
```

Data is persisted in:
- **SQLite database**: `~/.cc-switch/cc-switch.db` (providers, MCP, failover, settings)
- **Device-local settings**: `~/.cc-switch/settings.json` (UI prefs, current provider per app)
- **Live config files**: Written to each tool's native config path when a provider is activated

---

## 2. Provider Preset System

### 2.1 Preset Files by App

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

### 2.2 Provider Struct (Rust)

```rust
// src-tauri/src/provider.rs
pub struct Provider {
    pub id: String,
    pub name: String,
    pub settings_config: Value,        // App-specific config (env vars, TOML, etc.)
    pub website_url: Option<String>,
    pub category: Option<String>,
    pub created_at: Option<i64>,
    pub sort_index: Option<usize>,
    pub notes: Option<String>,
    pub meta: Option<ProviderMeta>,     // Non-live metadata (endpoints, API format, auth)
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub in_failover_queue: bool,
}
```

### 2.3 ProviderMeta (Key Configuration Fields)

```rust
// src-tauri/src/provider.rs -> ProviderMeta
pub struct ProviderMeta {
    pub custom_endpoints: HashMap<String, CustomEndpoint>,
    pub common_config_enabled: Option<bool>,
    pub claude_desktop_mode: Option<ClaudeDesktopMode>,     // "direct" | "proxy"
    pub claude_desktop_model_routes: HashMap<String, ClaudeDesktopModelRoute>,
    pub usage_script: Option<UsageScript>,
    pub api_format: Option<String>,                         // "anthropic"|"openai_chat"|"openai_responses"|"gemini_native"
    pub auth_binding: Option<AuthBinding>,
    pub api_key_field: Option<String>,                      // "ANTHROPIC_AUTH_TOKEN"|"ANTHROPIC_API_KEY"
    pub is_full_url: Option<bool>,
    pub provider_type: Option<String>,                      // "github_copilot"|"codex_oauth"
    pub codex_chat_reasoning: Option<CodexChatReasoningConfig>,
    pub codex_fast_mode: Option<bool>,
    // ... more fields
}
```

### 2.4 Provider Categories

```typescript
type ProviderCategory =
  | "official"        // Anthropic, OpenAI, Google
  | "cn_official"     // Chinese domestic providers (Volcengine, Baidu, Zhipu, etc.)
  | "cloud_provider"  // AWS Bedrock
  | "aggregator"      // API gateways (OpenRouter, SiliconFlow, AiHubMix, etc.)
  | "third_party"     // Third-party resellers
  | "custom"          // User-defined
```

---

## 3. Model Alias Mapping

### 3.1 Role-Based Model Mapping

CC-Switch uses a **role-based model mapping** system. When a provider is activated for Claude Code, the following environment variables control model substitution at the proxy layer:

| Env Var | Role | Example Value |
|---------|------|---------------|
| `ANTHROPIC_MODEL` | Default/fallback model | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Maps any `*haiku*` request | `deepseek-v4-flash` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Maps any `*sonnet*` request | `deepseek-v4-pro` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Maps any `*opus*` request | `deepseek-v4-pro` |

The mapping is implemented in `src-tauri/src/proxy/model_mapper.rs`:

```rust
pub fn map_model(&self, original_model: &str) -> String {
    let model_lower = original_model.to_lowercase();
    if model_lower.contains("haiku") { return self.haiku_model.clone(); }
    if model_lower.contains("opus")  { return self.opus_model.clone(); }
    if model_lower.contains("sonnet"){ return self.sonnet_model.clone(); }
    if let Some(ref m) = self.default_model { return m.clone(); }
    original_model.to_string()
}
```

**Key behavior**: Matching is **case-insensitive substring matching**. Any model name containing "sonnet" (e.g., `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`) will be mapped to the configured sonnet model.

### 3.2 `[1M]` Suffix Stripping

Claude Code appends `[1M]` to model names to signal 1M context capability. This is stripped before forwarding to upstream:

```rust
// src-tauri/src/proxy/model_mapper.rs
pub fn strip_one_m_suffix_for_upstream(model: &str) -> &str { ... }
```

### 3.3 Preset Model Examples

| Provider | Default | Haiku | Sonnet | Opus |
|----------|---------|-------|--------|------|
| Claude Official | (passthrough) | (passthrough) | (passthrough) | (passthrough) |
| DeepSeek | `deepseek-v4-pro` | `deepseek-v4-flash` | `deepseek-v4-pro` | `deepseek-v4-pro` |
| Xiaomi MiMo | `mimo-v2.5-pro` | `mimo-v2.5-pro` | `mimo-v2.5-pro` | `mimo-v2.5-pro` |
| Volcengine | `ark-code-latest` | `ark-code-latest` | `ark-code-latest` | `ark-code-latest` |
| Zhipu GLM | `glm-5.1` | `glm-5.1` | `glm-5.1` | `glm-5.1` |
| OpenRouter | `anthropic/claude-sonnet-4.6` | `anthropic/claude-haiku-4.5` | `anthropic/claude-sonnet-4.6` | `anthropic/claude-opus-4.8` |
| Gemini Native | `gemini-3.5-flash` | `gemini-3.5-flash` | `gemini-3.5-flash` | `gemini-3.5-flash` |
| Kimi | `kimi-k2.6` | `kimi-k2.6` | `kimi-k2.6` | `kimi-k2.6` |
| AWS Bedrock | `global.anthropic.claude-opus-4-8` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | `global.anthropic.claude-sonnet-4-6` | `global.anthropic.claude-opus-4-8` |

### 3.4 Claude Desktop Route-Based Mapping

Claude Desktop has a stricter model routing system using `CLAUDE_DESKTOP_ROLE_ROUTE_IDS`:

```typescript
// src/config/claudeDesktopProviderPresets.ts
export const CLAUDE_DESKTOP_ROLE_ROUTE_IDS = {
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-8",
  haiku:  "claude-haiku-4-5",
} as const;
```

Three mapping strategies:
- **`passthroughRoutes()`**: route ID = upstream model (for Anthropic-compatible providers)
- **`mappedRoutes()`**: route ID is Claude-safe, upstream model is provider-specific (e.g., `anthropic/claude-sonnet-4.6`)
- **`brandedRoutes()`**: route ID is Claude-safe, upstream model is non-Claude (e.g., `mimo-v2.5-pro`), with `labelOverride` for UI display

---

## 4. API Format System

### 4.1 Claude Code API Formats

| Format | Description | Transform Direction |
|--------|-------------|---------------------|
| `anthropic` | Native Anthropic Messages API | Passthrough |
| `openai_chat` | OpenAI Chat Completions | Claude -> OpenAI |
| `openai_responses` | OpenAI Responses API | Claude -> Responses |
| `gemini_native` | Gemini generateContent API | Claude -> Gemini |

### 4.2 Provider Type Detection

```rust
// src-tauri/src/proxy/providers/mod.rs
pub enum ProviderType {
    Claude,         // Native Anthropic (x-api-key + anthropic-version)
    ClaudeAuth,     // Bearer-only proxy (no x-api-key)
    Codex,          // OpenAI Responses API
    Gemini,         // Google API Key auth
    GeminiCli,      // Google OAuth Bearer
    OpenRouter,     // OpenRouter (passthrough by default)
    GitHubCopilot,  // OAuth + Copilot token (Anthropic <-> OpenAI transform)
    CodexOAuth,     // ChatGPT Plus/Pro OAuth (Anthropic <-> Responses transform)
}
```

Detection logic in `ProviderType::from_app_type_and_config()`:
1. Check `meta.provider_type` for `"github_copilot"` or `"codex_oauth"`
2. Check `ANTHROPIC_BASE_URL` for known domains (githubcopilot.com, openrouter.ai)
3. Check `auth_mode` settings
4. Default to `Claude`

### 4.3 Codex Chat Reasoning Config

For Codex providers using Chat Completions (non-native Responses), reasoning capability is declared per-provider:

```typescript
interface CodexChatReasoning {
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  thinkingParam?: "none" | "thinking" | "enable_thinking" | "reasoning_split";
  effortParam?: "none" | "reasoning_effort" | "reasoning.effort";
  effortValueMode?: "passthrough" | "low_high" | "deepseek" | "openrouter";
  outputFormat?: "auto" | "reasoning_content" | "reasoning" | "reasoning_details" | "think_tags";
}
```

Example per-provider:
- **DeepSeek**: `thinkingParam: "thinking"`, `effortParam: "reasoning_effort"`, `effortValueMode: "deepseek"`
- **MiniMax**: `thinkingParam: "reasoning_split"`, `outputFormat: "reasoning_details"`
- **Zhipu GLM**: `thinkingParam: "thinking"`, `effortParam: "none"`

---

## 5. Claude Code CLI Integration

### 5.1 How CC-Switch Activates a Provider

CC-Switch does **not** invoke Claude Code directly. Instead, it writes environment variables to `~/.claude/settings.json` (the Claude Code "live config"):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro",
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "API_TIMEOUT_MS": "3000000"
  },
  "permissions": { ... },
  "enabledPlugins": { ... }
}
```

The Claude Code CLI reads this file on startup and uses the env vars to configure API endpoints and model names.

### 5.2 Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_BASE_URL` | API endpoint URL |
| `ANTHROPIC_AUTH_TOKEN` | API key (Bearer token) |
| `ANTHROPIC_API_KEY` | Alternative API key field (some providers) |
| `ANTHROPIC_MODEL` | Default model name |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku role mapping |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet role mapping |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus role mapping |
| `CLAUDE_CODE_USE_BEDROCK` | Enable AWS Bedrock mode |
| `API_TIMEOUT_MS` | Request timeout |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable telemetry |
| `ENABLE_TOOL_SEARCH` | Enable tool search feature |

### 5.3 Settings Config Structure per App

**Claude/Claude Desktop**: `settingsConfig.env` contains env var key-value pairs.

**Codex**: `settingsConfig.auth` contains `OPENAI_API_KEY`, `settingsConfig.config` contains TOML string.

**Gemini**: `settingsConfig.env` contains `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

**OpenCode**: `settingsConfig` directly contains `npm`, `options`, `models` (AI SDK format).

### 5.4 Template Values (Dynamic Substitution)

Some presets use template variables with `${VAR_NAME}` syntax in URLs, resolved at provider creation:

```typescript
templateValues: {
  ENDPOINT_ID: {
    label: "Vanchin Endpoint ID",
    placeholder: "ep-xxx-xxx",
    editorValue: "",
  },
}
// Results in: ANTHROPIC_BASE_URL = "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy"
```

---

## 6. MCP Configuration Injection

### 6.1 Multi-App MCP Architecture

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

### 6.2 Per-App MCP Sync

Each app has its own sync module that writes to the app's native config:

| Module | Target File |
|--------|-------------|
| `mcp/claude.rs` | `~/.claude.json` (mcpServers field) |
| `mcp/codex.rs` | `~/.codex/config.toml` (mcp_servers section) |
| `mcp/gemini.rs` | `~/.gemini/config.yaml` (mcpServers section) |
| `mcp/opencode.rs` | `~/.opencode/config.json` (mcpServers section) |
| `mcp/hermes.rs` | `~/.hermes/config.yaml` (mcp_servers section) |

### 6.3 Claude MCP Write Path

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

### 6.4 Smart Write Behavior

- **Skip if Claude not installed**: If `~/.claude/` directory doesn't exist and `~/.claude.json` doesn't exist, MCP sync is silently skipped
- **Directory override support**: If user overrides Claude config dir, MCP path is derived from the override's parent
- **Atomic writes**: All config writes use temp file + rename for crash safety

---

## 7. Session State Machine

### 7.1 Session Scanning

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

### 7.2 Session Storage Locations

| Provider | Session Root | Format |
|----------|-------------|--------|
| Claude | `~/.claude/projects/` | JSONL (one JSON object per line) |
| Codex | `~/.codex/sessions/` (multiple roots) | JSONL |
| OpenCode | `~/.opencode/` | SQLite (`sqlite:` prefix) or JSONL |
| OpenClaw | `~/.openclaw/agents/` | JSONL |
| Gemini | `~/.gemini/tmp/` | JSONL |
| Hermes | `~/.hermes/sessions/` | SQLite or JSONL |

### 7.3 Session Metadata

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

### 7.4 Claude Session Parsing

Claude sessions are JSONL files in `~/.claude/projects/<path-hash>/`:
- `sessionId` extracted from first line
- `cwd` extracted as project directory
- Title priority: `custom-title` entry > first user message (excluding command caveats) > directory basename
- Agent sessions (prefixed `agent-`) are excluded from listing
- Tool results inside user messages are reclassified as "tool" role

### 7.5 Session Deletion

Deletion validates that the source path is within the provider's allowed root(s) before removing:
- The main `.jsonl` file
- The sidecar directory (same name without extension), which contains subagents and tool results

---

## 8. Settings / Runtime Config

### 8.1 Settings Storage

- **Database** (`~/.cc-switch/cc-switch.db`): Providers, MCP servers, failover config, prompts, usage data
- **Device-local** (`~/.cc-switch/settings.json`): UI preferences, current provider per app, directory overrides, sync settings

### 8.2 Current Provider Resolution

```rust
// src-tauri/src/settings.rs
pub fn get_effective_current_provider(db: &Database, app_type: &AppType) -> Option<String> {
    // 1. Read from local settings.json (device-level)
    // 2. Validate ID exists in database
    // 3. If invalid, clean up local settings and fallback to database is_current
}
```

This allows multi-device sync where each device can have a different active provider.

### 8.3 Directory Override System

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

## 9. Universal Provider (Cross-App)

### 9.1 Concept

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

### 9.2 Per-App Generation

When a universal provider is saved, it generates separate per-app `Provider` instances:
- `to_claude_provider()`: Writes env vars to Claude settings
- `to_codex_provider()`: Generates TOML config + auth.json for Codex
- `to_gemini_provider()`: Writes Gemini env vars

---

## 10. Complete Provider Preset Inventory

### 10.1 Claude Code Presets (40+)

| Category | Providers |
|----------|-----------|
| Official | Claude Official |
| CN Official | Volcengine Agentplan, BytePlus, DouBaoSeed, Zhipu GLM (CN/EN), Baidu Qianfan, Bailian (x2), Kimi (x2), StepFun (CN/EN), MiniMax (CN/EN), BaiLing, Xiaomi MiMo (x2) |
| Cloud Provider | AWS Bedrock (AKSK + API Key) |
| Aggregator | Shengsuanyun, AiHubMix, CherryIN, SiliconFlow (CN/EN), DMXAPI, Compshare (x2), ModelScope, OpenRouter, TheRouter, Novita AI, CCSub, AtlasCloud, PIPELLM |
| Third Party | PatewayAI, DeepSeek, OpenCode Go, Longcat, KAT-Coder, PackyCode, APIKEY.FUN, APINebula, SudoCode, ClaudeAPI, ClaudeCN, RunAPI, RelaxyCode, Cubence, AIGoCode, RightCode, AICodeMirror, CrazyRouter, SSSSAiCode, Micu, CTok.ai, E-FlowCode, LemonData, Nvidia, GitHub Copilot, Codex |

### 10.2 Gemini Native and API Format Support

Special presets with non-Anthropic API formats:
- **Gemini Native** (`apiFormat: "gemini_native"`): Full Gemini generateContent protocol
- **GitHub Copilot** (`providerType: "github_copilot"`, `apiFormat: "openai_chat"`): OAuth + format transform
- **Codex** (`providerType: "codex_oauth"`, `apiFormat: "openai_responses"`): ChatGPT Plus/Pro OAuth
- **OpenCode Go** (`apiFormat: "openai_chat"`): OpenAI Chat Completions
- **Nvidia** (`apiFormat: "openai_chat"`): NVIDIA NIM endpoint

---

## 11. Key Source Files Reference

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
