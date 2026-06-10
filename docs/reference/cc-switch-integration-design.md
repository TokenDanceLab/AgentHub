# cc-switch Integration Design for AgentHub

> Research date: 2026-06-10
> cc-switch source: `D:\Code\Projects\archive\cc-switch` (Tauri desktop app, Rust backend, SQLite)
> AgentHub source: `D:\Code\TokenDance\AgentHub` (Go edge-server)

## 1. cc-switch Database Schema (Complete)

**Location**: `~/.cc-switch/cc-switch.db` (SQLite)
**Schema version**: 10 (as of v3.10+)
**Config dir**: `~/.cc-switch/` (see detection logic below)

### 1.1 Tables

#### providers (PRIMARY TABLE for integration)

```
id               TEXT NOT NULL         -- Provider UUID or slug (e.g., "default", "universal-claude-u1")
app_type         TEXT NOT NULL         -- "claude" | "codex" | "gemini" | "hermes" | "opencode" | "claude-desktop" | "openclaw"
name             TEXT NOT NULL         -- Display name ("My NewAPI", "OpenRouter")
settings_config  TEXT NOT NULL         -- JSON: varies by app_type (see section 2)
website_url      TEXT                  -- Optional website
category         TEXT                  -- "official" | "aggregator" | "omo" | "omo-slim" | etc.
created_at       INTEGER              -- Unix ms timestamp
sort_index       INTEGER              -- Display order
notes            TEXT                  -- User notes
icon             TEXT                  -- Icon key ("openai", "anthropic", etc.)
icon_color       TEXT                  -- Hex color ("#00A67E")
meta             TEXT NOT NULL DEFAULT '{}'  -- JSON ProviderMeta (see below)
is_current       BOOLEAN DEFAULT 0    -- Active provider for this app_type
in_failover_queue BOOLEAN DEFAULT 0   -- Included in failover rotation
PRIMARY KEY (id, app_type)
```

**`settings_config` structure** (varies by app_type):
- **Claude**: `{"env": {"ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", "ANTHROPIC_MODEL": "...", "ANTHROPIC_DEFAULT_HAIKU_MODEL": "...", "ANTHROPIC_DEFAULT_SONNET_MODEL": "...", "ANTHROPIC_DEFAULT_OPUS_MODEL": "..."}}`
- **Codex**: `{"auth": {"OPENAI_API_KEY": "..."}, "config": "<TOML string>"}`
- **Gemini**: `{"env": {"GOOGLE_GEMINI_BASE_URL": "...", "GEMINI_API_KEY": "...", "GEMINI_MODEL": "..."}}`
- **OpenCode**: `{"npm": "@ai-sdk/...", "options": {"baseURL": "...", "apiKey": "..."}, "models": {...}}`
- **Hermes**: `{"base_url": "...", "api_key": "..."}`
- **OpenClaw**: `{"baseUrl": "...", "apiKey": "..."}`

**`meta` (ProviderMeta JSON)** -- key fields for integration:
```json
{
  "providerType": "newapi|github_copilot|codex_oauth|...",
  "costMultiplier": "1.5",
  "limitDailyUsd": "10",
  "limitMonthlyUsd": "100",
  "claudeDesktopMode": "direct|proxy",
  "claudeDesktopModelRoutes": {"route-name": {"model": "actual-model-id", "labelOverride": "Display Name"}},
  "apiFormat": "anthropic|openai_chat|openai_responses",
  "authBinding": {"source": "provider_config|managed_account", "authProvider": "github_copilot"},
  "usageScript": {"enabled": true, "language": "javascript", "code": "...", "templateType": "newapi"},
  "customEndpoints": {"https://...": {"url": "...", "added_at": 1234}},
  "codexFastMode": false,
  "codexChatReasoning": {...}
}
```

#### provider_endpoints

```
id           INTEGER PK AUTOINCREMENT
provider_id  TEXT NOT NULL
app_type     TEXT NOT NULL
url          TEXT NOT NULL
added_at     INTEGER
FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
```

#### mcp_servers

```
id               TEXT PRIMARY KEY
name             TEXT NOT NULL
server_config    TEXT NOT NULL   -- JSON: {"command":"npx","args":[...],"env":{...}} or {"url":"...","type":"sse"}
description      TEXT
homepage         TEXT
docs             TEXT
tags             TEXT NOT NULL DEFAULT '[]'  -- JSON array of strings
enabled_claude   BOOLEAN DEFAULT 0
enabled_codex    BOOLEAN DEFAULT 0
enabled_gemini   BOOLEAN DEFAULT 0
enabled_opencode BOOLEAN DEFAULT 0
enabled_hermes   BOOLEAN DEFAULT 0
```

#### skills (v3.10+ unified structure)

