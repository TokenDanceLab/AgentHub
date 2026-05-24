# AgentHub CLI 命令系统与安装向导

> 日期: 2026-05-21
> 依据: design-desktop-ux.md（第 1、5 节）、design-go-services.md（cmd/ 设计）、design-adapter-sdk.md（注册）、web-research-tech-stack.md（Tauri + cobra）
> Web 调研: DataRobot `dr start`、Canopy IDE 自动检测、AgentWire 3 问向导、Turbo Flow wizard.sh、@itz4blitz/agentful `/agentful-init`

---

## 1. CLI 架构

### 1.1 二进制身份

Go 二进制 `agenthub` 承担三种角色：

| 角色 | 上下文 | 入口点 |
|------|---------|-------------|
| **CLI 工具** | 用户在终端直接运行 | `cmd/agenthub/main.go`（cobra root） |
| **Tauri sidecar** | 通过 shell 插件由 Tauri 桌面应用启动 | 同一二进制，`agenthub serve` 模式 |
| **后台守护进程** | Edge + Runner 作为长期运行进程 | `agenthub serve --daemon` |

单一二进制，三种人格。Tauri shell 插件将 `agenthub serve` 作为 sidecar 启动，读取 `LISTEN_PORT=<n>` stdout 行，随后 React 前端通过 `http://127.0.0.1:<n>` 与之通信。

### 1.2 Cobra 命令树

```
agenthub
├── init              # 首次运行向导
├── doctor            # 环境诊断
├── serve             # 启动 Edge + Runner（后台）
├── hub               # 连接到远程 Hub
├── run               # 单次提示词执行
├── logs              # 跟踪执行日志
├── status            # 查看运行中任务
├── stop              # 停止运行中任务
├── config            # 管理配置
└── version           # 打印版本信息
```

`cmd/agenthub/main.go`:

```go
package main

import (
    "github.com/agenthub/agenthub/cli"
)

func main() {
    cli.Execute()
}
```

`cli/root.go`:

```go
package cli

import (
    "github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
    Use:   "agenthub",
    Short: "AgentHub -- multi-agent desktop command center",
    Long: `AgentHub manages local AI agents (Claude Code, Codex, OpenCode)
through a unified CLI and desktop UI.

Run 'agenthub init' to get started.`,
    SilenceUsage: true,
}

func Execute() {
    rootCmd.Execute()
}

func init() {
    rootCmd.AddCommand(initCmd)
    rootCmd.AddCommand(doctorCmd)
    rootCmd.AddCommand(serveCmd)
    rootCmd.AddCommand(hubCmd)
    rootCmd.AddCommand(runCmd)
    rootCmd.AddCommand(logsCmd)
    rootCmd.AddCommand(statusCmd)
    rootCmd.AddCommand(stopCmd)
    rootCmd.AddCommand(configCmd)
    rootCmd.AddCommand(versionCmd)
}
```

### 1.3 全局标志

所有命令共享以下持久标志：

| 标志 | 环境变量 | 默认值 | 描述 |
|------|---------|---------|-------------|
| `--config` | `AGENTHUB_CONFIG` | `~/.agenthub/config.yaml` | 配置文件路径 |
| `--data-dir` | `AGENTHUB_DATA_DIR` | `~/.agenthub/` | 数据目录（DB、日志、运行时） |
| `--verbose` | `AGENTHUB_VERBOSE` | `false` | 启用调试日志 |
| `--json` | -- | `false` | 以 JSON 输出（用于脚本） |

---

## 2. 命令规格

### 2.1 `agenthub init` -- 首次运行向导

参考: AgentWire（3 个最小问题）、Turbo Flow（项目类型 + 功能选择）、@itz4blitz/agentful（7 问交互式）。

**3 步交互式向导。** 首次 `agenthub serve` 时若无配置则自动运行。

```
agenthub init [flags]

Flags:
  --non-interactive     跳过提示，使用默认值 + 环境变量
  --accept-defaults     接受所有自动检测的默认值
  --workspace <path>    默认工作区路径
  --force               覆盖现有配置
  --skip-agent-check    跳过 CLI 二进制检测（离线模式）

Aliases:
  agenthub setup
```

#### 第 1 步：环境检测

自动检测并显示：

