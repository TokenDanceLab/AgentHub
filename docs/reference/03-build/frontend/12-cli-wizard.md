# AgentHub CLI Command System & Installation Wizard

> Date: 2026-05-21
> Based on: design-desktop-ux.md (Section 1, 5), design-go-services.md (cmd/ design), design-adapter-sdk.md (registration), web-research-tech-stack.md (Tauri + cobra)
> Web research: DataRobot `dr start`, Canopy IDE auto-detect, AgentWire 3-question wizard, Turbo Flow wizard.sh, @itz4blitz/agentful `/agentful-init`

---

## 1. CLI Architecture

### 1.1 Binary Identity

The Go binary `agenthub` serves three roles:

| Role | Context | Entry Point |
|------|---------|-------------|
| **CLI tool** | User runs directly in terminal | `cmd/agenthub/main.go` (cobra root) |
| **Tauri sidecar** | Launched by Tauri desktop app via shell plugin | Same binary, `agenthub serve` mode |
| **Background daemon** | Edge + Runner running as long-lived process | `agenthub serve --daemon` |

A single binary, three personalities. The Tauri shell plugin spawns `agenthub serve` as a sidecar, reads the `LISTEN_PORT=<n>` stdout line, then the React frontend communicates with it over `http://127.0.0.1:<n>`.

### 1.2 Cobra Command Tree

```
agenthub
├── init              # First-run wizard
├── doctor            # Environment diagnostic
├── serve             # Start Edge + Runner (background)
├── hub               # Connect to remote Hub
├── run               # Single prompt execution
├── logs              # Tail execution logs
├── status            # View running tasks
├── stop              # Stop a running task
├── config            # Manage configuration
└── version           # Print version info
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

### 1.3 Global Flags

All commands share these persistent flags:

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--config` | `AGENTHUB_CONFIG` | `~/.agenthub/config.yaml` | Path to config file |
| `--data-dir` | `AGENTHUB_DATA_DIR` | `~/.agenthub/` | Data directory (DB, logs, runtime) |
| `--verbose` | `AGENTHUB_VERBOSE` | `false` | Enable debug logging |
| `--json` | -- | `false` | Output as JSON (for scripting) |

---

## 2. Command Specifications

### 2.1 `agenthub init` -- First-Run Wizard

Reference: AgentWire (3-question minimal), Turbo Flow (project type + feature selection), @itz4blitz/agentful (7-question interactive).

**3-step interactive wizard.** Runs automatically on first `agenthub serve` if no config exists.

```
agenthub init [flags]

Flags:
  --non-interactive     Skip prompts, use defaults + env vars
  --accept-defaults     Accept all auto-detected defaults
  --workspace <path>    Default workspace path
  --force               Overwrite existing config
  --skip-agent-check    Skip CLI binary detection (offline mode)

Aliases:
  agenthub setup
```

#### Step 1: Environment Detection

Auto-detects and displays:

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

Detection logic (Go implementation):

```go
// cli/internal/detect/detect.go
type DetectionResult struct {
    Binary   string `json:"binary"`   // "claude", "codex", "git", "go"
    Name     string `json:"name"`     // "Claude Code CLI"
    Found    bool   `json:"found"`
    Version  string `json:"version,omitempty"`
    Path     string `json:"path,omitempty"`
    Hint     string `json:"hint,omitempty"`   // install hint if not found
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

If a binary is missing, show inline install hint (Canopy IDE pattern):

```
  Codex CLI          NOT FOUND
    Hint: npm install -g @openai/codex
    Skip for now? [Y/n]
```

#### Step 2: API Key Configuration

```
Step 2/3: API Keys

  ANTHROPIC_API_KEY  [set from env]      ********-****-sk-ant-***
  OPENAI_API_KEY     [not set]
    Enter key (or press Enter to skip): █

  At least one API key is required. Keys are stored in:
    ~/.agenthub/secrets.yaml (chmod 600)

  [Enter to continue]
```

Key storage:

```yaml
# ~/.agenthub/secrets.yaml (permissions: 0600)
anthropic_api_key: "sk-ant-..."
openai_api_key: "sk-..."
```

Secrets are NEVER stored in `config.yaml`. The `secrets.yaml` file is `.gitignore`-d by convention and created with `0600` permissions on Unix (Windows: restricted ACL).

Validation: each key is tested with a lightweight API call (e.g., `claude -p "say hi" --max-turns 1` for Anthropic, `codex exec --prompt "say hi" --max-turns 1` for OpenAI). If validation fails, show the error and allow re-entry.

#### Step 3: Default Workspace

```
Step 3/3: Default Workspace

  Workspace is the root directory where AgentHub agents operate.
  Detected: C:\Users\Ding\Projects

  Use this directory? [Y/n / enter custom path]: █

  (You can add more workspaces later with 'agenthub config workspace add')