```
id               TEXT PRIMARY KEY         -- "owner/repo:directory" or "local:directory"
name             TEXT NOT NULL
description      TEXT
directory        TEXT NOT NULL            -- Subdirectory name within SSOT dir
repo_owner       TEXT
repo_name        TEXT
repo_branch      TEXT DEFAULT 'main'
readme_url       TEXT
enabled_claude   BOOLEAN DEFAULT 0
enabled_codex    BOOLEAN DEFAULT 0
enabled_gemini   BOOLEAN DEFAULT 0
enabled_opencode BOOLEAN DEFAULT 0
enabled_hermes   BOOLEAN DEFAULT 0
installed_at     INTEGER DEFAULT 0
content_hash     TEXT                     -- SHA-256 for update detection
updated_at       INTEGER DEFAULT 0
```

**SSOT directory**: `~/.cc-switch/skills/` (each skill is a subdirectory with `SKILL.md`)

#### skill_repos

```
owner   TEXT NOT NULL
name    TEXT NOT NULL
branch  TEXT DEFAULT 'main'
enabled BOOLEAN DEFAULT 1
PRIMARY KEY (owner, name)
```

#### prompts

```
id          TEXT NOT NULL
app_type    TEXT NOT NULL
name        TEXT NOT NULL
content     TEXT NOT NULL
description TEXT
enabled     BOOLEAN DEFAULT 1
created_at  INTEGER
updated_at  INTEGER
PRIMARY KEY (id, app_type)
```

#### settings (key-value store)

```
key    TEXT PRIMARY KEY
value  TEXT
```

Notable keys: `common_config_claude`, `common_config_codex`, `common_config_gemini`, `official_providers_seeded`, `skills_ssot_migration_pending`, `global_proxy_url`, `rectifier_config`, `optimizer_config`, `copilot_optimizer_config`, `log_config`, and legacy `proxy_takeover_*` / `auto_failover_enabled_*` keys.

#### proxy_config (per-app proxy settings)

```
app_type                       TEXT PK CHECK (app_type IN ('claude','codex','gemini'))
proxy_enabled                  INTEGER DEFAULT 0
listen_address                 TEXT DEFAULT '127.0.0.1'
listen_port                    INTEGER DEFAULT 15721
enable_logging                 INTEGER DEFAULT 1
enabled                        INTEGER DEFAULT 0          -- "live takeover" active
auto_failover_enabled          INTEGER DEFAULT 0
max_retries                    INTEGER DEFAULT 3
streaming_first_byte_timeout   INTEGER DEFAULT 60
streaming_idle_timeout         INTEGER DEFAULT 120
non_streaming_timeout          INTEGER DEFAULT 600
circuit_failure_threshold      INTEGER DEFAULT 4
circuit_success_threshold      INTEGER DEFAULT 2
circuit_timeout_seconds        INTEGER DEFAULT 60
circuit_error_rate_threshold   REAL DEFAULT 0.6
circuit_min_requests           INTEGER DEFAULT 10
default_cost_multiplier        TEXT DEFAULT '1'
pricing_model_source           TEXT DEFAULT 'response'
live_takeover_active           INTEGER DEFAULT 0
created_at                     TEXT
updated_at                     TEXT
```

#### provider_health

```
provider_id          TEXT NOT NULL
app_type             TEXT NOT NULL
is_healthy           INTEGER DEFAULT 1
consecutive_failures INTEGER DEFAULT 0
last_success_at      TEXT
last_failure_at      TEXT
last_error           TEXT
updated_at           TEXT NOT NULL
PRIMARY KEY (provider_id, app_type)
```

#### proxy_request_logs

```
request_id             TEXT PK
provider_id            TEXT NOT NULL
app_type               TEXT NOT NULL
model                  TEXT NOT NULL
request_model          TEXT           -- Original model from CLI before mapping
input_tokens           INTEGER DEFAULT 0
output_tokens          INTEGER DEFAULT 0
cache_read_tokens      INTEGER DEFAULT 0
cache_creation_tokens  INTEGER DEFAULT 0
input_cost_usd         TEXT DEFAULT '0'
output_cost_usd        TEXT DEFAULT '0'
cache_read_cost_usd    TEXT DEFAULT '0'
cache_creation_cost_usd TEXT DEFAULT '0'
total_cost_usd         TEXT DEFAULT '0'
latency_ms             INTEGER
first_token_ms         INTEGER
duration_ms            INTEGER
status_code            INTEGER
error_message          TEXT
session_id             TEXT
provider_type          TEXT
is_streaming           INTEGER DEFAULT 0
cost_multiplier        TEXT DEFAULT '1.0'
created_at             INTEGER
data_source            TEXT DEFAULT 'proxy'   -- 'proxy' | 'session_log'
```

#### model_pricing

```
model_id                       TEXT PK
display_name                   TEXT NOT NULL
input_cost_per_million         TEXT NOT NULL
output_cost_per_million        TEXT NOT NULL
cache_read_cost_per_million    TEXT DEFAULT '0'
cache_creation_cost_per_million TEXT DEFAULT '0'
```