```
AgentHub Setup
==============

Step 1/3: Environment Detection

  Claude Code CLI    claude --version    2.1.139    /usr/local/bin/claude
  Codex CLI          codex --version     0.132.0    /usr/local/bin/codex
  Git                git --version       2.47.0     /usr/bin/git
  Go                 go version          1.24.0     /usr/local/go/bin/go

  All agents detected. Ready to proceed.

  [Enter to continue, or type agent name to configure]
```

检测逻辑（Go 实现）：

```go
// cli/internal/detect/detect.go
type DetectionResult struct {
    Binary   string `json:"binary"`   // "claude", "codex", "git", "go"
    Name     string `json:"name"`     // "Claude Code CLI"
    Found    bool   `json:"found"`
    Version  string `json:"version,omitempty"`
    Path     string `json:"path,omitempty"`
    Hint     string `json:"hint,omitempty"`   // 未找到时的安装提示
}

func DetectAll() []DetectionResult {
    return []DetectionResult{
        detectBinary("claude", "Claude Code CLI", []string{"claude"}, "--version", `npm install -g @anthropic-ai/claude-code`),
        detectBinary("codex", "Codex CLI", []string{"codex"}, "--version", `npm install -g @openai/codex`),
        detectBinary("git", "Git", []string{"git"}, "--version", `https://git-scm.com/downloads`),
        detectBinary("go", "Go", []string{"go"}, "version", `https://go.dev/dl/`),
    }
}
```

若二进制缺失，显示内联安装提示（Canopy IDE 模式）：

```
  Codex CLI          NOT FOUND
    Hint: npm install -g @openai/codex
    Skip for now? [Y/n]
```

#### 第 2 步：API 密钥配置

```
Step 2/3: API Keys

  ANTHROPIC_API_KEY  [set from env]      ********-****-sk-ant-***
  OPENAI_API_KEY     [not set]
    Enter key (or press Enter to skip): █

  At least one API key is required. Keys are stored in:
    ~/.agenthub/secrets.yaml (chmod 600)

  [Enter to continue]
```

密钥存储：

```yaml
# ~/.agenthub/secrets.yaml（权限: 0600）
anthropic_api_key: "sk-ant-..."
openai_api_key: "sk-..."
```

密钥绝不在 `config.yaml` 中存储。`secrets.yaml` 文件遵循 `.gitignore` 惯例，在 Unix 上以 `0600` 权限（Windows：受限 ACL）创建。

验证：每个密钥通过轻量 API 调用测试（如 Anthropic 使用 `claude -p "say hi" --max-turns 1`，OpenAI 使用 `codex exec --prompt "say hi" --max-turns 1`）。若验证失败，显示错误并允许重新输入。

#### 第 3 步：默认工作区

```
Step 3/3: Default Workspace

  Workspace is the root directory where AgentHub agents operate.
  Detected: C:\Users\Ding\Projects

  Use this directory? [Y/n / enter custom path]: █

  (You can add more workspaces later with 'agenthub config workspace add')
```

若检测到的路径不存在，提示创建。

#### 完成

```
Setup Complete!
===============

  Config:     ~/.agenthub/config.yaml
  Secrets:    ~/.agenthub/secrets.yaml
  Data:       ~/.agenthub/data/
  Runtime:    ~/.agenthub/runtime/

  Next steps:
    agenthub doctor     Verify everything is working
    agenthub serve      Start AgentHub locally
    agenthub run -p "explain this project"   Try a quick prompt
```

生成的 `~/.agenthub/config.yaml`：

```yaml
# AgentHub configuration
# Generated by: agenthub init (2026-05-21T...)

version: 1

# Detected agent CLIs
agents:
  claude-code:
    path: /usr/local/bin/claude
    version: "2.1.139"
  codex:
    path: /usr/local/bin/codex
    version: "0.132.0"

# Default workspace
workspace:
  default: /home/user/Projects

# Edge server settings
edge:
  port: 3210
  ws_port: 3210

# Runner settings
runner:
  port: 39731

# Preview server port range
preview:
  port_start: 5100
  port_end: 5199

# Logging
logging:
  level: info
  file: ~/.agenthub/logs/agenthub.log
```

#### 非交互模式

```
agenthub init --non-interactive --workspace /home/user/Projects
```

从环境变量（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`）读取 API 密钥，自动检测二进制，接受默认值。若缺少先行条件则失败并给出明确错误信息（AgentWire 模式：交互式 15+ 问题精简为 3 个，`--non-interactive` 标志用于脚本）。

---

