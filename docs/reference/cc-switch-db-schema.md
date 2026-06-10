# cc-switch Database Schema Reference

> Extracted 2026-06-10 from `C:\Users\Ding\.cc-switch\cc-switch.db`

## 1. Table Overview

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `providers` | Provider definitions per app_type | `id`, `app_type`, `name`, `settings_config` (JSON), `is_current`, `in_failover_queue`, `cost_multiplier` |
| `provider_endpoints` | URL endpoints for providers | `provider_id`, `app_type`, `url` |
| `provider_health` | Circuit-breaker health state | `provider_id`, `app_type`, `is_healthy`, `consecutive_failures` |
| `proxy_config` | Proxy server config per app | `app_type`, `proxy_enabled`, `listen_port`, `auto_failover_enabled`, circuit breaker params |
| `proxy_live_backup` | Pre-takeover settings snapshot | `app_type`, `original_config` (JSON), `backed_up_at` |
| `proxy_request_logs` | Per-request audit log | `request_id`, `provider_id`, `model`, `input_tokens`, `output_tokens`, `status_code`, `total_cost_usd` |
| `model_pricing` | Cost per million tokens | `model_id`, `input_cost_per_million`, `output_cost_per_million`, `cache_*` |
| `settings` | Global key-value config | `key`, `value` (JSON/TOML) |
| `mcp_servers` | MCP server definitions | `id`, `name`, `server_config` (JSON), `enabled_claude/codex/gemini/opencode/hermes` |
| `skills` | Installed skills | `id`, `name`, `directory`, `enabled_*` |
| `skill_repos` | Skill source repositories | `owner`, `name`, `branch`, `enabled` |
| `prompts` | Saved prompt presets | `id`, `app_type`, `name`, `content` |
| `stream_check_logs` | Provider health probe history | `provider_id`, `status`, `response_time_ms`, `model_used` |
| `usage_daily_rollups` | Aggregated daily usage | `date`, `app_type`, `provider_id`, `model`, `request_count`, `total_cost_usd` |
| `session_log_sync` | Codex session log sync state | `file_path`, `last_line_offset` |

## 2. Full Schema Definitions

### providers
```sql
CREATE TABLE providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,          -- 'claude' | 'claude-desktop' | 'codex' | 'gemini' | 'hermes' | 'opencode'
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,   -- JSON: model mapping + env vars + settings
    website_url TEXT,
    category TEXT,                   -- 'aggregator' | 'official' | NULL
    created_at INTEGER,
    sort_index INTEGER,             -- failover priority order
    notes TEXT,
    icon TEXT,
    icon_color TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    is_current BOOLEAN NOT NULL DEFAULT 0,      -- currently active provider
    in_failover_queue BOOLEAN NOT NULL DEFAULT 0, -- eligible for auto-failover
    cost_multiplier TEXT NOT NULL DEFAULT '1.0',
    limit_daily_usd TEXT,
    limit_monthly_usd TEXT,
    provider_type TEXT,              -- 'metapi' | 'official' | NULL
    PRIMARY KEY (id, app_type)
);
```

### proxy_config
```sql
CREATE TABLE proxy_config (
    app_type TEXT PRIMARY KEY CHECK (app_type IN ('claude','codex','gemini')),
    proxy_enabled INTEGER NOT NULL DEFAULT 0,
    listen_address TEXT NOT NULL DEFAULT '127.0.0.1',
    listen_port INTEGER NOT NULL DEFAULT 15721,
    enable_logging INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 0,
    auto_failover_enabled INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60,
    streaming_idle_timeout INTEGER NOT NULL DEFAULT 120,
    non_streaming_timeout INTEGER NOT NULL DEFAULT 600,
    circuit_failure_threshold INTEGER NOT NULL DEFAULT 4,
    circuit_success_threshold INTEGER NOT NULL DEFAULT 2,
    circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60,
    circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6,
    circuit_min_requests INTEGER NOT NULL DEFAULT 10,
    default_cost_multiplier TEXT NOT NULL DEFAULT '1',
    pricing_model_source TEXT NOT NULL DEFAULT 'response',
    live_takeover_active INTEGER NOT NULL DEFAULT 0
);
```

### settings
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

### mcp_servers
```sql
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_config TEXT NOT NULL,     -- JSON: {type, command, args, env}
    description TEXT,
    homepage TEXT,
    docs TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    enabled_claude BOOLEAN NOT NULL DEFAULT 0,
    enabled_codex BOOLEAN NOT NULL DEFAULT 0,
    enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
    enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
    enabled_hermes BOOLEAN NOT NULL DEFAULT 0
);
```