Contains 100+ models with pricing data (Claude, GPT, Gemini, DeepSeek, Qwen, etc.).

#### stream_check_logs, usage_daily_rollups, session_log_sync, proxy_live_backup

(Usage statistics and sync metadata tables -- secondary for integration.)

---

## 2. Provider/Model Alias Mapping Mechanism

cc-switch does NOT have a simple "alias table". Model mapping is embedded in provider configs:

### 2.1 Claude (via env vars in settings_config)

The provider's `settings_config.env` contains:
- `ANTHROPIC_MODEL` -- default/fallback model
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` -- maps "haiku" tier
- `ANTHROPIC_DEFAULT_SONNET_MODEL` -- maps "sonnet" tier
- `ANTHROPIC_DEFAULT_OPUS_MODEL` -- maps "opus" tier

The proxy's `ModelMapping::from_provider()` (in `proxy/model_mapper.rs`) reads these env vars and maps incoming model names:
- If request model contains "haiku" -> use `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- If request model contains "sonnet" -> use `ANTHROPIC_DEFAULT_SONNET_MODEL`
- If request model contains "opus" -> use `ANTHROPIC_DEFAULT_OPUS_MODEL`
- Otherwise -> use `ANTHROPIC_MODEL`

### 2.2 Codex (via TOML in settings_config)

Model is in the TOML `config` field: `model = "gpt-5.3-codex"`, `model_reasoning_effort = "high"`.

### 2.3 Gemini (via env vars)

`GEMINI_MODEL` in `settings_config.env`.

### 2.4 Claude Desktop Model Routes

ProviderMeta has `claudeDesktopModelRoutes`: a map of Claude-safe route names to actual upstream models:
```json
{
  "claude-sonnet-4-6": {"model": "deepseek-v4-pro", "labelOverride": "DeepSeek V4 Pro"},
  "claude-opus-4-7": {"model": "gpt-5.5", "labelOverride": "GPT-5.5"}
}
```

### 2.5 UniversalProvider (cross-app shared provider)

`UniversalProvider` struct has per-app model configs:
```rust
struct UniversalProvider {
    id, name, provider_type, base_url, api_key,
    apps: UniversalProviderApps { claude, codex, gemini },
    models: UniversalProviderModels {
        claude: Option<ClaudeModelConfig>  { model, haiku_model, sonnet_model, opus_model },
        codex: Option<CodexModelConfig>    { model, reasoning_effort },
        gemini: Option<GeminiModelConfig>  { model },
    }
}
```

UniversalProviders are NOT stored as a separate table. They are expanded into per-app_provider_ rows (e.g., `universal-claude-<id>`, `universal-codex-<id>`) in the `providers` table.

### 2.6 SQL to Extract Model Mappings for AgentHub

```sql
-- Get all Claude providers with their model mappings
SELECT
    p.id, p.name, p.app_type,
    json_extract(p.settings_config, '$.env.ANTHROPIC_BASE_URL') AS base_url,
    json_extract(p.settings_config, '$.env.ANTHROPIC_MODEL') AS default_model,
    json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_HAIKU_MODEL') AS haiku_model,
    json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_SONNET_MODEL') AS sonnet_model,
    json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_OPUS_MODEL') AS opus_model,
    p.icon, p.icon_color, p.category,
    CASE WHEN json_extract(p.settings_config, '$.env.ANTHROPIC_AUTH_TOKEN') != ''
         THEN 1 ELSE 0 END AS has_api_key,
    p.is_current
FROM providers p
WHERE p.app_type = 'claude'
ORDER BY p.sort_index, p.created_at;

-- Get current provider per app
SELECT id, name, app_type, settings_config
FROM providers
WHERE is_current = 1;

-- Get all MCP servers enabled for Claude
SELECT id, name, server_config, description, homepage, docs, tags
FROM mcp_servers
WHERE enabled_claude = 1;

-- Get all installed skills
SELECT id, name, description, directory, enabled_claude, installed_at, content_hash
FROM skills
ORDER BY name;

-- Get proxy routing status
SELECT app_type, proxy_enabled, enabled, listen_address, listen_port
FROM proxy_config;

-- Get model pricing
SELECT model_id, display_name, input_cost_per_million, output_cost_per_million
FROM model_pricing;
```

---

## 3. cc-switch Status Detection

### 3.1 Installation Detection

```
Check order:
1. Directory exists: ~/.cc-switch/
2. Database exists: ~/.cc-switch/cc-switch.db
3. (Windows fallback) Check HOME env var path too (v3.10.3 compat)
```

### 3.2 Configuration Detection

```sql
-- Has any non-official providers? (User has configured custom providers)
SELECT COUNT(*) FROM providers WHERE category != 'official' OR category IS NULL;

-- Has API keys set? (Check current provider's settings_config)
SELECT settings_config FROM providers WHERE is_current = 1 AND app_type = 'claude';
-- Then parse JSON: env.ANTHROPIC_AUTH_TOKEN != ""
```