```

If the detected path does not exist, offer to create it.

#### Completion

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

Generated `~/.agenthub/config.yaml`:

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

#### Non-Interactive Mode

```
agenthub init --non-interactive --workspace /home/user/Projects
```

Reads API keys from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), auto-detects binaries, accepts defaults. Fails with clear error messages if prerequisites are missing (AgentWire pattern: interactive 15+ questions reduced to 3, `--non-interactive` flag for scripting).

---

### 2.2 `agenthub doctor` -- Diagnostic

Reference: Canopy IDE auto-detect pattern (detect Claude/Codex/Gemini CLI availability).

```
agenthub doctor [flags]

Flags:
  --json          Output as JSON (default for scripting)
  --check-ports   Also check port availability
  --fix           Attempt to auto-fix common issues

Aliases:
  agenthub check
  agenthub diagnose
```

#### Human-Readable Output

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

#### JSON Output

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

#### Check Items

| Check | Detection Method | Failure Hint |
|-------|-----------------|--------------|
| `claude_code` | `claude --version` (stdout parse) | `npm install -g @anthropic-ai/claude-code` |
| `codex` | `codex --version` (stdout parse) | `npm install -g @openai/codex` |
| `git` | `git --version` | `https://git-scm.com/downloads` |
| `go` | `go version` | `https://go.dev/dl/` |
| `anthropic_key` | `ANTHROPIC_API_KEY` env + lightweight test | Set env var or add to `secrets.yaml` |
| `openai_key` | `OPENAI_API_KEY` env + lightweight test | Set env var or add to `secrets.yaml` |
| `ports` | `net.Listen("tcp", ":PORT")` probe | Free the port or configure alternate |
| `sqlite` | `sql.Open("sqlite", ":memory:")` | Embedded -- should never fail |
| `directories` | `os.Stat()` + `os.MkdirAll()` test write | Check permissions |

#### --fix Mode

```
agenthub doctor --fix
```

Auto-fixes:
- Creates missing `~/.agenthub/` directory structure
- Sets `0600` permissions on `secrets.yaml`
- Initializes SQLite WAL database at `~/.agenthub/data/agenthub.db`
- Generates default `config.yaml` if missing (non-destructive -- prompts if exists)

---

### 2.3 `agenthub serve` -- Start Edge + Runner

Reference: design-go-services.md `cmd/edge/main.go` + `cmd/runner/main.go` (merged into single process for local desktop).

```
agenthub serve [flags]

Flags:
  --edge-port <port>       Edge API port (default: 3210)
  --runner-port <port>     Runner API port (default: 39731)
  --hub-url <url>          Connect to remote Hub (optional)
  --no-browser             Don't open browser on start
  --daemon                 Run as background daemon (detach from terminal)
  --log-file <path>        Log file path
  --dev                    Development mode (verbose logging, CORS *)

Aliases:
  agenthub start
  agenthub up
```

#### Behavior

1. Load config from `~/.agenthub/config.yaml`
2. Load secrets from `~/.agenthub/secrets.yaml`
3. Initialize SQLite database at `~/.agenthub/data/agenthub.db`
4. Run database migrations
5. Register built-in adapters (claude-code, codex, opencode)
6. Discover external adapters from `~/.agenthub/adapters/`
7. Start Runner HTTP server on `127.0.0.1:39731`
8. Start Edge HTTP server on `127.0.0.1:3210`
9. Edge connects to Hub if `--hub-url` provided (reverse WSS)
10. Print port to stdout for Tauri sidecar detection:

```
LISTEN_PORT=3210
AgentHub Edge ready: http://127.0.0.1:3210
  Runner: http://127.0.0.1:39731
  WS:     ws://127.0.0.1:3210/ws
  Logs:   ~/.agenthub/logs/agenthub.log
```

When launched by Tauri, the Rust side reads `LISTEN_PORT=3210` and connects the webview to `http://127.0.0.1:3210`. When launched from terminal, it optionally opens the browser to the Web UI.

#### Graceful Shutdown

- SIGINT/SIGTERM: cancel all running agent processes (SIGTERM with 5s grace, then SIGKILL -- CloudCLI two-phase pattern)
- Save any pending state to SQLite
- Close WebSocket connections
- Exit

#### Daemon Mode

```
agenthub serve --daemon
```

Detaches from terminal. PID written to `~/.agenthub/runtime/agenthub.pid`. Logs to `~/.agenthub/logs/agenthub.log`.

```
agenthub serve --daemon --stop    # Stop running daemon
agenthub serve --daemon --status  # Check if daemon is running
```

---

### 2.4 `agenthub hub` -- Connect to Remote Hub

