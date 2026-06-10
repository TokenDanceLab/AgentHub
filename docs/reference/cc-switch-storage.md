# CC-Switch Data Storage Layer

> Auto-generated reference document. Source: `D:\Code\Projects\archive\cc-switch`
> Last updated: 2026-06-10

---

## 1. Overview

CC-Switch uses a **dual-layer storage architecture**:

| Layer | Technology | Purpose | Sync scope |
|-------|-----------|---------|-----------|
| Primary | **SQLite** (`rusqlite`) | Structured data: providers, MCP servers, skills, prompts, usage logs, proxy config, settings | Cross-device (WebDAV/S3) |
| Secondary | **JSON files** | Device-local settings, legacy config, Tauri store | Local-only |

### Data Directory

All persistent data lives under `~/.cc-switch/` (resolved via `dirs::home_dir()`):

```
~/.cc-switch/
  cc-switch.db                # Main SQLite database (SSOT for synced data)
  config.json                 # Legacy MultiAppConfig (migration source, read-only after SQLite migration)
  config.json.bak             # Backup of config.json before last write
  settings.json               # Device-local AppSettings (NOT synced)
  backups/                    # Database snapshot backups (*.db)
    db_backup_YYYYMMDD_HHMMSS.db
  skill-backups/              # Per-skill uninstall backups
    YYYYMMDD_HHMMSS_<slug>/
      skill/                  # Actual skill files
      meta.json               # SkillBackupMetadata
  skills/                     # Skill SSOT directory (default location)
    <skill-name>/SKILL.md     # Skill manifest + content
```

On Windows, there is a v3.10.3 compatibility path: if `~/.cc-switch/cc-switch.db` does not exist but `$HOME/.cc-switch/cc-switch.db` does, the legacy path is used instead.

The data directory can be overridden via `app_paths.json` (Tauri Store), controlled by `app_config.rs` -> `get_app_config_dir()`.

---

## 2. Database Layer (SQLite)

### 2.1 Library & Connection

- **Library**: `rusqlite` (Rust SQLite bindings), no ORM
- **Connection**: Single `Connection` wrapped in `std::sync::Mutex` for thread safety (Tauri state)
- **Location**: `~/.cc-switch/cc-switch.db`
- **PRAGMAs**:
  - `foreign_keys = ON`
  - `auto_vacuum = INCREMENTAL`
- **Schema versioning**: `PRAGMA user_version` (currently **v10**)
- **Change notification hook**: `conn.update_hook()` fires `notify_db_changed(table)` for WebDAV/S3 auto-sync on INSERT/UPDATE/DELETE

### 2.2 Schema (18 Tables)

| # | Table | Primary Key | Purpose | Foreign Keys |
|---|-------|------------|---------|-------------|
| 1 | `providers` | `(id TEXT, app_type TEXT)` | Provider configurations per app | - |
| 2 | `provider_endpoints` | `id INTEGER AUTOINCREMENT` | Custom endpoint URLs | `-> providers(id, app_type) CASCADE` |
| 3 | `mcp_servers` | `id TEXT` | MCP server registry | - |
| 4 | `prompts` | `(id TEXT, app_type TEXT)` | Prompt templates per app | - |
| 5 | `skills` | `id TEXT` | Installed skill records | - |
| 6 | `skill_repos` | `(owner TEXT, name TEXT)` | Skill source repositories | - |
| 7 | `settings` | `key TEXT` | Key-value store (config snippets, flags, etc.) | - |
| 8 | `proxy_config` | `app_type TEXT` (3 rows: claude/codex/gemini) | Per-app proxy settings, circuit breaker, timeout config | - |
| 9 | `provider_health` | `(provider_id TEXT, app_type TEXT)` | Circuit breaker health state | `-> providers(id, app_type) CASCADE` |
| 10 | `proxy_request_logs` | `request_id TEXT` | Per-request usage/cost/latency logs | - |
| 11 | `model_pricing` | `model_id TEXT` | Model cost reference data (seeded) | - |
| 12 | `stream_check_logs` | `id INTEGER AUTOINCREMENT` | Provider health check results | - |
| 13 | `proxy_live_backup` | `app_type TEXT` | Live proxy config backup | - |
| 14 | `usage_daily_rollups` | `(date, app_type, provider_id, model)` | Aggregated daily usage stats | - |
| 15 | `session_log_sync` | `file_path TEXT` | Session log file sync offsets | - |