### 3.3 Proxy/Routing Active Detection

```sql
-- Is proxy enabled?
SELECT proxy_enabled, listen_address, listen_port FROM proxy_config WHERE app_type = 'claude';

-- Is live takeover active? (cc-switch rewriting CLI config files)
SELECT enabled FROM proxy_config WHERE app_type = 'claude';
```

Additionally, check if port is open:
```
GET http://127.0.0.1:15721/health  (or try TCP connect)
```

### 3.4 Version Detection

```sql
PRAGMA user_version;  -- Returns schema version (currently 10)
```

Or check the running process for the version.

---

## 4. MCP Configuration Reading

### 4.1 Storage

MCP servers are stored in the `mcp_servers` table. The `server_config` column contains JSON that maps directly to the Claude Code MCP config format:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {"KEY": "value"}
}
```

or for SSE/streamable-http:
```json
{
  "type": "sse",
  "url": "http://localhost:3001/sse"
}
```

### 4.2 How cc-switch Generates .claude.json / .mcp.json

cc-switch generates MCP config files in `claude_mcp.rs`:
1. Reads all `mcp_servers` where `enabled_claude = 1`
2. Parses `server_config` JSON for each
3. Writes to `~/.claude.json` (the Claude Code MCP config file)
4. On Windows, wraps `npx`/`npm`/`node` commands with `cmd /c`

### 4.3 AgentHub Integration Strategy

AgentHub can directly query the cc-switch database:
```sql
SELECT name, server_config FROM mcp_servers WHERE enabled_claude = 1;
```

The `server_config` JSON is already in the correct format for Claude Code's `--mcp-config` injection. AgentHub's existing `MCPServerConfig` struct is compatible -- the fields map directly:

| cc-switch server_config | AgentHub MCPServerConfig |
|------------------------|--------------------------|
| `command`              | `Command`                |
| `args`                 | `Args`                   |
| `env`                  | `Env`                    |
| `type: "sse"` + `url`  | `Transport` + `URL`      |

---

## 5. Skills Integration

### 5.1 Storage

Skills are stored in two places:
1. **Database**: `skills` table (metadata, enabled status, content hash)
2. **Filesystem**: `~/.cc-switch/skills/<directory>/SKILL.md` (actual skill content)

### 5.2 SKILL.md Format

Skills use YAML frontmatter:
```markdown
---
name: deep-research
description: Deep research harness
triggers:
  - deep-research
  - /deep-research
---
# Skill body (markdown instructions)
...
```

### 5.3 AgentHub Compatibility

AgentHub's `skills/parser.go` already parses SKILL.md files with YAML frontmatter (name, description, triggers). The format is identical to cc-switch's skill format.

AgentHub can:
1. Read `~/.cc-switch/skills/` directory directly
2. Parse each `SKILL.md` using existing `ParseFrontmatter()`
3. Or query the database for metadata + use directory path for content

---

## 6. Session Reading

cc-switch does NOT store sessions in its database. Sessions are read from agent-specific directories:

- **Claude Code**: `~/.claude/projects/` (JSONL files)
- **Codex**: Platform-specific session dirs (JSONL files)
- **Gemini**: `~/.gemini/tmp/`
- **OpenCode**: SQLite databases
- **Hermes**: `~/.hermes/sessions/` (SQLite)

The session_manager module scans all these directories and returns `SessionMeta` structs. AgentHub should scan these directories independently rather than going through cc-switch.

---

## 7. Integration Architecture

### 7.1 Go Package: `ccswitch`

New file: `edge-server/internal/ccswitch/reader.go`

```go
package ccswitch

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "os"
    "path/filepath"
    "runtime"
    "sync"

    _ "github.com/mattn/go-sqlite3"
)

// Config describes the detected cc-switch installation.
type Config struct {
    DBPath    string // ~/.cc-switch/cc-switch.db
    ConfigDir string // ~/.cc-switch/
    Installed bool
    Version   int    // Schema version (PRAGMA user_version)
}

// ProviderInfo is a simplified provider view extracted from cc-switch.
type ProviderInfo struct {
    ID           string `json:"id"`
    Name         string `json:"name"`
    AppType      string `json:"appType"`
    Category     string `json:"category"`
    Icon         string `json:"icon"`
    IconColor    string `json:"iconColor"`
    IsCurrent    bool   `json:"isCurrent"`
    BaseURL      string `json:"baseUrl"`
    HasAPIKey    bool   `json:"hasApiKey"`
    DefaultModel string `json:"defaultModel"`
    HaikuModel   string `json:"haikuModel"`
    SonnetModel  string `json:"sonnetModel"`
    OpusModel    string `json:"opusModel"`
}

// MCPServerInfo is an MCP server from cc-switch.
type MCPServerInfo struct {
    ID          string          `json:"id"`
    Name        string          `json:"name"`
    Config      json.RawMessage `json:"config"` // server_config JSON
    Description string          `json:"description"`
    Homepage    string          `json:"homepage"`
    Tags        []string        `json:"tags"`
}