### 2.2 `agenthub doctor` -- 诊断

参考: Canopy IDE 自动检测模式（检测 Claude/Codex/Gemini CLI 可用性）。

```
agenthub doctor [flags]

Flags:
  --json          以 JSON 输出（脚本默认）
  --check-ports   同时检查端口可用性
  --fix           尝试自动修复常见问题

Aliases:
  agenthub check
  agenthub diagnose
```

#### 人类可读输出

```
AgentHub Doctor
===============

  [PASS] Claude Code CLI   2.1.139    /usr/local/bin/claude
  [PASS] Codex CLI         0.132.0    /usr/local/bin/codex
  [PASS] Git               2.47.0     /usr/bin/git
  [PASS] Go                1.24.0     /usr/local/go/bin/go

  [PASS] ANTHROPIC_API_KEY set and valid (tested)
  [WARN] OPENAI_API_KEY    not set (Codex adapter unavailable)

  [PASS] Port 3210  (Edge API)    free
  [PASS] Port 3211  (Hub API)     free
  [PASS] Port 39731 (Runner API)  free

  [PASS] SQLite       modernc.org/sqlite (embedded)
  [PASS] Config       ~/.agenthub/config.yaml
  [PASS] Data dir     ~/.agenthub/data/ (writable)
  [PASS] Runtime dir  ~/.agenthub/runtime/ (writable)

  [INFO] Git config: user.name="Ding", user.email="..."

  8 passed, 1 warning, 0 errors
```

#### JSON 输出

```json
{
  "timestamp": "2026-05-21T10:30:00Z",
  "results": {
    "claude_code": {
      "installed": true,
      "version": "2.1.139",
      "path": "/usr/local/bin/claude",
      "status": "pass"
    },
    "codex": {
      "installed": true,
      "version": "0.132.0",
      "path": "/usr/local/bin/codex",
      "status": "pass"
    },
    "git": {
      "installed": true,
      "version": "2.47.0",
      "path": "/usr/bin/git",
      "status": "pass",
      "config": {
        "user.name": "Ding",
        "user.email": "ding@example.com"
      }
    },
    "go": {
      "installed": true,
      "version": "1.24.0",
      "path": "/usr/local/go/bin/go",
      "status": "pass"
    },
    "ports": {
      "3210": "free",
      "3211": "free",
      "39731": "free"
    },
    "api_keys": {
      "anthropic": "set",
      "openai": "missing"
    },
    "sqlite": {
      "available": true,
      "driver": "modernc.org/sqlite"
    },
    "directories": {
      "config": {"path": "~/.agenthub/config.yaml", "exists": true, "writable": true},
      "data": {"path": "~/.agenthub/data/", "exists": true, "writable": true},
      "runtime": {"path": "~/.agenthub/runtime/", "exists": true, "writable": true}
    }
  },
  "summary": {
    "passed": 8,
    "warnings": 1,
    "errors": 0
  }
}
```

#### 检查项目

| 检查 | 检测方法 | 失败提示 |
|-------|-----------------|--------------|
| `claude_code` | `claude --version`（stdout 解析） | `npm install -g @anthropic-ai/claude-code` |
| `codex` | `codex --version`（stdout 解析） | `npm install -g @openai/codex` |
| `git` | `git --version` | `https://git-scm.com/downloads` |
| `go` | `go version` | `https://go.dev/dl/` |
| `anthropic_key` | `ANTHROPIC_API_KEY` env + 轻量测试 | 设置 env var 或添加到 `secrets.yaml` |
| `openai_key` | `OPENAI_API_KEY` env + 轻量测试 | 设置 env var 或添加到 `secrets.yaml` |
| `ports` | `net.Listen("tcp", ":PORT")` 探针 | 释放端口或配置替代端口 |
| `sqlite` | `sql.Open("sqlite", ":memory:")` | 内嵌 -- 永不应失败 |
| `directories` | `os.Stat()` + `os.MkdirAll()` 测试写入 | 检查权限 |

#### --fix 模式

```
agenthub doctor --fix
```

自动修复：
- 创建缺失的 `~/.agenthub/` 目录结构
- 设置 `secrets.yaml` 的 `0600` 权限
- 初始化 `~/.agenthub/data/agenthub.db` 的 SQLite WAL 数据库
- 若缺失则生成默认 `config.yaml`（非破坏性 -- 若已存在则提示）

---

