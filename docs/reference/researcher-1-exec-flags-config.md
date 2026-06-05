# Researcher 1: codex exec -- Complete Flag & Config Key Map

> Source: `codex-rs/exec/src/cli.rs`, `codex-rs/utils/cli/src/shared_options.rs`, `codex-rs/utils/cli/src/config_override.rs`, `codex-rs/core/src/config/mod.rs`

## 1.1. CLI Flags for `codex exec`

### Exec-specific flags (cli.rs)

| Flag | Type | Description | Adapter Support |
|------|------|-------------|-----------------|
| `PROMPT` | positional | Initial prompt/instructions | YES (ctx.Prompt) |
| `--json` / `--experimental-json` | bool | Print events as JSONL to stdout | YES (always) |
| `-o` / `--output-last-message FILE` | PathBuf | Write last agent message to file | NO -- could be useful |
| `--output-schema FILE` | PathBuf | JSON Schema for structured output | NO -- Phase 2 |
| `--strict-config` | bool | Fail on unknown config keys | NO |
| `--skip-git-repo-check` | bool | Run outside a git repo | NO -- could add |
| `--ephemeral` | bool | No session persistence to disk | NO -- useful for stateless tasks |
| `--ignore-user-config` | bool | Skip ~/.codex/config.toml | NO |
| `--ignore-rules` | bool | Skip execpolicy .rules files | NO |
| `--color` | enum(always/never/auto) | Output color control | NO |

### Shared flags (inherited from SharedCliOptions)

| Flag | Type | Description | Adapter Support |
|------|------|-------------|-----------------|
| `-m` / `--model MODEL` | String | Model selection | YES (ctx.Model + ResolveModel) |
| `-i` / `--image FILE` | PathBuf (repeatable) | Attach image(s) to prompt | NO |
| `-s` / `--sandbox MODE` | enum(read-only, workspace-write, danger-full-access) | Sandbox policy | YES (via permission mode mapping) |
| `--yolo` / `--dangerously-bypass-approvals-and-sandbox` | bool | Skip all approval prompts | YES (via bypassPermissions) |
| `--dangerously-bypass-hook-trust` | bool | Run hooks without trust check | NO |
| `-C` / `--cd DIR` | PathBuf | Working directory | YES (ctx.WorkDir) |
| `--add-dir DIR` | PathBuf (repeatable) | Additional writable dirs | NO |
| `--oss` | bool | Use open-source provider | NO |
| `--local-provider` | String | Local provider (lmstudio/ollama) | NO |
| `-p` / `--profile NAME` | String | config.toml profile section | NO -- useful for Phase 2 |
| `--profile-v2 NAME` | ProfileV2Name | Layered config profile | NO -- modern alternative to sandbox |

### Exec subcommands

| Subcommand | Description | Adapter Relevance |
|------------|-------------|-------------------|
| `resume [--last] [SESSION_ID] [PROMPT]` | Resume a previous session | HIGH -- thread continuity |
| `review [--uncommitted|--base|--commit] [PROMPT]` | Code review against repo | MEDIUM -- specialized task |

## 1.2. Config Keys (`-c key=value`)

The `-c` flag accepts dotted-path TOML overrides. Key categories:

### Model & Generation
| Key | Value Type | Example | Adapter Support |
|-----|-----------|---------|-----------------|
| `model` | String | `-c model="gpt-5.2-codex"` | YES (hardcoded) |
| `model_reasoning_effort` | String | `-c model_reasoning_effort=high` | YES (hardcoded) |
| `service_tier` | String (fast/flex) | `-c service_tier=flex` | NO |
| `reasoning_summary` | String (auto/concise/detailed/none) | `-c reasoning_summary=concise` | NO |
| `verbosity` | String (low/medium/high) | `-c verbosity=high` | NO |
| `model_context_window` | int | `-c model_context_window=128000` | NO |
| `model_auto_compact_token_limit` | int | `-c model_auto_compact_token_limit=64000` | NO |