// SkillInfo is a skill from cc-switch.
type SkillInfo struct {
    ID          string `json:"id"`
    Name        string `json:"name"`
    Description string `json:"description"`
    Directory   string `json:"directory"`
    RepoOwner   string `json:"repoOwner"`
    RepoName    string `json:"repoName"`
    InstalledAt int64  `json:"installedAt"`
    ContentHash string `json:"contentHash"`
}

// ProxyStatus describes the cc-switch proxy state.
type ProxyStatus struct {
    ProxyEnabled   bool   `json:"proxyEnabled"`
    LiveTakeover   bool   `json:"liveTakeover"`
    ListenAddress  string `json:"listenAddress"`
    ListenPort     int    `json:"listenPort"`
}

// ModelPricing is pricing data for a model.
type ModelPricing struct {
    ModelID              string `json:"modelId"`
    DisplayName          string `json:"displayName"`
    InputCostPerMillion  string `json:"inputCostPerMillion"`
    OutputCostPerMillion string `json:"outputCostPerMillion"`
}

// Reader reads cc-switch's SQLite database. Safe for concurrent use.
type Reader struct {
    mu     sync.RWMutex
    config Config
    db     *sql.DB
}

// Detect checks if cc-switch is installed and returns its config.
func Detect() *Config {
    homeDir, err := os.UserHomeDir()
    if err != nil {
        return &Config{Installed: false}
    }

    configDir := filepath.Join(homeDir, ".cc-switch")
    dbPath := filepath.Join(configDir, "cc-switch.db")

    // Check if DB exists
    if _, err := os.Stat(dbPath); os.IsNotExist(err) {
        // Windows fallback: check HOME env var (v3.10.3 compat)
        if runtime.GOOS == "windows" {
            if homeEnv := os.Getenv("HOME"); homeEnv != "" {
                legacyDB := filepath.Join(homeEnv, ".cc-switch", "cc-switch.db")
                if _, err := os.Stat(legacyDB); err == nil {
                    return &Config{
                        DBPath:    legacyDB,
                        ConfigDir: filepath.Dir(legacyDB),
                        Installed: true,
                    }
                }
            }
        }
        return &Config{Installed: false}
    }

    return &Config{
        DBPath:    dbPath,
        ConfigDir: configDir,
        Installed: true,
    }
}

// NewReader creates a new Reader for the given cc-switch database.
// Opens the DB in read-only mode.
func NewReader(cfg *Config) (*Reader, error) {
    if !cfg.Installed {
        return nil, fmt.Errorf("cc-switch not installed")
    }

    // Open in read-only mode to avoid conflicting with running cc-switch
    db, err := sql.Open("sqlite3", cfg.DBPath+"?mode=ro&_journal_mode=WAL&_busy_timeout=5000")
    if err != nil {
        return nil, fmt.Errorf("open cc-switch db: %w", err)
    }

    r := &Reader{config: *cfg, db: db}

    // Read schema version
    var version int
    _ = db.QueryRow("PRAGMA user_version").Scan(&version)
    r.config.Version = version

    return r, nil
}

// Close closes the database connection.
func (r *Reader) Close() error {
    if r.db != nil {
        return r.db.Close()
    }
    return nil
}

// Config returns the detected cc-switch configuration.
func (r *Reader) Config() Config {
    r.mu.RLock()
    defer r.mu.RUnlock()
    return r.config
}

// GetProviders returns all providers for a given app type.
func (r *Reader) GetProviders(appType string) ([]ProviderInfo, error) {
    query := `
        SELECT p.id, p.name, p.app_type, p.category, p.icon, p.icon_color,
               p.is_current,
               json_extract(p.settings_config, '$.env.ANTHROPIC_BASE_URL'),
               json_extract(p.settings_config, '$.env.ANTHROPIC_AUTH_TOKEN'),
               json_extract(p.settings_config, '$.env.ANTHROPIC_MODEL'),
               json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_HAIKU_MODEL'),
               json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_SONNET_MODEL'),
               json_extract(p.settings_config, '$.env.ANTHROPIC_DEFAULT_OPUS_MODEL')
        FROM providers p
        WHERE p.app_type = ?
        ORDER BY COALESCE(p.sort_index, 999999), p.created_at ASC`

    rows, err := r.db.Query(query, appType)
    if err != nil {
        return nil, fmt.Errorf("query providers: %w", err)
    }
    defer rows.Close()

    var providers []ProviderInfo
    for rows.Next() {
        var p ProviderInfo
        var apiKey sql.NullString
        var baseURL, defaultModel, haikuModel, sonnetModel, opusModel sql.NullString
        var category, icon, iconColor sql.NullString

        err := rows.Scan(
            &p.ID, &p.Name, &p.AppType, &category, &icon, &iconColor,
            &p.IsCurrent, &baseURL, &apiKey,
            &defaultModel, &haikuModel, &sonnetModel, &opusModel,
        )
        if err != nil {
            continue
        }

        p.Category = category.String
        p.Icon = icon.String
        p.IconColor = iconColor.String
        p.BaseURL = baseURL.String
        p.HasAPIKey = apiKey.Valid && apiKey.String != ""
        p.DefaultModel = defaultModel.String
        p.HaikuModel = haikuModel.String
        p.SonnetModel = sonnetModel.String
        p.OpusModel = opusModel.String

        providers = append(providers, p)
    }
    return providers, nil
}

