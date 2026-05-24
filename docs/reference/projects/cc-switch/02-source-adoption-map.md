# cc-switch Source Adoption Map → AgentHub

> 从 cc-switch Rust 源码到 AgentHub Go 实现的精确映射。
> 每项: cc-switch file:line → AgentHub file:line → 具体变更 → P0/P1/P2。

---

## 1. UniversalProvider → model_config.go 扩展

### 1.1 单层 model_config.go vs 三层 UniversalProvider

```
cc-switch: src-tauri/src/provider.rs:402-447
  pub struct UniversalProvider {
      id, name, provider_type, apps: UniversalProviderApps { claude, codex, gemini }
      base_url, api_key, models: UniversalProviderModels {
          claude: ClaudeModelConfig { main, haiku, sonnet, opus }
          codex: CodexModelConfig { model, reasoning_effort }
          gemini: GeminiModelConfig { model }
      }
  }

AgentHub: edge-server/internal/adapters/model_config.go:1-93
  var ModelAliases = map[string]map[string]string  // agent → {shortName → fullID}
  var DefaultModels = map[string]string
  func ResolveModel(agentID, model string) string
```

**差异**: AgentHub 的 `ModelAliases` 仅是短名→全名的映射表，无 API base URL/API key 的管理。cc-switch 提供完整的三层模型：供应商 (base_url + api_key) → App (claude/codex/gemini 启用开关) → Models (每 app 的独立模型配置)。AgentHub 完全依赖 CLI 自身的环境变量读取 API key/URL。

**建议 P0**: 引入 `Provider` 配置结构，支持集中管理 API key + base URL，然后在 `BuildCommand` 中注入为环境变量。

```go
// edge-server/internal/adapters/provider_config.go 新增
type ProviderConfig struct {
    ID      string
    Name    string
    BaseURL string
    APIKey  string
    Apps    map[string]ProviderAppConfig  // "claude-code" / "codex" / "opencode"
}

type ProviderAppConfig struct {
    Enabled bool
    Model   string
    Models  map[string]string  // opus, sonnet, haiku, etc.
}
```

### 1.2 Claude 四个独立模型环境变量

```
cc-switch: src-tauri/src/provider.rs:496-504
  ANTHROPIC_MODEL → 主模型
  ANTHROPIC_DEFAULT_HAIKU_MODEL → Haiku
  ANTHROPIC_DEFAULT_SONNET_MODEL → Sonnet
  ANTHROPIC_DEFAULT_OPUS_MODEL → Opus

AgentHub: edge-server/internal/adapters/claude_code.go:54-81
  BuildCommand 仅注入 --model 参数，单模型。Claude Code CLI 自动从环境变量读取子模型。
```

**差异**: AgentHub 单模型注入意味着 Claude Code 的所有子模型切换（如 Task agent 用 Haiku）使用同一模型，无法独立配置。

**建议 P1**: 在 `ClaudeCodeAdapter` 的 `BuildCommand` 中注入 4 个独立环境变量。当用户配置了子模型时设置，未配置时 fallback 到主模型。

```go
// edge-server/internal/adapters/claude_code.go 修改 BuildCommand
env = append(env, "ANTHROPIC_MODEL="+model)
if haikuModel != "" { env = append(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL="+haikuModel)
} else { env = append(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL="+model) }
// ... 同 pattern for sonnet / opus
```

### 1.3 Codex base_url /v1 后缀智能判断

```
cc-switch: src-tauri/src/provider.rs:537-549
  let base_trimmed = self.base_url.trim_end_matches('/');
  let codex_base_url = if base_trimmed.ends_with("/v1") {
      base_trimmed.to_string()       // 已有 /v1 → 保持
  } else if origin_only {
      format!("{base_trimmed}/v1")  // 纯 origin → 追加 /v1
  } else {
      base_trimmed.to_string()       // 自定义路径 → 不追加
  };

AgentHub: edge-server/internal/adapters/codex.go
  无 base_url 配置逻辑。Codex CLI 从自身 config.toml 读取。
```

**建议 P1**: 当引入 `ProviderConfig` 后，在 `CodexAdapter.BuildCommand` 中实现相同的 base_url 智能后缀逻辑。

```go
func buildCodexBaseURL(rawURL string) string {
    u, _ := url.Parse(strings.TrimRight(rawURL, "/"))
    if strings.HasSuffix(u.Path, "/v1") { return u.String() }
    if u.Path == "" || u.Path == "/" { return u.String() + "/v1" }
    return u.String()
}
```

---

## 2. Agent-aware settings_config 差异化结构

### 2.1 env 模式 (Claude/Gemini) vs auth+config 模式 (Codex)

```
cc-switch: src-tauri/src/provider.rs
  Claude settings_config → {"env": {ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ...}}
  Codex settings_config  → {"auth": {OPENAI_API_KEY}, "config": "<TOML string>"}

AgentHub: edge-server/internal/adapters/model_config.go
  ResolveModel() 仅映射 model 名称，不处理 API 配置的差异化编码。
```

**差异**: cc-switch 针对每个 Agent 的配置格式做了深度耦合——Claude 用 env 变量、Codex 用 auth.json + config.toml 双文件。AgentHub 没有这一层——API 配置完全委托给 CLI 自身。

**建议 P1**: 在 `ProviderAppConfig` 中引入 `ConfigFormat` 字段标记配置策略 (env / auth_json / toml)，并在 `BuildCommand` 中按格式注入。