### 2.3 `agenthub serve` -- 启动 Edge + Runner

参考: design-go-services.md `cmd/edge/main.go` + `cmd/runner/main.go`（本地桌面合并为单进程）。

```
agenthub serve [flags]

Flags:
  --edge-port <port>       Edge API 端口（默认: 3210）
  --runner-port <port>     Runner API 端口（默认: 39731）
  --hub-url <url>          连接远程 Hub（可选）
  --no-browser             启动时不打开浏览器
  --daemon                 作为后台守护进程运行（脱离终端）
  --log-file <path>        日志文件路径
  --dev                    开发模式（详细日志、CORS *）

Aliases:
  agenthub start
  agenthub up
```

#### 行为

1. 从 `~/.agenthub/config.yaml` 加载配置
2. 从 `~/.agenthub/secrets.yaml` 加载密钥
3. 初始化 `~/.agenthub/data/agenthub.db` 的 SQLite 数据库
4. 运行数据库迁移
5. 注册内置 adapter（claude-code、codex、opencode）
6. 从 `~/.agenthub/adapters/` 发现外部 adapter
7. 在 `127.0.0.1:39731` 上启动 Runner HTTP 服务器
8. 在 `127.0.0.1:3210` 上启动 Edge HTTP 服务器
9. 若提供 `--hub-url`，Edge 连接到 Hub（反向 WSS）
10. 打印端口到 stdout 供 Tauri sidecar 检测：

```
LISTEN_PORT=3210
AgentHub Edge ready: http://127.0.0.1:3210
  Runner: http://127.0.0.1:39731
  WS:     ws://127.0.0.1:3210/ws
  Logs:   ~/.agenthub/logs/agenthub.log
```

由 Tauri 启动时，Rust 端读取 `LISTEN_PORT=3210` 并将 webview 连接到 `http://127.0.0.1:3210`。从终端启动时，可选择打开浏览器到 Web UI。

#### 优雅关闭

- SIGINT/SIGTERM: 取消所有运行中的 agent 进程（SIGTERM 5s 宽限期，然后 SIGKILL -- CloudCLI 两阶段模式）
- 将待处理状态保存到 SQLite
- 关闭 WebSocket 连接
- 退出

#### 守护进程模式

```
agenthub serve --daemon
```

脱离终端。PID 写入 `~/.agenthub/runtime/agenthub.pid`。日志写入 `~/.agenthub/logs/agenthub.log`。

```
agenthub serve --daemon --stop    # 停止运行中的守护进程
agenthub serve --daemon --status  # 检查守护进程是否运行
```

---

### 2.4 `agenthub hub` -- 连接远程 Hub

```
agenthub hub [flags]

Flags:
  --url <url>         Hub server URL（默认: 来自配置）
  --token <token>     认证 token
  --register          向 Hub 注册此 Edge
  --name <name>       Edge 显示名称

Subcommands:
  agenthub hub connect     连接到 Hub
  agenthub hub disconnect  断开 Hub 连接
  agenthub hub status      显示 Hub 连接状态
```

用于 P1+ Hub 集成。在 P0（仅桌面），这是一个桩，打印 "Hub connection requires AgentHub Hub Server (P1+)."

---

### 2.5 `agenthub run` -- 单次提示词执行

参考: `claude -p` 无头模式、DataRobot `dr start`。

```
agenthub run [flags]

Flags:
  -p, --prompt <text>      要执行的提示词（必需）
  -a, --agent <name>       使用的 Agent: claude-code、codex、opencode（默认: claude-code）
  -m, --model <name>       模型覆盖
  -w, --workspace <path>   工作区路径（默认: 配置默认值）
  --max-turns <n>          最大 turns（默认: 25）
  --permission-mode <mode> 权限模式: default、accept-edits、bypass（默认: default）
  -o, --output <format>    输出格式: text、stream-json、json（默认: text）
  --no-stream              禁用流式输出
  --resume <session-id>    恢复之前的会话
  --tools <list>           允许的工具（逗号分隔）

Aliases:
  agenthub exec
  agenthub ask
```

#### 行为

1. 验证指定 agent 可用（二进制存在、API 密钥已设置）
2. 创建临时 Run 会话
3. 调用 Runner API（`POST /runs`）
4. 将输出流式传输到终端（或返回结构化 JSON）