// GetCurrentProvider returns the current (active) provider for an app type.
func (r *Reader) GetCurrentProvider(appType string) (*ProviderInfo, error) {
    providers, err := r.GetProviders(appType)
    if err != nil {
        return nil, err
    }
    for _, p := range providers {
        if p.IsCurrent {
            return &p, nil
        }
    }
    return nil, nil
}

// GetMCPServers returns MCP servers enabled for a given app type.
func (r *Reader) GetMCPServers(appType string) ([]MCPServerInfo, error) {
    var enabledCol string
    switch appType {
    case "claude":
        enabledCol = "enabled_claude"
    case "codex":
        enabledCol = "enabled_codex"
    case "gemini":
        enabledCol = "enabled_gemini"
    case "opencode":
        enabledCol = "enabled_opencode"
    case "hermes":
        enabledCol = "enabled_hermes"
    default:
        return nil, fmt.Errorf("unknown app type: %s", appType)
    }

    query := fmt.Sprintf(`
        SELECT id, name, server_config, description, homepage, tags
        FROM mcp_servers
        WHERE %s = 1
        ORDER BY name ASC`, enabledCol)

    rows, err := r.db.Query(query)
    if err != nil {
        return nil, fmt.Errorf("query mcp servers: %w", err)
    }
    defer rows.Close()

    var servers []MCPServerInfo
    for rows.Next() {
        var s MCPServerInfo
        var desc, homepage, tagsStr sql.NullString
        err := rows.Scan(&s.ID, &s.Name, &s.Config, &desc, &homepage, &tagsStr)
        if err != nil {
            continue
        }
        s.Description = desc.String
        s.Homepage = homepage.String
        if tagsStr.Valid {
            _ = json.Unmarshal([]byte(tagsStr.String), &s.Tags)
        }
        servers = append(servers, s)
    }
    return servers, nil
}

// GetSkills returns all installed skills from cc-switch.
func (r *Reader) GetSkills() ([]SkillInfo, error) {
    rows, err := r.db.Query(`
        SELECT id, name, description, directory, repo_owner, repo_name,
               installed_at, content_hash
        FROM skills
        ORDER BY name ASC`)
    if err != nil {
        return nil, fmt.Errorf("query skills: %w", err)
    }
    defer rows.Close()

    var skills []SkillInfo
    for rows.Next() {
        var s SkillInfo
        var desc, owner, name, hash sql.NullString
        err := rows.Scan(&s.ID, &s.Name, &desc, &s.Directory, &owner, &name,
            &s.InstalledAt, &hash)
        if err != nil {
            continue
        }
        s.Description = desc.String
        s.RepoOwner = owner.String
        s.RepoName = name.String
        s.ContentHash = hash.String
        skills = append(skills, s)
    }
    return skills, nil
}

// GetProxyStatus returns the proxy configuration for an app type.
func (r *Reader) GetProxyStatus(appType string) (*ProxyStatus, error) {
    var ps ProxyStatus
    var proxyEnabled, enabled int
    err := r.db.QueryRow(`
        SELECT proxy_enabled, enabled, listen_address, listen_port
        FROM proxy_config WHERE app_type = ?`, appType,
    ).Scan(&proxyEnabled, &enabled, &ps.ListenAddress, &ps.ListenPort)
    if err != nil {
        return nil, fmt.Errorf("query proxy config: %w", err)
    }
    ps.ProxyEnabled = proxyEnabled != 0
    ps.LiveTakeover = enabled != 0
    return &ps, nil
}

// GetModelPricing returns all model pricing data.
func (r *Reader) GetModelPricing() ([]ModelPricing, error) {
    rows, err := r.db.Query(`
        SELECT model_id, display_name, input_cost_per_million, output_cost_per_million
        FROM model_pricing`)
    if err != nil {
        return nil, fmt.Errorf("query model pricing: %w", err)
    }
    defer rows.Close()

    var pricing []ModelPricing
    for rows.Next() {
        var p ModelPricing
        err := rows.Scan(&p.ModelID, &p.DisplayName, &p.InputCostPerMillion, &p.OutputCostPerMillion)
        if err != nil {
            continue
        }
        pricing = append(pricing, p)
    }
    return pricing, nil
}