### model_pricing
```sql
CREATE TABLE model_pricing (
    model_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    input_cost_per_million TEXT NOT NULL,
    output_cost_per_million TEXT NOT NULL,
    cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
);
```

### proxy_request_logs
```sql
CREATE TABLE proxy_request_logs (
    request_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    model TEXT NOT NULL,             -- actual model used (after mapping)
    request_model TEXT,              -- model originally requested
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost_usd TEXT NOT NULL DEFAULT '0',
    output_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
    total_cost_usd TEXT NOT NULL DEFAULT '0',
    latency_ms INTEGER NOT NULL,
    first_token_ms INTEGER,
    duration_ms INTEGER,
    status_code INTEGER NOT NULL,
    error_message TEXT,
    session_id TEXT,
    provider_type TEXT,
    is_streaming INTEGER NOT NULL DEFAULT 0,
    cost_multiplier TEXT NOT NULL DEFAULT '1.0',
    created_at INTEGER NOT NULL,
    data_source TEXT NOT NULL DEFAULT 'proxy'
);
```

## 3. Provider Data (Claude App)

### Current Active Provider
- **Name**: NewAPI / DeepSeek / GLM
- **Provider ID**: `e7e2dd52-4689-49aa-817f-d861a9422847`
- **Model Mapping**:
  - Opus -> `deepseek-v4-pro[1M]`
  - Sonnet -> `glm-5.1`
  - Haiku -> `deepseek-v4-flash`
  - Reasoning -> `deepseek-v4-pro`
  - Subagent -> `deepseek-v4-pro`

### All Claude Providers Summary

| # | Name | Opus Model | Sonnet Model | Haiku Model | is_current | Healthy |
|---|------|-----------|-------------|------------|------------|---------|
| 0 | NewAPI / Qwen3.7 / GLM | qwen3.7-max[1M] | qwen3.7-plus[1M] | glm-5.1 | No | Yes |
| 1 | NewAPI / DeepSeek / Mimo / GLM | glm-5.1 | deepseek-v4-pro[1M] | mimo-v2.5 | No | Yes |
| 2 | NewAPI /GLM | glm-5.1 | glm-5.1 | glm-5.1 | No | Yes |
| 3 | NewAPI / DeepSeek / Qwen / GLM | deepseek-v4-pro[1M] | qwen3.7-max[1M] | glm-5.1 | No | - |
| 4 | **NewAPI / DeepSeek / GLM** | **deepseek-v4-pro[1M]** | **glm-5.1** | **deepseek-v4-flash** | **Yes** | **Yes** |
| 5 | NewAPI / DeepSeek Pro / Flash / GLM | deepseek-v4-pro[1M] | deepseek-v4-flash[1M] | deepseek-v4-flash | No | Yes |
| 6 | NewAPI / DeepSeek | deepseek-v4-pro[1M] | deepseek-v4-flash[1M] | glm-5.1 | No | - |
| 7 | NewAPI / Opus 4.8 | claude-opus-4-8[1M] | deepseek-v4-pro[1M] | deepseek-v4-pro | No | - |
| 8 | NewAPI Test (us1) | deepseek-v4-pro[1M] | kimi-k2.6[1M] | glm-5.1 | No | - |
| 9 | NewAPI / Opus 4.7 | claude-opus-4-8[1M] | deepseek-v4-pro[1M] | deepseek-v4-pro | No | - |
| 10 | Anyrouter / Opus 4.8 | claude-opus-4-8[1M] | claude-opus-4-8[1M] | claude-haiku-4-5 | No | Yes |
| 11 | Anyrouter / Opus 4.7 copy | claude-opus-4-8[1M] | claude-opus-4-8[1M] | claude-haiku-4-5 | No | - |
| 12 | DeepSeek Official | deepseek-v4-pro[1M] | deepseek-v4-flash[1M] | deepseek-v4-flash | No | Yes |
| 13-21 | DeepSeek Official 1-40 | deepseek-v4-pro[1M] | deepseek-v4-flash[1M] | deepseek-v4-flash | No | Mixed (some unhealthy) |