```
$ agenthub run -p "What is 2+2?"
Using claude-code (Claude 4.5) on workspace ~/Projects...

2 + 2 = 4

Done. 1 turn, 42 input tokens, 8 output tokens (0.3s)

$ agenthub run -p "Create a hello.py script" -a codex
Using codex (GPT-5) on workspace ~/Projects...

Created hello.py (14 lines)
  Write: hello.py (+14/-0)

Done. 3 turns, 245 input tokens, 180 output tokens (2.1s)
```

#### JSON 输出模式

```
agenthub run -p "..." -o json
```

```json
{
  "run_id": "run_abc123",
  "agent": "claude-code",
  "model": "claude-sonnet-4-5",
  "status": "completed",
  "turns": 3,
  "messages": [...],
  "usage": {
    "input_tokens": 245,
    "output_tokens": 180,
    "cost_usd": 0.0042
  },
  "duration_ms": 2100,
  "files_changed": ["hello.py"],
  "diff": "+14/-0"
}
```

---

### 2.6 `agenthub logs` -- 跟踪执行日志

```
agenthub logs [run-id] [flags]

Flags:
  -f, --follow       跟随日志输出（tail -f）
  -n, --lines <n>    显示行数（默认: 50）
  --agent <name>     按 agent 过滤
  --status <status>  按状态过滤（running、completed、failed）
  --since <time>     显示自指定时间起的日志（如 1h、30m、2026-05-21）

Aliases:
  agenthub tail
```

#### 行为

从 SQLite `runs` 表和/或 `~/.agenthub/logs/` 中的日志文件读取。

```
$ agenthub logs
Recent runs (last 10):
  run_abc123  claude-code  completed  05-21 10:30   "Create hello.py"   2.1s
  run_def456  codex        failed     05-21 10:25   "Fix auth bug"      15.3s
  run_ghi789  claude-code  completed  05-21 10:20   "Explain project"   0.8s

$ agenthub logs run_abc123
[2026-05-21T10:30:01Z] Run started: claude-code, model=claude-sonnet-4-5
[2026-05-21T10:30:01Z] Turn 1: User -> "Create a hello.py script"
[2026-05-21T10:30:02Z] Turn 1: Claude -> ToolUse: Write(hello.py)
[2026-05-21T10:30:02Z] Turn 1: Claude -> Text: "I've created hello.py..."
[2026-05-21T10:30:03Z] Run completed: 3 turns, usage=245/180, 2.1s

$ agenthub logs -f --agent claude-code
Tailing logs for claude-code...
[... live output ...]
```

---

### 2.7 `agenthub status` -- 查看运行中任务

```
agenthub status [flags]

Flags:
  --watch         监视模式（每 2s 自动刷新）

Aliases:
  agenthub ps
```

#### 输出

```
$ agenthub status
AgentHub Edge: http://127.0.0.1:3210 [running]
Runner: http://127.0.0.1:39731 [running]

Active runs:
  run_abc123  claude-code  running    05-21 10:30:15  "Refactor database..."  12.3s
  run_def456  codex        queued      05-21 10:30:18  "Write tests for auth"  --

Agents available:
  claude-code  v2.1.139  /usr/local/bin/claude   [ANTHROPIC_API_KEY set]
  codex        v0.132.0  /usr/local/bin/codex    [OPENAI_API_KEY missing]
```

---

### 2.8 `agenthub stop` -- 停止运行中任务

```
agenthub stop <run-id> [flags]

Flags:
  --all           停止所有运行中任务
  --force         强制杀死（SIGKILL，跳过优雅关闭）

Aliases:
  agenthub kill
  agenthub cancel
```

#### 行为

向 Runner API 发送取消请求（`DELETE /runs/:id`）。Runner 向 agent 子进程发送 SIGTERM，等待 5s，若仍存活则 SIGKILL。

```
$ agenthub stop run_abc123
Stopping run_abc123... done (graceful, 2.1s)

$ agenthub stop --all
Stopping 2 runs:
  run_abc123... done (graceful, 0.8s)
  run_def456... done (forced, 0.1s)
All runs stopped.
```

---

### 2.9 `agenthub config` -- 配置管理