// GetModelAliases builds a ModelAliases map from cc-switch provider data.
// Returns a map[alias]realModelID for the given agent type.
func (r *Reader) GetModelAliases(agentType string) map[string]string {
    appType := agentToAppType(agentType)
    providers, err := r.GetProviders(appType)
    if err != nil || len(providers) == 0 {
        return nil
    }

    // Find the current provider
    var current *ProviderInfo
    for i := range providers {
        if providers[i].IsCurrent {
            current = &providers[i]
            break
        }
    }
    if current == nil {
        return nil
    }

    aliases := make(map[string]string)
    if current.DefaultModel != "" {
        aliases["default"] = current.DefaultModel
    }
    if current.HaikuModel != "" {
        aliases["haiku"] = current.HaikuModel
    }
    if current.SonnetModel != "" {
        aliases["sonnet"] = current.SonnetModel
    }
    if current.OpusModel != "" {
        aliases["opus"] = current.OpusModel
    }
    return aliases
}

func agentToAppType(agentID string) string {
    switch agentID {
    case "claude-code", "anthropic-sdk":
        return "claude"
    case "codex", "openai-sdk":
        return "codex"
    case "gemini":
        return "gemini"
    case "opencode":
        return "opencode"
    default:
        return "claude"
    }
}
```

### 7.2 Edge API Endpoints

New file: `edge-server/internal/api/ccswitch_handlers.go`

```go
package api

import (
    "encoding/json"
    "net/http"

    "github.com/agenthub/edge-server/internal/ccswitch"
)

// CCSwitchHandler provides HTTP endpoints for cc-switch integration.
type CCSwitchHandler struct {
    reader *ccswitch.Reader
}

// NewCCSwitchHandler creates a handler. If cc-switch is not installed, reader is nil.
func NewCCSwitchHandler(reader *ccswitch.Reader) *CCSwitchHandler {
    return &CCSwitchHandler{reader: reader}
}

// IsAvailable returns true if cc-switch integration is active.
func (h *CCSwitchHandler) IsAvailable() bool {
    return h.reader != nil
}

// RegisterRoutes registers cc-switch API routes on the given mux.
func (h *CCSwitchHandler) RegisterRoutes(mux *http.ServeMux) {
    if h.reader == nil {
        return
    }
    mux.HandleFunc("/v1/ccswitch/status", h.handleStatus)
    mux.HandleFunc("/v1/ccswitch/providers", h.handleProviders)
    mux.HandleFunc("/v1/ccswitch/mcp", h.handleMCP)
    mux.HandleFunc("/v1/ccswitch/skills", h.handleSkills)
    mux.HandleFunc("/v1/ccswitch/pricing", h.handlePricing)
    mux.HandleFunc("/v1/ccswitch/models", h.handleModelAliases)
}

func (h *CCSwitchHandler) handleStatus(w http.ResponseWriter, r *http.Request) {
    cfg := h.reader.Config()
    proxy, _ := h.reader.GetProxyStatus("claude")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "installed":     cfg.Installed,
        "version":       cfg.Version,
        "dbPath":        cfg.DBPath,
        "configDir":     cfg.ConfigDir,
        "proxyStatus":   proxy,
    })
}

func (h *CCSwitchHandler) handleProviders(w http.ResponseWriter, r *http.Request) {
    appType := r.URL.Query().Get("app")
    if appType == "" {
        appType = "claude"
    }
    providers, err := h.reader.GetProviders(appType)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(map[string]interface{}{
        "providers": providers,
    })
}

func (h *CCSwitchHandler) handleMCP(w http.ResponseWriter, r *http.Request) {
    appType := r.URL.Query().Get("app")
    if appType == "" {
        appType = "claude"
    }
    servers, err := h.reader.GetMCPServers(appType)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(map[string]interface{}{
        "servers": servers,
    })
}

func (h *CCSwitchHandler) handleSkills(w http.ResponseWriter, r *http.Request) {
    skills, err := h.reader.GetSkills()
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(map[string]interface{}{
        "skills": skills,
    })
}

func (h *CCSwitchHandler) handlePricing(w http.ResponseWriter, r *http.Request) {
    pricing, err := h.reader.GetModelPricing()
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(map[string]interface{}{
        "pricing": pricing,
    })
}

func (h *CCSwitchHandler) handleModelAliases(w http.ResponseWriter, r *http.Request) {
    agent := r.URL.Query().Get("agent")
    if agent == "" {
        agent = "claude-code"
    }
    aliases := h.reader.GetModelAliases(agent)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "agent":   agent,
        "aliases": aliases,
    })
}
```

### 7.3 Integration with Existing AgentHub Code

#### Model Config Enhancement

Modify `model_config.go` to optionally source from cc-switch:

```go
// In model_config.go, add:
var ccswitchReader *ccswitch.Reader // initialized at startup