### Sandbox & Permissions
| Key | Value Type | Example | Adapter Support |
|-----|-----------|---------|-----------------|
| `sandbox_mode` | String | `-c sandbox_mode="workspace-write"` | YES (via --sandbox flag) |
| `permissions.*` | nested | `-c sandbox_permissions=["disk-full-read-access"]` | NO |
| `approvals_reviewer` | String (user/auto_review/guardian_subagent) | `-c approvals_reviewer=auto_review` | NO |

### Tools
| Key | Value Type | Example | Adapter Support |
|-----|-----------|---------|-----------------|
| `web_search_mode` | String (disabled/cached/live) | `-c web_search_mode=live` | NO |
| `web_search_tool_config.context_size` | String | `-c web_search_tool_config.context_size=high` | NO |
| `web_search_tool_config.allowed_domains` | Array | `-c web_search_tool_config.allowed_domains=["github.com"]` | NO |

### Multi-Agent / Collab
| Key | Value Type | Example | Adapter Support |
|-----|-----------|---------|-----------------|
| `agent_max_threads` | int | `-c agent_max_threads=6` | NO |
| `agent_max_depth` | int | `-c agent_max_depth=1` | NO |
| `multi_agent_v2.max_concurrent_threads_per_session` | int | `-c multi_agent_v2.max_concurrent_threads_per_session=4` | NO |
| `multi_agent_v2.default_wait_timeout_ms` | int | `-c multi_agent_v2.default_wait_timeout_ms=30000` | NO |

### Environment & Shell
| Key | Value Type | Description | Adapter Support |
|-----|-----------|-------------|-----------------|
| `shell_environment_policy.inherit` | String (core/all/none) | Env inheritance | NO |
| `shell_environment_policy.ignore_default_excludes` | bool | Keep KEY/SECRET/TOKEN vars | NO |
| `shell_environment_policy.set` | Table | Extra env vars | NO |
| `shell_environment_policy.use_profile` | bool | Source shell profile | NO |

### Personality & Instructions
| Key | Value Type | Description | Adapter Support |
|-----|-----------|-------------|-----------------|
| `personality` | String (none/friendly/pragmatic) | Agent personality | NO |
| `base_instructions` | String | Override base prompt | NO |
| `developer_instructions` | String | Extra developer prompt | NO |
| `hide_agent_reasoning` | bool | Suppress reasoning output | NO |

### Other
| Key | Value Type | Description | Adapter Support |
|-----|-----------|-------------|-----------------|
| `features.use_legacy_landlock` | bool (alias: use_legacy_landlock) | Legacy landlock | NO |
| `ephemeral` | bool | No session persistence | NO |
| `bypass_hook_trust` | bool | Skip hook trust | NO |
| `project_doc_max_bytes` | int | Max AGENTS.md bytes | NO |
| `tool_output_token_limit` | int | Token limit for tool outputs | NO |
| `cli_auth_credentials_store_mode` | String (file/keyring/auto) | Credential storage | NO |

## 1.3. Key Gaps in Current Adapter

1. **No generic `-c` passthrough**: The adapter hardcodes `model` and `model_reasoning_effort` only. A generic `-c` field in the RunProcessContext would let callers pass ANY config override.
2. **No image support**: `--image/-i` not passed through. Codex supports image attachments.
3. **No structured output**: `--output-schema` enables JSON Schema-constrained outputs -- highly useful for programmatic use.
4. **No thread continuity**: `resume` subcommand not supported. We always start fresh sessions.
5. **No ephemeral mode**: `--ephemeral` useful for stateless tasks where we don't want session persistence.
6. **No environment control**: `shell_environment_policy.*` not configurable.
7. **No web search control**: `web_search_mode` not configurable.
8. **No personality/instructions**: Cannot set `personality`, `base_instructions`, or `developer_instructions`.
9. **No service tier**: Cannot choose between `fast` and `flex` tiers.
10. **No multi-agent limits**: `agent_max_threads`, `agent_max_depth` not configurable.