### Endpoint URLs by Category
- **NewAPI aggregators**: `https://api.vectorcontrol.tech/v1`
- **DeepSeek Official**: `https://api.deepseek.com/anthropic`
- **Anyrouter**: `https://a-ocnfniawgw.cn-shanghai.fcapp.run`
- **DashScope (Aliyun)**: `https://coding.dashscope.aliyuncs.com/apps/anthropic`
- **TokenDanceGateway**: `https://www.vectorcontrol.tech/v1`

## 4. Model Mapping Rules

### settings_config JSON Structure (Claude)
```json
{
  "model": "opus[1m]",                          // Requested model tier + context window
  "effortLevel": "max",                          // Reasoning effort
  "effort": "max",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-REDACTED",
    "ANTHROPIC_BASE_URL": "https://api.vectorcontrol.tech/v1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1M]",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "glm-5.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "deepseek-v4-flash",
    "ANTHROPIC_REASONING_MODEL": "deepseek-v4-pro",
    "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-pro",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "500000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_MODEL": "glm-5.1"
  }
}
```

### Key Environment Variables
| Variable | Purpose | Example Value |
|----------|---------|---------------|
| `ANTHROPIC_AUTH_TOKEN` | API key | `sk-REDACTED` |
| `ANTHROPIC_BASE_URL` | API endpoint | `https://api.vectorcontrol.tech/v1` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus-tier mapping | `deepseek-v4-pro[1M]` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet-tier mapping | `glm-5.1` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku-tier mapping | `deepseek-v4-flash` |
| `ANTHROPIC_DEFAULT_*_MODEL_NAME` | Display name for status line | `deepseek-v4-pro` |
| `ANTHROPIC_REASONING_MODEL` | Reasoning model override | `deepseek-v4-pro` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Subagent model | `deepseek-v4-pro` |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Auto-compact threshold (tokens) | `500000` |
| `ANTHROPIC_MODEL` | Fallback default model | `glm-5.1` |

### Context Window Suffixes
- `[1M]` = 1 million token context window
- `[1m]` = same, lowercase variant
- No suffix = default context window

### settings_config JSON Structure (Codex)
```json
{
  "auth": {
    "OPENAI_API_KEY": "sk-REDACTED"
  },
  "config": "model_provider = \"custom\"\nmodel = \"deepseek-v4-pro\"\n..." // TOML string
}
```

## 5. Proxy Configuration

### Current State
| app_type | proxy_enabled | listen | auto_failover | enabled | live_takeover |
|----------|--------------|--------|---------------|---------|---------------|
| claude | 1 | 127.0.0.1:15721 | 1 | 1 | 0 |
| codex | 1 | 127.0.0.1:15721 | 0 | 0 | 0 |
| gemini | 1 | 127.0.0.1:15721 | 0 | 0 | 0 |

### Circuit Breaker (Claude)
- Failure threshold: 8 consecutive failures
- Success threshold: 3 consecutive successes
- Timeout: 90 seconds
- Error rate threshold: 0.7 (70%)
- Min requests: 15
- Max retries: 6
- Streaming first-byte timeout: 90s
- Streaming idle timeout: 180s
- Non-streaming timeout: 600s

## 6. MCP Server Configuration

### Installed MCP Servers
| ID | Name | Type | Enabled For | Command |
|----|------|------|-------------|---------|
| codex-browser | codex-browser | stdio | Claude only | `D:\Code\Projects\codex-browser-bridge\bin\codex-browser-bridge.exe -mode mcp` |

## 7. Skills

### Installed Skills
- **Empty** - no skills installed in the skills table currently

### Configured Skill Repos
| Owner | Repo | Branch |
|-------|------|--------|
| anthropics | skills | main |
| ComposioHQ | awesome-claude-skills | master |
| cexll | myclaude | master |
| JimLiu | baoyu-skills | main |

## 8. Global Settings

| Key | Value (summary) |
|-----|-----------------|
| `common_config_claude` | JSON: env vars, theme=dark, bypassPermissions, custom statusLine command, no auto-updates |
| `common_config_codex` | TOML: danger-full-access, pragmatic personality, max 40 agent threads, one-half-dark theme |
| `common_config_opencode` | JSON: minimal schema config |
| `stream_check_config` | JSON: 45s timeout, 2 retries, degraded at 6s, claude test model=haiku-4.5 |
| `claude_desktop_gateway_token` | Gateway auth token for Claude Desktop |
| `rectifier_config` | JSON: disabled, thinking signature/budget request enabled |
| `optimizer_config` | JSON: disabled, thinking optimizer + cache injection enabled |
| `official_providers_seeded` | true |
| `universal_providers` | {} (empty) |