func initCCSwitchIntegration() {
    cfg := ccswitch.Detect()
    if cfg.Installed {
        reader, err := ccswitch.NewReader(cfg)
        if err == nil {
            ccswitchReader = reader
            // Override ModelAliases with cc-switch data
            if aliases := reader.GetModelAliases("claude-code"); aliases != nil {
                for k, v := range aliases {
                    ModelAliases["claude-code"][k] = v
                }
            }
        }
    }
}
```

#### MCP Config Enhancement

The cc-switch MCP servers can be merged into the existing `MCPConfigStore`:

```go
func syncMCPServersFromCCSwitch(reader *ccswitch.Reader, store *adapters.MCPConfigStore) {
    servers, err := reader.GetMCPServers("claude")
    if err != nil {
        return
    }
    merged := store.Get() // existing Hub-synced servers
    for _, s := range servers {
        var cfg adapters.MCPServerConfig
        if err := json.Unmarshal(s.Config, &cfg); err != nil {
            continue
        }
        cfg.Name = s.Name
        if _, exists := merged[s.Name]; !exists {
            merged[s.Name] = cfg
        }
    }
    store.Set(merged)
}
```

#### Skills Integration

The cc-switch skills directory (`~/.cc-switch/skills/`) can be added as a discovery path in the existing skills system:

```go
func discoverCCSwitchSkills(reader *ccswitch.Reader) ([]skills.Skill, error) {
    cfg := reader.Config()
    skillsDir := filepath.Join(cfg.ConfigDir, "skills")
    if _, err := os.Stat(skillsDir); os.IsNotExist(err) {
        return nil, nil
    }
    // Use existing skills.ParseFrontmatter on each SKILL.md in the directory
    return skills.Discover(skillsDir) // reusing existing discovery logic
}
```

---

## 8. Implementation Plan

### Phase 1: DB Reader (Core)

| File | Action | Description |
|------|--------|-------------|
| `edge-server/internal/ccswitch/reader.go` | CREATE | SQLite reader with Detect(), GetProviders(), GetMCPServers(), GetSkills(), GetProxyStatus(), GetModelAliases() |
| `edge-server/internal/ccswitch/reader_test.go` | CREATE | Unit tests with in-memory SQLite |
| `go.mod` | EDIT | Add `github.com/mattn/go-sqlite3` dependency |

### Phase 2: API Endpoints

| File | Action | Description |
|------|--------|-------------|
| `edge-server/internal/api/ccswitch_handlers.go` | CREATE | 6 REST endpoints: status, providers, mcp, skills, pricing, models |
| `edge-server/internal/api/handlers.go` | EDIT | Initialize CCSwitchHandler in Handler struct |
| `edge-server/internal/httpserver/server.go` | EDIT | Register cc-switch routes |

### Phase 3: Model Config Integration

| File | Action | Description |
|------|--------|-------------|
| `edge-server/internal/adapters/model_config.go` | EDIT | Add cc-switch model alias override with fallback to hardcoded aliases |
| `edge-server/internal/adapters/registry.go` | EDIT | Pass cc-switch reader to adapter builds |

### Phase 4: MCP Integration

| File | Action | Description |
|------|--------|-------------|
| `edge-server/internal/adapters/mcp_config.go` | EDIT | Add syncMCPServersFromCCSwitch() function |
| `edge-server/internal/httpserver/server.go` | EDIT | Call MCP sync on startup |

### Phase 5: Skills Integration

| File | Action | Description |
|------|--------|-------------|
| `edge-server/internal/skills/discovery.go` | EDIT | Add cc-switch skills directory as discovery source |

### Phase 6: Frontend (Future)

- Status indicator in AgentHub UI showing cc-switch connectivity
- "Import from cc-switch" button for models, MCP servers, skills
- Model selector dropdown showing cc-switch provider aliases
- MCP market showing cc-switch MCP servers alongside Hub-synced ones

---

## 9. Key Design Decisions

1. **Read-only DB access**: AgentHub opens cc-switch.db in read-only mode (`?mode=ro`) to avoid conflicts with the running cc-switch app. cc-switch uses WAL journal mode, so concurrent reads are safe.

2. **Graceful fallback**: If cc-switch is not installed or DB is locked, all integration degrades silently. Hardcoded ModelAliases and Hub-synced MCP/Skills remain functional.

3. **No dependency on cc-switch process**: AgentHub reads the database file directly. It does not need cc-switch to be running (though proxy status is only meaningful when cc-switch proxy is active).

4. **SQLite driver**: Use `mattn/go-sqlite3` (CGO) which is already widely used in the Go ecosystem. Alternatively, `modernc.org/sqlite` for pure-Go (no CGO required).

5. **Model alias merging**: cc-switch aliases are layered ON TOP of hardcoded defaults. If cc-switch has an active provider with model mappings, those take precedence; otherwise hardcoded aliases are used.

6. **Skills directory sharing**: cc-switch skills are in `~/.cc-switch/skills/` with SKILL.md format. AgentHub's existing parser can read them directly. No format conversion needed.

7. **Session data**: Not read from cc-switch. Sessions are in agent-specific directories that AgentHub can scan independently.