### 2.3 Migration History

| Version | Key Changes |
|---------|------------|
| v0 -> v1 | Add missing columns across all tables |
| v1 -> v2 | Usage stats tables (`proxy_request_logs`, `model_pricing`), skills table refactor, proxy_config to per-app 3-row structure |
| v2 -> v3 | Skills SSOT migration (`~/.cc-switch/skills/`), unified skill management with per-app enable flags |
| v3 -> v4 | OpenCode support (`enabled_opencode` columns) |
| v4 -> v5 | Billing mode support (`cost_multiplier`, `pricing_model_source`, `request_model`) |
| v5 -> v6 | Daily rollups table, Copilot template type unification |
| v6 -> v7 | Skills update detection (`content_hash`, `updated_at`) |
| v7 -> v8 | Session log usage tracking (`data_source`, `session_log_sync`), fix 13 model prices (CNY -> USD) |
| v8 -> v9 | Full model pricing refresh (clear + re-seed ~130 models) |
| v9 -> v10 | Hermes Agent support (`enabled_hermes` columns) |

Migration strategy:
- **Pre-migration backup**: Automatic `.db` snapshot before any version upgrade
- **Savepoint-based**: All migrations run inside `SAVEPOINT schema_migration` for atomicity
- **Forward-only**: No downgrade support; newer DB version blocks older app versions

### 2.4 JSON-to-SQLite Migration

The legacy `config.json` (MultiAppConfig) is migrated to SQLite via `Database::migrate_from_json()`:
- Providers -> `providers` + `provider_endpoints`
- MCP servers -> `mcp_servers`
- Prompts -> `prompts`
- Skill repos -> `skill_repos`
- Common config snippets -> `settings` table

A dry-run mode exists (`migrate_from_json_dry_run`) using an in-memory database for validation.

### 2.5 Backup & Restore

**Database snapshots** (`backup.rs`):
- Backup format: SQLite `Backup` API (binary `.db` copies)
- Location: `~/.cc-switch/backups/db_backup_YYYYMMDD_HHMMSS.db`
- Auto-backup: Configurable interval (default 24h), configurable retention (default 10)
- Pre-migration: Automatic before schema upgrades
- Import safety: SQL import runs in temp DB first, then atomically replaces main DB via `Backup`

**SQL export/import**:
- `export_sql_string()`: Full export as SQL text
- `export_sql_string_for_sync()`: Export for WebDAV sync, skipping local-only tables (`proxy_request_logs`, `stream_check_logs`, `provider_health`, `proxy_live_backup`, `usage_daily_rollups`)
- `import_sql_string_for_sync()`: Import from sync, preserving local-only tables

---

## 3. Settings Storage

### 3.1 Device-Local Settings (`settings.json`)

Location: `~/.cc-switch/settings.json`

This file stores **device-level** settings that are NOT synced across devices:

```rust
struct AppSettings {
    // UI
    show_in_tray: bool,
    minimize_to_tray_on_close: bool,
    use_app_window_controls: bool,
    silent_startup: bool,
    launch_on_startup: bool,
    language: Option<String>,
    visible_apps: Option<VisibleApps>,
    
    // Feature toggles
    enable_local_proxy: bool,
    enable_failover_toggle: bool,
    enable_claude_plugin_integration: bool,
    
    // Per-app config directory overrides
    claude_config_dir: Option<String>,
    codex_config_dir: Option<String>,
    gemini_config_dir: Option<String>,
    opencode_config_dir: Option<String>,
    openclaw_config_dir: Option<String>,
    hermes_config_dir: Option<String>,
    
    // Per-app current provider ID (device-local, synced via DB is_current)
    current_provider_claude: Option<String>,
    current_provider_codex: Option<String>,
    // ... etc for each app type
    
    // Skill settings
    skill_sync_method: SyncMethod,       // Auto | Symlink | Copy
    skill_storage_location: SkillStorageLocation,  // CcSwitch | Unified
    
    // Cloud sync
    webdav_sync: Option<WebDavSyncSettings>,
    s3_sync: Option<S3SyncSettings>,
    
    // Backup strategy
    backup_interval_hours: Option<u32>,  // default 24
    backup_retain_count: Option<u32>,    // default 10
    
    // Terminal
    preferred_terminal: Option<String>,
    
    // Local migration tracking
    local_migrations: Option<LocalMigrations>,
}
```