```
agenthub config [subcommand] [flags]

Subcommands:
  agenthub config show               显示当前配置
  agenthub config get <key>          获取特定配置值
  agenthub config set <key> <value>  设置配置值
  agenthub config workspace          管理工作区
  agenthub config agent              管理 agent 配置
  agenthub config edit               在 $EDITOR 中打开配置

Workspace 子命令:
  agenthub config workspace list
  agenthub config workspace add <path> [--name <name>]
  agenthub config workspace remove <name>
  agenthub config workspace default <name>

Agent 子命令:
  agenthub config agent list
  agenthub config agent add <name> --binary <path>
  agenthub config agent remove <name>
  agenthub config agent default <name>
```

#### 示例

```
$ agenthub config show
version: 1
agents:
  claude-code:
    path: /usr/local/bin/claude
    version: "2.1.139"
  codex:
    path: /usr/local/bin/codex
    version: "0.132.0"
workspace:
  default: /home/user/Projects
edge:
  port: 3210
runner:
  port: 39731

$ agenthub config set edge.port 3220
edge.port = 3220 (restart agenthub serve to apply)

$ agenthub config workspace list
* default    /home/user/Projects     (default)
  oss        /home/user/oss
  sandbox    /tmp/agenthub-sandbox

$ agenthub config workspace add ~/work/website --name website
Workspace "website" added: /home/user/work/website

$ agenthub config agent list
* claude-code  /usr/local/bin/claude    v2.1.139
  codex        /usr/local/bin/codex     v0.132.0
```

---

### 2.10 `agenthub version` -- 版本信息

```
agenthub version [flags]

Flags:
  --short     仅打印版本号
  --json      JSON 输出
```

```
$ agenthub version
AgentHub 0.1.0 (2026-05-21)
  Platform:  windows/amd64
  Go:        go1.24.0
  Commit:    abc1234

$ agenthub version --json
{"version":"0.1.0","date":"2026-05-21","platform":"windows/amd64","go":"go1.24.0","commit":"abc1234"}
```

---

## 3. `agenthub init` 向导 -- 完整流程设计

### 3.1 状态机

```
              ┌──────────────────────────┐
              │  入口: agenthub init       │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  检查: 现有配置？          │
              │  是（无 --force）─────────┼────► "Config exists. Use --force to overwrite."
              │  否 或 --force            │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  第 1 步: 检测环境         │
              │  - 查找二进制              │
              │  - 显示版本                │
              │  - 提供安装提示            │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  第 2 步: API 密钥         │
              │  - 先检查环境变量          │
              │  - 提示缺失项              │
              │  - 验证每个密钥            │
              │  - 保存到 secrets.yaml     │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  第 3 步: 工作区            │
              │  - 从 CWD 自动检测         │
              │  - 接受或输入自定义         │
              │  - Git 仓库检测            │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  写入 config.yaml          │
              │  写入 secrets.yaml         │
              │  初始化 DB + 迁移          │
              │  打印摘要                  │
              └──────────────────────────┘
```

### 3.2 --non-interactive 流程

用于 CI/CD、Docker 和自动化设置：

```
agenthub init --non-interactive [--workspace /path] [--accept-defaults]
```

1. 从环境变量读取 `ANTHROPIC_API_KEY` 和 `OPENAI_API_KEY`
2. 自动检测二进制路径（若至少一个 agent 未找到则失败，除非 `--skip-agent-check`）
3. 使用 `--workspace`（若提供），否则 `$HOME/Projects`，否则 `$PWD`
4. 无需提示，直接写入配置和密钥
5. 成功时 exit 0，失败时 exit 1 并附带消息

### 3.3 Tauri 集成

当 AgentHub 作为 Tauri 桌面应用运行时，"首次启动"体验使用相同的 `agenthub init` 逻辑，但通过 React UI 渲染（来自 design-desktop-ux.md 第 1 节的 ProjectSelector / 欢迎视图）：

1. Tauri 将 `agenthub serve` 作为 sidecar 启动
2. 若配置不存在，`agenthub serve` 返回特殊 stdout 行: `SETUP_REQUIRED=1`
3. Tauri 读取此信息并显示 React 欢迎/设置流程而非主 UI
4. React UI 通过 Tauri command 调用 `agenthub init --non-interactive`，传入用户提供的值
5. 完成后，Tauri 以 `agenthub serve` 重启 sidecar

桌面 UX 流程（design-desktop-ux.md）：

```
ProjectSelector（欢迎视图，P0）
├── RecentProjectList（首次运行时为空）
├── ProjectCard（首次运行时不显示）
├── NewProjectDialog（首次运行: "Welcome to AgentHub"）
│   ├── 第 1 步: Agent 检测（从 'agenthub doctor --json' 自动填充）
│   ├── 第 2 步: API 密钥输入（密码字段）
│   └── 第 3 步: 选择工作区（通过 Tauri dialog.open 的文件夹选择器）
└── OpenFolderButton
```