## 9. Proxy Status

**cc-switch proxy is ACTIVE and running.**

- **Process**: `cc-switch.exe` (PID 14696)
- **Listening**: `127.0.0.1:15721`
- **Memory**: ~79 MB
- **Claude Code settings.json** points to proxy:
  - `ANTHROPIC_BASE_URL`: `http://127.0.0.1:15721`
  - `ANTHROPIC_AUTH_TOKEN`: `PROXY_MANAGED`
  - Model: `opus[1m]`

### Live Backup
The proxy has a live backup of the current Claude provider config (backed up at 2026-06-10T04:32:10), showing it recently applied a provider switch.

## 10. Provider Health Summary (Claude)

### Healthy Providers
| Provider | Last Success |
|----------|-------------|
| NewAPI / DeepSeek / GLM (current) | 2026-06-10 04:37 |
| DeepSeek Official 1 | 2026-06-10 04:32 |
| DeepSeek Official 2 | 2026-06-09 18:52 |
| DeepSeek Official 6 | 2026-06-05 08:13 |
| NewAPI / DeepSeek Pro / Flash / GLM | 2026-06-07 17:06 |
| NewAPI /GLM | 2026-06-07 15:00 |
| DeepSeek Official 40 | 2026-06-05 08:13 |
| DeepSeek Official 17 | 2026-06-04 04:34 |
| DeepSeek Official 18 | 2026-06-05 08:12 |
| DeepSeek Official 26 | 2026-06-05 08:12 |
| DeepSeek Official 28 | 2026-06-05 08:13 |
| DeepSeek Official 11 | 2026-06-05 08:13 |
| Anyrouter / Opus 4.8 | 2026-05-30 17:00 |

### Unhealthy Providers (Circuit Open)
| Provider | Consecutive Failures | Last Error |
|----------|---------------------|------------|
| DeepSeek Official 17 | 10 | Connect error |
| DeepSeek Official 18 | 12 | Connect error |
| DeepSeek Official 26 | 8 | Connect error |
| DeepSeek Official 28 | 10 | Insufficient Balance (402) |
| DeepSeek Official 11 | 13 | Connect error |
| DeepSeek Official 40 | 10 | Connect error |

## 11. Model Pricing Reference (Selected Models)

| Model | Input $/M | Output $/M | Cache Read $/M |
|-------|-----------|------------|----------------|
| deepseek-v4-pro | 0.435 | 0.87 | 0.003625 |
| deepseek-v4-flash | 0.14 | 0.28 | 0.0028 |
| glm-5.1 | 1.4 | 4.4 | 0.26 |
| glm-5 | 1.0 | 3.2 | 0.2 |
| mimo-v2.5 | 0.09 | 0.29 | 0.009 |
| mimo-v2.5-pro | 1.0 | 3.0 | 0 |
| qwen3.7-max (via qwen3.6-plus) | 0.325 | 1.95 | 0 |
| kimi-k2.6 | 0.95 | 4.0 | 0.16 |
| claude-opus-4-8 | 5.0 | 25.0 | 0.50 |
| gpt-5.5 | 5.0 | 30.0 | 0.50 |
| gpt-5.4 | 2.5 | 15.0 | 0.25 |
| doubao-seed-2.0-pro | 0.47 | 2.37 | 0 |

## 12. Key Integration Points for Edge Client

### How cc-switch Works
1. **Proxy intercepts** all Anthropic API calls at `127.0.0.1:15721`
2. **Provider selection**: Routes to the `is_current=1` provider, falls back via `sort_index` order when auto-failover is enabled
3. **Model mapping**: Translates Claude model names to backend models via `ANTHROPIC_DEFAULT_*_MODEL` env vars
4. **Health tracking**: Circuit breaker tracks failures per provider, auto-switches when threshold exceeded
5. **Cost tracking**: Per-request logging with token counts and calculated costs from `model_pricing` table
6. **Settings injection**: Writes `settings.json` with `ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED` and proxy URL

### What Edge Client Needs to Integrate
1. **Read providers table** for `app_type='claude'` to show available providers
2. **Read proxy_config** to show proxy status
3. **Read provider_health** to show health status
4. **Read model_pricing** for cost display
5. **Write providers** to add/modify providers (requires understanding settings_config JSON schema)
6. **Toggle is_current** to switch active provider
7. **Read proxy_request_logs** for usage analytics