**In-memory caching**: `OnceLock<RwLock<AppSettings>>` singleton, loaded from file on first access. All reads go through the cache. Writes persist to file then update the cache.

**Unix file permissions**: Settings file is written with mode `0o600` on Unix systems.

### 3.2 Database Key-Value Settings (`settings` table)

Used for synced configuration that travels with the database:

- Common config snippets (`common_config_claude`, `common_config_codex`, etc.)
- Migration flags (`official_providers_seeded`, `skills_ssot_migration_pending`)
- Proxy configuration (legacy, deprecated in favor of `proxy_config` table)
- Global proxy URL
- Rectifier/Optimizer/Log configurations (serialized JSON)

### 3.3 Tauri Store (`app_paths.json`)

A small Tauri plugin store for the app config directory override:
- Key: `app_config_dir_override`
- Purpose: Allow storing data in a custom directory
- Loaded once at startup, cached in `OnceLock<RwLock<Option<PathBuf>>>`

---

## 4. Skills Storage

### 4.1 Architecture

Skills follow a **SSOT (Single Source of Truth)** pattern:

```
~/.cc-switch/skills/     (default SSOT)     or    ~/.agents/skills/     (unified mode)
  <skill-name>/
    SKILL.md                                  # Skill manifest (YAML frontmatter + Markdown)
    ...                                       # Additional skill files
```

The SSOT directory is selected via `settings.skill_storage_location`:
- `CcSwitch` (default): `~/.cc-switch/skills/`
- `Unified`: `~/.agents/skills/` (compatible with other tooling)

### 4.2 Database Records (`skills` table)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Format: `"owner/repo:directory"` or `"local:directory"` |
| `name` | TEXT | Display name from SKILL.md |
| `description` | TEXT | From SKILL.md YAML frontmatter |
| `directory` | TEXT | Install directory name in SSOT |
| `repo_owner` | TEXT | GitHub org/user |
| `repo_name` | TEXT | GitHub repo |
| `repo_branch` | TEXT | Branch (default "main") |
| `readme_url` | TEXT | GitHub blob URL to SKILL.md |
| `enabled_claude` | BOOLEAN | Enabled for Claude |
| `enabled_codex` | BOOLEAN | Enabled for Codex |
| `enabled_gemini` | BOOLEAN | Enabled for Gemini |
| `enabled_opencode` | BOOLEAN | Enabled for OpenCode |
| `enabled_hermes` | BOOLEAN | Enabled for Hermes |
| `installed_at` | INTEGER | Unix timestamp |
| `content_hash` | TEXT | SHA-256 of all non-hidden files |
| `updated_at` | INTEGER | Last update timestamp |

### 4.3 Skill Repositories (`skill_repos` table)

| Column | Type | Description |
|--------|------|-------------|
| `owner` | TEXT PK | GitHub user/org |
| `name` | TEXT PK | Repository name |
| `branch` | TEXT | Branch (default "main") |
| `enabled` | BOOLEAN | Whether to show in discovery |

Default repos: `anthropics/skills`, `ComposioHQ/awesome-claude-skills`, `cexll/myclaude`, `JimLiu/baoyu-skills`

### 4.4 Skill Manifest (`SKILL.md`)

```markdown
---
name: Skill Name
description: Skill description
---

# Skill content (Markdown)
```

The YAML frontmatter is parsed for metadata. The rest is the skill's instruction content.

### 4.5 Sync to App Directories

Skills are synced from SSOT to per-app directories using either **symlinks** or **file copies**:

| App | Default Skills Dir |
|-----|-------------------|
| Claude | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Gemini | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| OpenClaw | `~/.openclaw/skills/` |
| Hermes | `<hermes_dir>/skills/` |

All paths support override via `settings.json` config dir overrides.

### 4.6 Update Detection

- Content hash: SHA-256 of all non-hidden files in skill directory, sorted by relative path
- `check_updates()`: Downloads repo ZIPs, computes remote hash, compares with stored hash
- `update_skill()`: Re-downloads, replaces SSOT files, re-syncs to enabled app dirs

### 4.7 Uninstall Backup

Location: `~/.cc-switch/skill-backups/YYYYMMDD_HHMMSS_<slug>/`

Structure:
```
  skill/          # Actual skill files
  meta.json       # SkillBackupMetadata { skill, backup_created_at, source_path }
```

Retention: 20 backups max (oldest pruned)

---

## 5. MCP Config Storage