---

## 4. 实现说明

### 4.1 包布局

```
cli/                          # Cobra CLI 包
├── root.go                   # Root 命令 + 全局标志
├── init.go                   # agenthub init
├── doctor.go                 # agenthub doctor
├── serve.go                  # agenthub serve
├── hub.go                    # agenthub hub
├── run.go                    # agenthub run
├── logs.go                   # agenthub logs
├── status.go                 # agenthub status
├── stop.go                   # agenthub stop
├── config.go                 # agenthub config
├── version.go                # agenthub version
└── internal/
    ├── detect/
    │   └── detect.go         # 二进制 + env 检测
    ├── wizard/
    │   └── wizard.go         # 交互式向导引擎
    ├── secret/
    │   └── secret.go         # secrets.yaml 读/写
    └── output/
        ├── table.go          # 终端表格格式化
        └── json.go           # JSON 输出辅助
```

### 4.2 依赖

```
go.mod 新增:
  github.com/spf13/cobra      # CLI 框架
  github.com/spf13/viper      # 配置管理（读取 config.yaml）
  github.com/charmbracelet/bubbletea  # 可选: 交互式向导的 TUI
  gopkg.in/yaml.v3            # YAML 解析/生成
  modernc.org/sqlite          # 项目中已有
```

### 4.3 配置文件优先级（Viper）

```
1. 命令行标志（最高优先级）
2. 环境变量（AGENTHUB_*）
3. ~/.agenthub/config.yaml
4. 代码中的默认值（最低优先级）
```

### 4.4 端口分配策略

| 端口 | 组件 | 回退策略 |
|------|-----------|-------------------|
| 3210 | Edge API + WS | 尝试 3210，然后依次尝试 3211-3220 |
| 3211 | Hub API（如本地） | 尝试 3211，然后依次尝试 3212-3220 |
| 39731 | Runner API | 尝试 39731，然后依次尝试 39732-39740 |
| 5100-5199 | Preview 服务器 | 从池中分配 |
| 3000 | Web UI（仅开发） | Vite 默认 |

端口冲突在 `agenthub doctor` 中检测，可通过 `agenthub config set edge.port <n>` 配置。

### 4.5 安全边界

| 数据 | 存储 | 权限 | 同步到 Hub？ |
|------|---------|-------------|-------------|
| `config.yaml` | `~/.agenthub/` | 0644 | 否 |
| `secrets.yaml` | `~/.agenthub/` | 0600（Unix）/ 受限 ACL（Windows） | 永不 |
| `agenthub.db` | `~/.agenthub/data/` | 0644 | 仅当连接 Hub（P1+） |
| 日志 | `~/.agenthub/logs/` | 0644 | 否 |
| 运行时文件 | `~/.agenthub/runtime/` | 0755 | 否 |

API 密钥绝不：
- 记录到日志
- 存储在 config.yaml 中
- 发送到 Hub
- 包含在 doctor JSON 输出中（脱敏为 `"set"` / `"missing"`）
- 包含在错误消息或堆栈跟踪中

---

## 5. 参考: 设计决策

| 决策 | 选择 | 理由 |
|----------|--------|-----------|
| CLI 框架 | Cobra | Go CLI 事实标准；40k+ stars；POSIX 兼容标志 |
| 配置格式 | YAML | 人类可读；viper 原生支持 |
| 密钥存储 | 单独的 `secrets.yaml` | 防止意外共享配置；0600 权限 |
| 向导设计 | 3 步（AgentWire 模式） | 最小化；自动检测消除大部分手动输入 |
| 非交互式 | `--non-interactive` 标志 | CI/CD 和 Tauri 集成需要 |
| 安装提示 | 向导 + doctor 中内联 | Canopy IDE 模式 -- 直接嵌入安装命令 |
| 端口检测 | `net.Listen` 探针 | 可靠；与其他工具无竞争条件 |
| API 密钥验证 | 轻量测试调用 | 在运行时错误前捕获过期/已撤销密钥 |
| Doctor 输出 | 双模式：人类 + JSON | 人类用于终端，JSON 用于脚本和 Tauri 集成 |

---

*设计完成。2026-05-21。*