```
agenthub hub [flags]

Flags:
  --url <url>         Hub server URL (default: from config)
  --token <token>     Authentication token
  --register          Register this Edge with the Hub
  --name <name>       Edge display name

Subcommands:
  agenthub hub connect     Connect to Hub
  agenthub hub disconnect  Disconnect from Hub
  agenthub hub status      Show Hub connection status
```

For P1+ Hub integration. In P0 (desktop-only), this is a stub that prints "Hub connection requires AgentHub Hub Server (P1+)."

---

### 2.5 `agenthub run` -- Single Prompt Execution

Reference: `claude -p` headless mode, DataRobot `dr start`.

```
agenthub run [flags]

Flags:
  -p, --prompt <text>      Prompt to execute (required)
  -a, --agent <name>       Agent to use: claude-code, codex, opencode (default: claude-code)
  -m, --model <name>       Model override
  -w, --workspace <path>   Workspace path (default: config default)
  --max-turns <n>          Max turns (default: 25)
  --permission-mode <mode> Permission mode: default, accept-edits, bypass (default: default)
  -o, --output <format>    Output format: text, stream-json, json (default: text)
  --no-stream              Disable streaming output
  --resume <session-id>    Resume a previous session
  --tools <list>           Allowed tools (comma-separated)

Aliases:
  agenthub exec
  agenthub ask
```

#### Behavior

1. Validates the specified agent is available (binary exists, API key set)
2. Creates a temporary Run session
3. Calls the Runner API (`POST /runs`)
4. Streams output to terminal (or returns structured JSON)

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

#### JSON Output Mode

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

### 2.6 `agenthub logs` -- Tail Execution Logs

```
agenthub logs [run-id] [flags]

Flags:
  -f, --follow       Follow log output (tail -f)
  -n, --lines <n>    Number of lines to show (default: 50)
  --agent <name>     Filter by agent
  --status <status>  Filter by status (running, completed, failed)
  --since <time>     Show logs since (e.g., 1h, 30m, 2026-05-21)

Aliases:
  agenthub tail
```

#### Behavior

Reads from SQLite `runs` table and/or log files at `~/.agenthub/logs/`.

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

### 2.7 `agenthub status` -- View Running Tasks

```
agenthub status [flags]

Flags:
  --watch         Watch mode (auto-refresh every 2s)

Aliases:
  agenthub ps
```

#### Output

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

### 2.8 `agenthub stop` -- Stop a Running Task

```
agenthub stop <run-id> [flags]

Flags:
  --all           Stop all running tasks
  --force         Force kill (SIGKILL, skip graceful shutdown)

Aliases:
  agenthub kill
  agenthub cancel
```

#### Behavior

Sends cancel request to Runner API (`DELETE /runs/:id`). Runner sends SIGTERM to agent child process, waits 5s, then SIGKILL if still alive.

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

### 2.9 `agenthub config` -- Configuration Management

```
agenthub config [subcommand] [flags]

Subcommands:
  agenthub config show               Show current configuration
  agenthub config get <key>          Get a specific config value
  agenthub config set <key> <value>  Set a config value
  agenthub config workspace          Manage workspaces
  agenthub config agent              Manage agent configurations
  agenthub config edit               Open config in $EDITOR

Workspace subcommands:
  agenthub config workspace list
  agenthub config workspace add <path> [--name <name>]
  agenthub config workspace remove <name>
  agenthub config workspace default <name>

Agent subcommands:
  agenthub config agent list
  agenthub config agent add <name> --binary <path>
  agenthub config agent remove <name>
  agenthub config agent default <name>
```

#### Examples

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

### 2.10 `agenthub version` -- Version Info

```
agenthub version [flags]

Flags:
  --short     Print version number only
  --json      JSON output
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

## 3. `agenthub init` Wizard -- Full Flow Design

### 3.1 State Machine

```
              ┌──────────────────────────┐
              │  Entry: agenthub init     │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  Check: existing config?  │
              │  YES (no --force) ────────┼────► "Config exists. Use --force to overwrite."
              │  NO or --force            │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  Step 1: Detect Env       │
              │  - Find binaries          │
              │  - Show versions          │
              │  - Offer install hints    │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  Step 2: API Keys         │
              │  - Check env vars first   │
              │  - Prompt for missing     │
              │  - Validate each key      │
              │  - Save to secrets.yaml   │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  Step 3: Workspace        │
              │  - Auto-detect from CWD   │
              │  - Accept or enter custom │
              │  - Git repo detection     │
              └─────────┬────────────────┘
                        │
              ┌─────────▼────────────────┐
              │  Write config.yaml        │
              │  Write secrets.yaml       │
              │  Init DB + migrations     │
              │  Print summary            │
              └──────────────────────────┘