### 5.1 Database Storage (`mcp_servers` table)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Display name |
| `server_config` | TEXT | JSON server configuration |
| `description` | TEXT | Optional description |
| `homepage` | TEXT | Optional homepage URL |
| `docs` | TEXT | Optional docs URL |
| `tags` | TEXT | JSON array of tags |
| `enabled_claude` | BOOLEAN | Enabled for Claude |
| `enabled_codex` | BOOLEAN | Enabled for Codex |
| `enabled_gemini` | BOOLEAN | Enabled for Gemini |
| `enabled_opencode` | BOOLEAN | Enabled for OpenCode |
| `enabled_hermes` | BOOLEAN | Enabled for Hermes |

### 5.2 Live Config Write-Through

When MCP settings change, CC-Switch writes the live configuration to each app's config file:

| App | Config File |
|-----|------------|
| Claude | `~/.claude.json` (or `<override_dir>/.json`) |
| Codex | `~/.codex/config.json` |
| Gemini | `~/.gemini/config.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| Hermes | `<hermes_dir>/config.yaml` |

---

## 6. Session Storage

### 6.1 Architecture

Sessions are **not stored in CC-Switch's database**. Instead, CC-Switch reads session data from each app's native session storage:

| App | Session Location | Format |
|-----|-----------------|--------|
| Claude | `~/.claude/projects/*/*.jsonl` | JSONL |
| Codex | `~/.codex/sessions/**/*.jsonl` | JSONL |
| Gemini | `~/.gemini/tmp/**/*.jsonl` | JSONL |
| OpenCode | `<opencode_data_dir>` | SQLite |
| OpenClaw | `~/.openclaw/agents/` | JSONL |
| Hermes | `<hermes_dir>/sessions/` | SQLite |

### 6.2 Session Metadata

```rust
struct SessionMeta {
    provider_id: String,
    session_id: String,
    title: Option<String>,
    summary: Option<String>,
    project_dir: Option<String>,
    created_at: Option<i64>,
    last_active_at: Option<i64>,
    source_path: Option<String>,
    resume_command: Option<String>,
}
```

### 6.3 Session Log Usage Tracking

CC-Switch scans Claude's JSONL session files and extracts token usage data, inserting deduplicated records into `proxy_request_logs` with `data_source = 'session'`. The `session_log_sync` table tracks file offsets for incremental parsing:

| Column | Type | Description |
|--------|------|-------------|
| `file_path` | TEXT PK | JSONL file path |
| `last_modified` | INTEGER | File mtime at last sync |
| `last_line_offset` | INTEGER | Number of lines processed |
| `last_synced_at` | INTEGER | Unix timestamp |

---

## 7. Usage & Cost Tracking

### 7.1 Request Logs (`proxy_request_logs` table)

Every proxied request is logged with full details:

| Column | Type | Description |
|--------|------|-------------|
| `request_id` | TEXT PK | Unique request ID |
| `provider_id` | TEXT | Provider used |
| `app_type` | TEXT | App that made the request |
| `model` | TEXT | Model used |
| `request_model` | TEXT | Originally requested model |
| `input_tokens` | INTEGER | Input token count |
| `output_tokens` | INTEGER | Output token count |
| `cache_read_tokens` | INTEGER | Cache read tokens |
| `cache_creation_tokens` | INTEGER | Cache creation tokens |
| `input_cost_usd` | TEXT | Input cost |
| `output_cost_usd` | TEXT | Output cost |
| `total_cost_usd` | TEXT | Total cost |
| `latency_ms` | INTEGER | Request latency |
| `first_token_ms` | INTEGER | Time to first token |
| `duration_ms` | INTEGER | Total duration |
| `status_code` | INTEGER | HTTP status code |
| `error_message` | TEXT | Error if any |
| `session_id` | TEXT | Session ID |
| `is_streaming` | INTEGER | Streaming or not |
| `cost_multiplier` | TEXT | Applied cost multiplier |
| `data_source` | TEXT | `"proxy"` or `"session"` or app-specific source |
| `created_at` | INTEGER | Unix timestamp |

Indexes: provider+app, created_at, model, session_id, status_code, dedup expression index

### 7.2 Daily Rollups (`usage_daily_rollups` table)

Old request logs (>30 days) are aggregated into daily rollups via `rollup_and_prune()`:

| Column | Type |
|--------|------|
| `date` | TEXT (PK) |
| `app_type` | TEXT (PK) |
| `provider_id` | TEXT (PK) |
| `model` | TEXT (PK) |
| `request_count` | INTEGER |
| `success_count` | INTEGER |
| `input_tokens` | INTEGER |
| `output_tokens` | INTEGER |
| `total_cost_usd` | TEXT |
| `avg_latency_ms` | INTEGER |

Rollup is DST-aware: cutoff aligns to local midnight after `now - retain_days`.

### 7.3 Model Pricing (`model_pricing` table)

Static reference data seeded at startup with `INSERT OR IGNORE`:

| Column | Type | Description |
|--------|------|-------------|
| `model_id` | TEXT PK | Normalized model name (e.g., `claude-sonnet-4-5`) |
| `display_name` | TEXT | Human-readable name |
| `input_cost_per_million` | TEXT | USD per 1M input tokens |
| `output_cost_per_million` | TEXT | USD per 1M output tokens |
| `cache_read_cost_per_million` | TEXT | USD per 1M cache read tokens |
| `cache_creation_cost_per_million` | TEXT | USD per 1M cache creation tokens |

~130 models from Claude, GPT, Gemini, DeepSeek, Kimi, MiniMax, GLM, MiMo, Qwen, Grok, Mistral, Cohere, StepFun, Doubao.

### 7.4 Stream Check Logs (`stream_check_logs` table)

Provider health check results:

| Column | Type |
|--------|------|
| `id` | INTEGER PK AUTOINCREMENT |
| `provider_id` | TEXT |
| `provider_name` | TEXT |
| `app_type` | TEXT |
| `status` | TEXT |
| `success` | INTEGER |
| `message` | TEXT |
| `response_time_ms` | INTEGER |
| `http_status` | INTEGER |
| `model_used` | TEXT |
| `retry_count` | INTEGER |
| `tested_at` | INTEGER |

Auto-pruned after 7 days at startup.

---

## 8. Proxy Config Storage

### 8.1 Per-App Configuration (`proxy_config` table)

Three rows, one per app type (claude, codex, gemini):

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `app_type` | TEXT PK | - | `claude`, `codex`, or `gemini` |
| `proxy_enabled` | INTEGER | 0 | Whether proxy is enabled |
| `listen_address` | TEXT | `127.0.0.1` | Proxy listen address |
| `listen_port` | INTEGER | 15721 | Proxy listen port |
| `enable_logging` | INTEGER | 1 | Log requests |
| `enabled` | INTEGER | 0 | Live takeover enabled |
| `auto_failover_enabled` | INTEGER | 0 | Auto failover |
| `max_retries` | INTEGER | varies | Max retry count |
| `streaming_first_byte_timeout` | INTEGER | varies | First byte timeout (s) |
| `streaming_idle_timeout` | INTEGER | varies | Idle timeout (s) |
| `non_streaming_timeout` | INTEGER | 600 | Non-streaming timeout (s) |
| `circuit_failure_threshold` | INTEGER | varies | Circuit breaker threshold |
| `circuit_success_threshold` | INTEGER | varies | Recovery threshold |
| `circuit_timeout_seconds` | INTEGER | varies | Circuit breaker timeout |
| `circuit_error_rate_threshold` | REAL | varies | Error rate threshold |
| `circuit_min_requests` | INTEGER | varies | Min requests before evaluation |
| `default_cost_multiplier` | TEXT | `1` | Default cost multiplier |
| `pricing_model_source` | TEXT | `response` | Pricing source: `request` or `response` |
| `live_takeover_active` | INTEGER | 0 | Live takeover active flag |

---

## 9. Cloud Sync Storage

### 9.1 WebDAV Sync

Settings stored in `settings.json` (device-local):

```rust
struct WebDavSyncSettings {
    enabled: bool,
    auto_sync: bool,
    base_url: String,
    username: String,
    password: String,            // Cleared when sent to frontend
    remote_root: String,         // default: "cc-switch-sync"
    profile: String,             // default: "default"
    status: WebDavSyncStatus,    // Last sync state
}
```

Sync protocol:
1. Export database as SQL (excluding local-only tables)
2. Upload to WebDAV with manifest file
3. Download: import SQL, then restore local-only tables from current device snapshot

### 9.2 S3 Sync

Same structure as WebDAV, using S3-compatible API:

```rust
struct S3SyncSettings {
    enabled: bool,
    auto_sync: bool,
    region: String,
    bucket: String,
    access_key_id: String,
    secret_access_key: String,   // Cleared when sent to frontend
    endpoint: String,
    remote_root: String,
    profile: String,
    status: WebDavSyncStatus,
}
```

### 9.3 Auto-Sync Trigger

Database change hook (`register_db_change_hook`) fires `notify_db_changed(table)` on every write. The auto-sync service debounces these notifications and triggers sync after a delay.

---

## 10. Cache Layer

### 10.1 Usage Cache (In-Memory)

`UsageCache` in `store.rs` / `services/usage_cache.rs`:

- **Purpose**: Tray menu display, avoid repeated API calls
- **Scope**: Per-process, **not persisted** (lost on restart)
- **Structure**: `HashMap<AppType, SubscriptionQuota>` + `HashMap<(AppType, provider_id), UsageResult>`
- **Thread safety**: `RwLock`-protected
- **Write-through**: Updated on successful usage queries
- **Invalidation**: Per-provider or per-app on disable/refresh

### 10.2 Model Pricing Cache

Model pricing is seeded into SQLite at every startup with `INSERT OR IGNORE` (adds new models only) + `repair_current_model_pricing()` (fixes stale built-in values). This acts as a persistent cache.

### 10.3 Stream Check Log Cleanup

`stream_check_logs` are auto-pruned at startup (older than 7 days) and after periodic backup check.

### 10.4 Request Log Rollup & Prune

`proxy_request_logs` older than 30 days are rolled up into `usage_daily_rollups` and deleted. Runs at startup and periodically. Followed by `PRAGMA incremental_vacuum` to reclaim space.

---

## 11. File I/O Patterns

### 11.1 Atomic Writes

All file writes use `atomic_write()`:
1. Write to `<filename>.tmp.<nanos>` in same directory
2. `fs::rename()` to final path
3. On Windows: `remove_file()` + `rename()` (not truly atomic)
4. On Unix: preserves file permissions of existing file

### 11.2 JSON Serialization

All JSON output uses `sort_json_keys()` for deterministic serialization (recursive alphabetical key ordering). This ensures diff-friendly output and consistent hash values for sync.

### 11.3 Config File Write-Through

CC-Switch writes live configuration files for each app when providers change:

| App | File | Format |
|-----|------|--------|
| Claude | `~/.claude/settings.json` | JSON |
| Claude Desktop | `~/.claude.json` (MCP) | JSON |
| Codex | `~/.codex/config.json` | JSON |
| Gemini | `~/.gemini/config.json` | JSON |
| OpenCode | `~/.config/opencode/opencode.json` | JSON |
| OpenClaw | `~/.openclaw/agents.json` | JSON |
| Hermes | `<hermes_dir>/config.yaml` | YAML |

---

## 12. Data Flow Summary

```
                    ┌──────────────────────────────────────┐
                    │          User Interface (React)       │
                    └──────────┬──────────────┬────────────┘
                               │              │
                    Tauri Commands          HTTP API
                               │              │
                    ┌──────────▼──────────────▼────────────┐
                    │          Rust Backend (Tauri)         │
                    │                                       │
                    │  ┌─────────────────────────────────┐ │
                    │  │         Services Layer           │ │
                    │  │  SkillService, ProxyService,     │ │
                    │  │  UsageCache, SessionManager,     │ │
                    │  │  WebDAV/S3 Sync, BalanceService   │ │
                    │  └──────────┬──────────────────────┘ │
                    │             │                         │
                    │  ┌──────────▼──────────────────────┐ │
                    │  │         Database (SQLite)        │ │
                    │  │  15 tables, v10 schema           │ │
                    │  │  Mutex<Connection>               │ │
                    │  │  Change hook -> auto-sync         │ │
                    │  └──────────┬──────────────────────┘ │
                    │             │                         │
                    └─────────────┼─────────────────────────┘
                                  │
                    ┌─────────────▼─────────────────────────┐
                    │            File System                 │
                    │  ~/.cc-switch/cc-switch.db            │
                    │  ~/.cc-switch/settings.json           │
                    │  ~/.cc-switch/skills/  (SSOT)         │
                    │  ~/.cc-switch/backups/                │
                    │  ~/.cc-switch/skill-backups/          │
                    │  ~/.claude/ (app live configs)        │
                    │  ~/.codex/  (app live configs)        │
                    └───────────────────────────────────────┘
```