---

## 3. Live 文件双向同步

```
cc-switch: src-tauri/src/services/provider/live.rs
  写入链路 (SSOT → Live): build_effective_settings → write_live_snapshot → 磁盘
  回填链路 (Live → SSOT): read_live_settings → strip_common_config → SQLite

AgentHub: 无双向同步。Edge Server 仅写入 CLI 子进程的 env/args，不读取或管理 CLI 自身的配置文件。
```

**建议 P2**: 当 AgentHub 引入集中式 Provider 配置后，实现单向写入（Provider 配置 → CLI native 配置文件）。优先实现 Claude (`~/.claude/settings.json`) 的写入。

---

## 4. OpenCode npm 包配置模型

```
cc-switch: src-tauri/src/provider.rs:690-719
  pub struct OpenCodeModel {
      name, limit: OpenCodeModelLimit { context, output },
      options: HashMap<String, Value>,
      extra: HashMap<String, Value>  // cost, modalities, thinking, variants
  }

AgentHub: edge-server/internal/adapters/opencode.go
  当前 OpenCode adapter 为 Phase 1 实现（通过 CLI 命令传参）。不管理 opencode.json 的 provider 模型定义。
```

**建议 P2**: 在 `OpenCodeAdapter` 中增加 `opencode.json` provider 写入能力。OpenCode 配置中的 `npm` 字段 (`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`) 是关键路由信息，需要暴露为配置选项。

---

## 5. 通用配置片段机制

```
cc-switch: src-tauri/src/services/provider/live.rs:479-502
  Claude: json_deep_merge 片段到 settings_config
  Codex:  merge_toml_table_like 片段到 config TOML AST
  Gemini: json_deep_merge 到 settings_config 的 env 子对象

AgentHub: 无等价物。所有 agent 共享同一套 env 过滤 (SanitizedEnv)，无 per-app 通用片段。
```

**建议 P2**: 引入 `CommonConfigFragment` 概念——用户定义一段跨 agent 共享的配置（如 MCP servers list），Edge Server 在 `BuildCommand` 时为每个 agent 做格式适配后注入。

---

## 6. 冷启动导入 (现有 CLI 配置回填)

```
cc-switch: src-tauri/src/services/provider/live.rs:1014-1109
  import_default_config(state, app_type):
    Claude → 读取 ~/.claude/settings.json → 解析为 Provider
    Codex  → 读取 ~/.codex/auth.json + config.toml → Provider
    Gemini → 读取 ~/.gemini/.env + settings.json → Provider

AgentHub: 无等价物。首次启动时不读取用户已有的 CLI 配置。
```

**建议 P2**: 在 hub-server 初始化时扫描用户已有的 Claude/Codex 配置，自动填充 AgentHub 的 Provider 配置（若 `ProviderConfig` 引入后）。

---

## 7. api_format 桥接 (Claude Anthropic ↔ OpenAI 格式)

```
cc-switch: src-tauri/src/provider.rs
  ProviderMeta.api_format → "anthropic" (默认) | "openai_chat" | "openai_responses"
  ProviderMeta.prompt_cache_key → 用于 openai_responses 模式注入缓存键

AgentHub: edge-server/internal/adapters/model_config.go
  无 API 格式概念。假设所有调用使用原生 Anthropic API。
```

**建议 P2**: 在 `ClaudeCodeAdapter` 中支持 `ANTHROPIC_API_FORMAT` 环境变量注入，允许通过 OpenAI-compatible 端点调用 Claude 模型。

---

## 8. 原子写入策略

```
cc-switch: src-tauri/src/config.rs
  临时文件 + rename 保证原子性 → 杜绝配置文件半写损坏
  对 Codex 双文件 (auth.json + config.toml) 实现回滚机制

AgentHub: 无配置文件写入逻辑。若引入 Provider 配置写入到 CLI native 文件时需实现。
```

**建议 P2**: 在引入 Provider → CLI 配置文件写入链路时，使用 Go 的标准原子写入模式：

```go
func AtomicWriteJSON(path string, data any) error {
    tmpPath := path + ".tmp." + strconv.FormatInt(time.Now().UnixNano(), 36)
    f, _ := os.Create(tmpPath)
    json.NewEncoder(f).Encode(data)
    f.Close()
    return os.Rename(tmpPath, path)
}
```

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | UniversalProvider 三层模型 | **P0** | 新增 `adapters/provider_config.go` |
| 2 | Claude 4 个独立模型环境变量 | **P1** | `adapters/claude_code.go:54-81` |
| 3 | Codex base_url /v1 后缀智能处理 | **P1** | `adapters/codex.go` |
| 4 | settings_config 差异化结构 | **P1** | `adapters/claude_code.go`, `adapters/codex.go` |
| 5 | Live 文件双向同步 | **P2** | hub-server config 模块 |
| 6 | OpenCode npm 包 provider 配置 | **P2** | `adapters/opencode.go` |
| 7 | 通用配置片段机制 | **P2** | 新增 `adapters/common_config.go` |
| 8 | 冷启动 CLI 配置导入 | **P2** | hub-server `api/` |
| 9 | api_format 桥接 | **P2** | `adapters/claude_code.go` |
| 10 | 原子写入工具函数 | **P2** | 新增 `internal/lib/atomic_write.go` |