```

### 3.2 --non-interactive Flow

For CI/CD, Docker, and automated setups:

```
agenthub init --non-interactive [--workspace /path] [--accept-defaults]
```

1. Read `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from environment
2. Auto-detect binary paths (fail if at least one agent is not found, unless `--skip-agent-check`)
3. Use `--workspace` if provided, else `$HOME/Projects`, else `$PWD`
4. Write config and secrets without prompts
5. Exit 0 on success, exit 1 with message on failure

### 3.3 Tauri Integration

When AgentHub runs as a Tauri desktop app, the "first start" experience uses the same `agenthub init` logic but rendered through the React UI (ProjectSelector / welcome view from design-desktop-ux.md Section 1):

1. Tauri spawns `agenthub serve` as sidecar
2. If no config exists, `agenthub serve` returns a special stdout line: `SETUP_REQUIRED=1`
3. Tauri reads this and shows the React welcome/setup flow instead of the main UI
4. The React UI calls `agenthub init --non-interactive` with user-provided values via Tauri command
5. On completion, Tauri restarts the sidecar with `agenthub serve`

The desktop UX flow (design-desktop-ux.md):

```
ProjectSelector (welcome view, P0)
├── RecentProjectList (empty on first run)
├── ProjectCard (not shown on first run)
├── NewProjectDialog (first-run: "Welcome to AgentHub")
│   ├── Step 1: Agent detection (auto-filled from 'agenthub doctor --json')
│   ├── Step 2: API key input (password fields)
│   └── Step 3: Choose workspace (folder picker via Tauri dialog.open)
└── OpenFolderButton
```

---

## 4. Implementation Notes

### 4.1 Package Layout

```
cli/                          # Cobra CLI package
├── root.go                   # Root command + global flags
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
    │   └── detect.go         # Binary + env detection
    ├── wizard/
    │   └── wizard.go         # Interactive wizard engine
    ├── secret/
    │   └── secret.go         # secrets.yaml read/write
    └── output/
        ├── table.go          # Terminal table formatting
        └── json.go           # JSON output helpers
```

### 4.2 Dependencies

```
go.mod additions:
  github.com/spf13/cobra      # CLI framework
  github.com/spf13/viper      # Config management (reads config.yaml)
  github.com/charmbracelet/bubbletea  # Optional: TUI for interactive wizard
  gopkg.in/yaml.v3            # YAML parsing/generation
  modernc.org/sqlite          # Already in project
```

### 4.3 Config File Priority (Viper)

```
1. Command-line flags (highest priority)
2. Environment variables (AGENTHUB_*)
3. ~/.agenthub/config.yaml
4. Defaults in code (lowest priority)
```

### 4.4 Port Allocation Strategy

| Port | Component | Fallback Strategy |
|------|-----------|-------------------|
| 3210 | Edge API + WS | Try 3210, then 3211-3220 sequentially |
| 3211 | Hub API (if local) | Try 3211, then 3212-3220 sequentially |
| 39731 | Runner API | Try 39731, then 39732-39740 sequentially |
| 5100-5199 | Preview servers | Allocate from pool |
| 3000 | Web UI (dev only) | Vite default |

Port conflicts are detected in `agenthub doctor` and configurable via `agenthub config set edge.port <n>`.

### 4.5 Security Boundaries

| Data | Storage | Permissions | Sync to Hub? |
|------|---------|-------------|-------------|
| `config.yaml` | `~/.agenthub/` | 0644 | No |
| `secrets.yaml` | `~/.agenthub/` | 0600 (Unix) / restricted ACL (Windows) | Never |
| `agenthub.db` | `~/.agenthub/data/` | 0644 | Only if Hub-connected (P1+) |
| Logs | `~/.agenthub/logs/` | 0644 | No |
| Runtime files | `~/.agenthub/runtime/` | 0755 | No |

API keys are NEVER:
- Logged
- Stored in config.yaml
- Sent to Hub
- Included in doctor JSON output (redacted as `"set"` / `"missing"`)
- Included in error messages or stack traces

---

## 5. Reference: Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI framework | Cobra | De facto standard for Go CLIs; 40k+ stars; POSIX-compliant flags |
| Config format | YAML | Human-readable; viper natively supports it |
| Secret storage | Separate `secrets.yaml` | Prevents accidental config sharing; 0600 permissions |
| Wizard design | 3-step (AgentWire pattern) | Minimal; auto-detect eliminates most manual entry |
| Non-interactive | `--non-interactive` flag | Required for CI/CD and Tauri integration |
| Install hints | Inline in wizard + doctor | Canopy IDE pattern -- embed install commands directly |
| Port detection | `net.Listen` probe | Reliable; no race condition with other tools |
| API key validation | Lightweight test call | Catches expired/revoked keys before they cause runtime errors |
| Doctor output | Dual human + JSON | Human for terminal, JSON for scripting and Tauri integration |

---

*Design complete. 2026-05-21.*
