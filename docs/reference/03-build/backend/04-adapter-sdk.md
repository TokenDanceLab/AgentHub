# AgentHub Adapter SDK -- Developer Guide

> Generated: 2026-05-21
> Sources: cross-analysis-adapters.md, cloudcli.md, opencode.md, kanna.md, langflow.md, flowise.md, design-protocol.md, design-protobuf-schema.md
> Target audience: Third-party developers building new Agent Adapters

---

## 1. Adapter Development Flow

### 1.1 From Zero to Running Adapter: Step-by-Step

Developing a new Agent Adapter requires 7 steps. A minimal adapter (read-only, text-only output) can be done in 4.

```
Step 1: Choose transport model          (subprocess vs HTTP vs sidecar)
Step 2: Implement core interface        (4 methods: Metadata, Capabilities, Start, AttachStream)
Step 3: Implement stream normalization  (native events -> AgentEvent)
Step 4: Register the adapter            (init() self-registration or manifest)
Step 5: Implement optional extensions   (SessionManager, PermissionBroker, InteractiveControl)
Step 6: Write manifest / config         (manifest.yaml or Go code)
Step 7: Test & publish                  (integration test against AgentHub runner)
```

#### Step 1: Choose Transport Model

| Transport | When to Use | Example Adapters |
|-----------|-------------|-----------------|
| **Subprocess** | Agent CLI has a non-interactive mode (stdin/stdout) | Claude Code (`-p --output-format stream-json`), Codex (`codex exec`) |
| **HTTP + SSE** | Agent exposes a REST API with streaming events | OpenCode (Hono server, `POST /session` + SSE) |
| **WebSocket** | Agent uses persistent bidirectional connection | Kanna wrapper (WS snapshot push) |
| **Sidecar process** | Agent is a long-running daemon with its own protocol | Codex App Server (JSON-RPC stdio) |

Decision tree:

```
Can the agent run headless (no TTY)?
  ├─ YES, with stdout streaming → Subprocess (simplest)
  ├─ YES, with HTTP API          → HTTP + SSE
  └─ NO (requires TTY)           → Wrap in pty, or use sidecar
```

#### Step 2: Implement the Core Interface

The **minimum** an adapter MUST implement is the `AgentAdapter` interface:

```go
// Reference: cross-analysis-adapters.md Section 2.2
type AgentAdapter interface {
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    Start(ctx context.Context, req StartRequest) (*AgentSession, error)
    AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}
```

**Resume is optional** for v1. If the underlying agent does not support session reuse, return `ErrNotSupported`.

The four methods break down as:

| Method | What It Does | Minimum Implementation |
|--------|-------------|----------------------|
| `Metadata()` | Returns name, version, and underlying CLI version | Hardcode or call `binary --version` |
| `Capabilities()` | Declares which features are supported | Return all `false` except `Streaming: true` |
| `Start()` | Launches the agent process/connection, returns session | Spawn subprocess or dial HTTP |
| `AttachStream()` | Returns a channel of `AgentEvent` | Start a goroutine that reads stdout/SSE and emits events |

**Minimal adapter skeleton** (subprocess transport):

```go
package myagent

import (
    "context"
    "bufio"
    "encoding/json"
    "os/exec"

    "github.com/agenthub/agenthub/packages/protocol"
)

type MyAgentAdapter struct {
    binaryPath string
}

func (a *MyAgentAdapter) Metadata() protocol.AdapterMetadata {
    return protocol.AdapterMetadata{
        Name:    "my-agent",
        Version: "1.0.0",
    }
}

func (a *MyAgentAdapter) Capabilities() protocol.AgentCapabilities {
    return protocol.AgentCapabilities{
        Streaming:     true,
        ThinkingVisible: false,
    }
}

func (a *MyAgentAdapter) Start(ctx context.Context, req protocol.StartRequest) (*protocol.AgentSession, error) {
    cmd := exec.CommandContext(ctx, a.binaryPath, "--prompt", req.Prompt)
    stdoutPipe, _ := cmd.StdoutPipe()
    cmd.Start()

    session := &protocol.AgentSession{
        ID:     generateSessionID(),
        Status: protocol.StatusRunning,
    }
    // Store cmd + stdoutPipe for AttachStream
    sessionStore.Store(session.ID, &sessionState{cmd: cmd, stdout: stdoutPipe})
    return session, nil
}

func (a *MyAgentAdapter) AttachStream(ctx context.Context, sessionID string) (*protocol.EventStream, error) {
    state := sessionStore.Load(sessionID)
    ch := make(chan protocol.AgentEvent, 64)
    ctx, cancel := context.WithCancel(ctx)

    go func() {
        defer close(ch)
        scanner := bufio.NewScanner(state.stdout)
        for scanner.Scan() {
            line := scanner.Bytes()
            event := normalizeToAgentEvent(line)
            ch <- event
        }
        ch <- protocol.AgentEvent{
            Type: protocol.EventResult,
            Payload: protocol.ResultPayload{Subtype: protocol.ResultSuccess},
        }
    }()

    return &protocol.EventStream{C: ch, Cancel: cancel}, nil
}

func (a *MyAgentAdapter) Resume(ctx context.Context, sessionID string) (*protocol.AgentSession, error) {
    return nil, ErrNotSupported
}
```

#### Step 3: Stream Normalization -- Native Events to AgentEvent

Every adapter must convert its native output format into the **12 unified AgentEvent types**.

Reference: cross-analysis-adapters.md Section 2.2 "Unified Agent Event Model" and Section 4.1 "Native-to-Unified Event Mapping"

The 12 AgentEvent types and what they represent:

| AgentEvent Type | Meaning | Required? |
|-----------------|---------|-----------|
| `system_init` | Session initialized: model, tools, permissions | STRONGLY RECOMMENDED |
| `assistant_text` | Text content from the model (delta or block) | REQUIRED |
| `reasoning` | Thinking/reasoning content | Optional (flag: `ThinkingVisible`) |
| `tool_call` | Agent requests tool execution | REQUIRED (if agent uses tools) |
| `tool_result` | Result of a tool execution | REQUIRED (if agent uses tools) |
| `tool_progress` | Tool execution progress update | Optional |
| `tool_use_summary` | Batch tool call summary | Optional |
| `result` | Turn completed (success/error) | REQUIRED |
| `system` | Compaction, retry, status change | Optional |
| `stream_event` | Raw streaming delta | Optional (flag: `IncludePartialEvents`) |
| `approval_request` | Agent requests permission | Optional (flag: `PermissionHooks`) |
| `status_change` | Session status transition | Optional |

**Normalization pattern** (from Kanna's `normalizeClaudeStreamMessage()`, kanna.md Section 3.7):

```go
// Parser function: raw_line -> AgentEvent
func normalizeToAgentEvent(raw []byte) protocol.AgentEvent {
    var native map[string]interface{}
    json.Unmarshal(raw, &native)

    switch native["type"] {
    case "text":
        return protocol.AgentEvent{
            Type: protocol.EventAssistantText,
            Payload: protocol.AssistantTextPayload{
                Content: native["content"].(string),
                Phase:   protocol.TextPhaseDelta,
            },
        }
    case "tool_use":
        return protocol.AgentEvent{
            Type: protocol.EventToolCall,
            Payload: protocol.ToolCallPayload{
                ToolCallID: native["id"].(string),
                ToolName:   native["name"].(string),
                ToolInput:  native["input"].(map[string]any),
                Status:     protocol.ToolCallPending,
            },
        }
    case "complete":
        return protocol.AgentEvent{
            Type: protocol.EventResult,
            Payload: protocol.ResultPayload{
                Subtype: protocol.ResultSuccess,
                Content: native["output"].(string),
            },
        }
    }
}
```

#### Step 4: Register the Adapter

See Section 3 below for the full registration mechanism.

#### Step 5: Implement Optional Extensions

Three extension interfaces, each capability-gated:

| Extension Interface | Required Capability Flag | Methods |
|--------------------|------------------------|---------|
| `SessionManager` | `SessionPersist` or `Fork` | `ForkSession`, `ListSessions`, `GetSessionInfo`, `GetMessages` |
| `PermissionBroker` | `PermissionHooks` | `SetPermissionCallback`, `ResolvePermission` |
| `InteractiveControl` | `Steer` | `Cancel`, `SendSteer`, `Drain` |

Reference: cross-analysis-adapters.md Section 2.2 "Extension Interfaces"

#### Step 6: Write Manifest / Config

See Section 1.3 (Manifest) and Section 3 (Registration) below.

#### Step 7: Test

AgentHub provides an adapter test harness:

```go
// In adapter_test.go
func TestMyAgentAdapter(t *testing.T) {
    harness := adapters.NewTestHarness(t, &MyAgentAdapter{
        binaryPath: os.Getenv("MY_AGENT_PATH"),
    })
    harness.RunBasicTest()         // Start + stream + result
    harness.RunToolUseTest()       // Tool call + result round-trip
    harness.RunCancellationTest()  // Cancel mid-turn
    harness.RunPermissionTest()    // Approval request/decision
}
```

### 1.2 Minimum Adapter Checklist (4 methods)

A **read-only agent with text-only output** needs only:

1. `Metadata()` -- return adapter name + version
2. `Capabilities()` -- return `Streaming: true`
3. `Start()` -- spawn process or dial HTTP
4. `AttachStream()` -- emit `assistant_text` deltas + final `result`

Everything else is optional and gated behind capability flags.

### 1.3 Registration Mechanism

AgentHub supports **three registration modes**, each for a different deployment pattern.

#### Mode A: Go init() Self-Registration (Built-in Adapters)

Best for adapters compiled into the AgentHub runner binary.

Pattern from flowise.md Section 3.2.3 (Node DLL self-registration):

```go
// adapter/registry/registry.go
package registry

import "sync"

var (
    mu       sync.RWMutex
    adapters = map[string]AdapterFactory{}
)

type AdapterFactory func(config AdapterConfig) (AgentAdapter, error)

func Register(name string, factory AdapterFactory) {
    mu.Lock()
    defer mu.Unlock()
    if _, exists := adapters[name]; exists {
        panic("adapter already registered: " + name)
    }
    adapters[name] = factory
}

func Get(name string) (AdapterFactory, bool) {
    mu.RLock()
    defer mu.RUnlock()
    f, ok := adapters[name]
    return f, ok
}

func List() []string {
    mu.RLock()
    defer mu.RUnlock()
    names := make([]string, 0, len(adapters))
    for name := range adapters {
        names = append(names, name)
    }
    return names
}
```

Usage in adapter package:

```go
// adapters/myagent/adapter.go
package myagent

import "github.com/agenthub/agenthub/packages/adapter/registry"

func init() {
    registry.Register("my-agent", func(cfg AdapterConfig) (AgentAdapter, error) {
        return &MyAgentAdapter{
            binaryPath: cfg.BinaryPath,
        }, nil
    })
}
```

Runner startup loads all registered adapters:

```go
// runner/main.go
import (
    _ "github.com/agenthub/agenthub/adapters/claude-code"   // side-effect import triggers init()
    _ "github.com/agenthub/agenthub/adapters/codex"
    _ "github.com/agenthub/agenthub/adapters/opencode"
    _ "github.com/agenthub/agenthub/adapters/myagent"
)
```

This is the **Flowise NodesPool pattern** -- each node file self-registers, and the server discovers them via side-effect imports. No central registry file to maintain.

#### Mode B: manifest.yaml (External Plugins)

Best for third-party adapters not compiled into the binary.

Pattern from cloudcli.md Section 2.2 (Plugin Manifest):

```yaml
# my-adapter/manifest.yaml
name: my-agent                  # Required: ^[a-zA-Z0-9_-]+$
displayName: My Agent           # Required: UI display name
version: 1.0.0
description: "Custom agent adapter for MyAgent CLI"
author: "your-name"
icon: Bot                       # Lucide icon name
type: adapter                   # "adapter" | "plugin" (slot distinction)
entry: adapter.go               # Go entry point (for built-in) or server.js (for sidecar)
server: server.js               # Optional: sidecar process entry
transport:
  type: subprocess              # "subprocess" | "http" | "sidecar"
  binary: my-agent               # CLI binary name or path
  args: ["--output-format", "jsonl"]
capabilities:
  streaming: true
  sessionPersist: false
  permissionHooks: false
  thinkingVisible: false
permissions:
  - fs.read                     # Required permissions
  - process.spawn
```

Manifest loading follows the CloudCLI pattern (cloudcli.md Section 2.2):

1. Scan `~/.agenthub/adapters/` for directories containing `manifest.yaml`
2. Validate required fields and regex constraints
3. For `transport.type: subprocess`: locate the binary on PATH
4. For `transport.type: sidecar`: spawn `node server.js` with ready-protocol
5. Register in the adapter registry

#### Mode C: Configuration File (AgentHub config)

Best for simple adapters that are just thin wrappers over existing CLI tools.

```yaml
# ~/.agenthub/config.yaml
adapters:
  custom-shell-agent:
    type: subprocess
    binary: /usr/local/bin/my-shell-agent
    args_template: "--task {{.Prompt}} --output json"
    event_mapping:
      text: "assistant_text"
      tool: "tool_call"
      done: "result"
```

This is for zero-code adapters where the CLI already emits structured JSON -- AgentHub can map the fields directly without a Go adapter.

### 1.4 Registration Mode Comparison

| Feature | init() Self-Reg | manifest.yaml | Config File |
|---------|----------------|---------------|-------------|
| Compile into binary | Yes | No | No |
| Hot-reload | No (recompile) | Yes (rescan) | Yes (reload) |
| Sidecar support | N/A | Yes (server.js) | No |
| Complex parsing logic | Full Go power | Via sidecar | JSON field mapping only |
| Distribution | Go module | Directory + git clone | Config snippet |
| Use case | Built-in adapters | Third-party adapters | Simple CLI wrappers |
| Reference pattern | Flowise NodesPool | CloudCLI plugin-loader | Kanna ProviderCatalog |

---

## 2. Adapter File Checklist

### 2.1 Standard Directory Layout

```
my-adapter/
├── adapter.go             # AgentAdapter interface implementation
├── manifest.yaml           # Adapter metadata (for Mode B registration)
├── config.go               # AgentConfig struct + StartRequest validation
├── executor.go             # Process start/manage (subprocess or HTTP)
├── parser.go               # Stream output normalization (native -> AgentEvent)
├── events.go               # Event type definitions (native event structs)
├── permissions.go          # PermissionBroker extension (optional)
├── sessions.go             # SessionManager extension (optional)
├── control.go              # InteractiveControl extension (optional)
├── adapter_test.go         # Integration tests using test harness
├── go.mod                  # Go module file
├── go.sum
└── README.md               # Development documentation
```

### 2.2 File Responsibilities

#### `adapter.go` -- Core Interface

```go
package myagent

// adapter.go: implements protocol.AgentAdapter
// Responsibilities:
//   - Metadata()     -> static adapter info
//   - Capabilities() -> feature flags
//   - Start()        -> launch agent, return session
//   - AttachStream() -> event channel consumer
//   - Resume()       -> reconnect to session (optional)
```

Must embed the per-agent workaround struct (cross-analysis-adapters.md Section 3 pattern):

```go
type MyAgentAdapter struct {
    config      AdapterConfig
    // Per-agent special handling
    workaround1 bool  // e.g., "stdout guard interference" equivalent
    workaround2 bool  // e.g., "exit code interpretation" equivalent
}
```

#### `manifest.yaml` -- Metadata

See Section 1.3 Mode B for the full schema.

#### `config.go` -- Configuration

```go
// config.go: Adapter-specific configuration + validation
// Reference: cross-analysis-adapters.md Section 2.2 "AdapterConfig"
// Reference: cross-analysis-adapters.md Section 3 per-agent special configs

type MyAgentConfig struct {
    BinaryPath      string            `json:"binaryPath" yaml:"binaryPath"`
    OutputFormat    string            `json:"outputFormat" yaml:"outputFormat"`    // "jsonl", "plain"
    Env             map[string]string `json:"env,omitempty" yaml:"env,omitempty"`
    TimeoutSec      int               `json:"timeoutSec" yaml:"timeoutSec"`
    // Provider-specific extras
    Extras          map[string]any    `json:"extras,omitempty" yaml:"extras,omitempty"`
}

func (c *MyAgentConfig) Validate() error {
    if c.BinaryPath == "" {
        return fmt.Errorf("binaryPath is required")
    }
    if c.OutputFormat != "jsonl" && c.OutputFormat != "plain" {
        return fmt.Errorf("outputFormat must be jsonl or plain")
    }
    return nil
}
```

Pattern from opencode.md Section 1.2: OpenCode has `OpenCodeConfig` with `Port`, `AutoStart`, `HealthTimeout` -- each adapter defines its own config struct extending the base `AdapterConfig`.

#### `executor.go` -- Process Lifecycle

```go
// executor.go: Spawn/manage the agent process or HTTP connection
// Two patterns:

// Pattern A: Subprocess (Claude Code, Codex)
func (a *MyAgentAdapter) startSubprocess(ctx context.Context, req StartRequest) (*exec.Cmd, io.ReadCloser, error) {
    cmd := exec.CommandContext(ctx, a.config.BinaryPath,
        "--prompt", req.Prompt,
        "--output-format", a.config.OutputFormat,
    )
    stdout, _ := cmd.StdoutPipe()
    cmd.Stderr = &stderrBuf
    if err := cmd.Start(); err != nil {
        return nil, nil, err
    }
    return cmd, stdout, nil
}

// Pattern B: HTTP Client (OpenCode)
func (a *MyAgentAdapter) startHTTP(ctx context.Context, req StartRequest) (*http.Response, error) {
    url := fmt.Sprintf("http://localhost:%d/api/session", a.config.Port)
    body, _ := json.Marshal(req)
    return http.Post(url, "application/json", bytes.NewReader(body))
}
```

For sidecar adapters (like CloudCLI plugins), implement the **ready protocol** (cloudcli.md Section 2.5):
- Spawn child process
- Wait for stdout JSON line `{"ready":true,"port":<number>}`
- Timeout after 10s, then SIGTERM (5s grace) -> SIGKILL

#### `parser.go` -- Stream Normalization

```go
// parser.go: Convert raw agent output to unified AgentEvent stream
// Reference: cross-analysis-adapters.md Section 4.1 event mapping table
// Reference: kanna.md Section 3.7 TranscriptEntry normalization

// EventParser is a stateful parser that reads raw lines and emits AgentEvents.
type EventParser struct {
    sessionID string
    seq       int
    state     parserState  // track parser FSM state if needed
}

func (p *EventParser) ParseLine(line []byte) (*AgentEvent, error) {
    p.seq++
    // Dispatch by native event type
    // Map to one of 12 AgentEvent types
    // Preserve raw event in AgentEvent.Raw for debugging
}
```

Key normalization rules (from cross-analysis-adapters.md Section 4):

1. **MCP tool naming**: Always normalize to `mcp__<server>__<tool>` format (Section 4.2)
2. **Tool call status lifecycle**: `pending -> running -> completed/failed/denied`
3. **Text phase**: Mark streaming deltas as `delta`, final block as `block_end`
4. **Result always last**: The `result` event must be the final event emitted, even if the stream continues to drain
5. **Raw preservation**: Set `AgentEvent.Raw = line` to enable debugging

#### `events.go` -- Native Event Types

```go
// events.go: Go struct definitions for the agent's native event format
// Used by parser.go to unmarshal raw output

type MyAgentNativeEvent struct {
    Type      string          `json:"type"`      // "text", "tool_use", "complete", "error"
    ID        string          `json:"id,omitempty"`
    Content   string          `json:"content,omitempty"`
    ToolName  string          `json:"tool_name,omitempty"`
    ToolInput map[string]any  `json:"tool_input,omitempty"`
    Timestamp int64           `json:"timestamp,omitempty"`
}
```

Pattern from cross-analysis-adapters.md Section 3: Each adapter section defines the native CLI args and native event structure separately before the normalization code.

#### `permissions.go` -- PermissionBroker (Optional)

```go
// permissions.go: implements protocol.PermissionBroker
// Reference: cross-analysis-adapters.md Section 2.2 "PermissionBroker"
// Reference: cross-analysis-adapters.md Section 3.1 Workaround 5 (CC stdin control protocol)

func (a *MyAgentAdapter) SetPermissionCallback(sessionID string, cb PermissionCallback) {
    // Store callback for this session
    // Called by AgentHub's approval engine
}

func (a *MyAgentAdapter) ResolvePermission(ctx context.Context, req ToolPermissionRequest) (*PermissionDecision, error) {
    // Called by the adapter's event loop when a tool call needs approval
    // Blocks until a decision is made (user/admin input)
}
```

The Kanna pattern (kanna.md Section 3.5): only gate specific tools (`AskUserQuestion`, `ExitPlanMode`), auto-allow everything else. AgentHub generalizes this to any tool.

#### `sessions.go` -- SessionManager (Optional)

```go
// sessions.go: implements protocol.SessionManager
// Reference: cross-analysis-adapters.md Section 2.2 "SessionManager"

func (a *MyAgentAdapter) ForkSession(ctx context.Context, req ForkRequest) (*AgentSession, error) { ... }
func (a *MyAgentAdapter) ListSessions(ctx context.Context, pagination Pagination) ([]SessionInfo, error) { ... }
func (a *MyAgentAdapter) GetSessionInfo(ctx context.Context, sessionID string) (*SessionInfo, error) { ... }
func (a *MyAgentAdapter) GetMessages(ctx context.Context, sessionID string) ([]AgentEvent, error) { ... }
```

#### `control.go` -- InteractiveControl (Optional)

```go
// control.go: implements protocol.InteractiveControl
// Reference: cross-analysis-adapters.md Section 2.2 "InteractiveControl"
// Reference: kanna.md Section 3.4 steer mode pattern

func (a *MyAgentAdapter) Cancel(ctx context.Context, sessionID string) error { ... }
func (a *MyAgentAdapter) SendSteer(ctx context.Context, sessionID string, msg SteerMessage) error { ... }
func (a *MyAgentAdapter) Drain(ctx context.Context, sessionID string) error { ... }
```

---

## 3. Registration Mechanism Design

### 3.1 Architecture

AgentHub's adapter registration is a **three-layer system** inspired by multiple reference implementations:

```
Layer 1: Registry (Global singleton, thread-safe Map)
         Reference: Flowise NodesPool pattern (flowise.md Section 3.2.3)
         Location: packages/adapter/registry/

Layer 2: Discovery (how adapters are found and loaded)
         Reference: CloudCLI plugin-loader (cloudcli.md Section 2.2)
         Location: packages/adapter/discovery/

Layer 3: Lifecycle (process start/stop/health)
         Reference: CloudCLI process-manager (cloudcli.md Section 2.5)
                  + OpenCode server lifecycle (opencode.md Section 5.1 Workaround 1)
         Location: packages/adapter/lifecycle/
```

### 3.2 Layer 1: Registry

Flowise's node registration pattern (flowise.md Section 3.2.3):

```
Flowise:  nodeClass: XXX → module.exports = { nodeClass: XXX }
          NodesPool lazy-loads via dynamic import()

AgentHub: factory: func → registry.Register("name", factory)
          Runner imports adapter packages for side-effect init()
```

Implementation:

```go
// packages/adapter/registry/registry.go

package registry

import (
    "fmt"
    "sync"
)

// AdapterFactory creates an adapter instance from configuration.
// Reference: Flowise NodesPool creates node instances from nodeClass
type AdapterFactory func(config AdapterConfig) (AgentAdapter, error)

// AdapterEntry holds a registered adapter.
type AdapterEntry struct {
    Name        string
    Factory     AdapterFactory
    Manifest    *AdapterManifest   // nil for built-in, set for external
    Source      RegistrationSource
}

type RegistrationSource string

const (
    SourceBuiltin RegistrationSource = "builtin"   // Compiled into binary (init())
    SourceExternal RegistrationSource = "external"  // Loaded from manifest.yaml
    SourceConfig  RegistrationSource = "config"     // Defined in AgentHub config
)

type Registry struct {
    mu       sync.RWMutex
    entries  map[string]*AdapterEntry
    loadOrder []string  // preserve registration order for priority
}

var global = &Registry{entries: make(map[string]*AdapterEntry)}

// Register is called by adapter packages in their init() function.
// Panics on duplicate registration (fail-fast, same as Flowise NodesPool).
func Register(name string, factory AdapterFactory) {
    global.mu.Lock()
    defer global.mu.Unlock()
    if _, exists := global.entries[name]; exists {
        panic(fmt.Sprintf("adapter %q already registered", name))
    }
    global.entries[name] = &AdapterEntry{
        Name:    name,
        Factory: factory,
        Source:  SourceBuiltin,
    }
    global.loadOrder = append(global.loadOrder, name)
}

// RegisterExternal is called by the manifest loader for external adapters.
// Does NOT panic on conflict; returns error so the loader can skip.
func RegisterExternal(name string, factory AdapterFactory, manifest *AdapterManifest) error {
    global.mu.Lock()
    defer global.mu.Unlock()
    if _, exists := global.entries[name]; exists {
        return fmt.Errorf("adapter %q conflicts with existing registration", name)
    }
    global.entries[name] = &AdapterEntry{
        Name:     name,
        Factory:  factory,
        Manifest: manifest,
        Source:   SourceExternal,
    }
    global.loadOrder = append(global.loadOrder, name)
    return nil
}

func Get(name string) (*AdapterEntry, bool) {
    global.mu.RLock()
    defer global.mu.RUnlock()
    e, ok := global.entries[name]
    return e, ok
}

func List() []*AdapterEntry {
    global.mu.RLock()
    defer global.mu.RUnlock()
    result := make([]*AdapterEntry, 0, len(global.entries))
    for _, name := range global.loadOrder {
        if e, ok := global.entries[name]; ok {
            result = append(result, e)
        }
    }
    return result
}
```

### 3.3 Layer 2: Discovery

Inspired by CloudCLI's `scanPlugins` (cloudcli.md Section 2.2) and OpenCode's `PluginLoader.loadExternal` (opencode.md Section 1.3).

```go
// packages/adapter/discovery/discovery.go

// DiscoverExternal scans directories for manifest.yaml files and registers them.
// Reference: CloudCLI scanPlugins() skips tmp- prefixed dirs (atomic install pattern)
func DiscoverExternal(adaptersDir string) ([]string, error) {
    entries, err := os.ReadDir(adaptersDir)
    if err != nil {
        return nil, err
    }

    var registered []string
    for _, entry := range entries {
        if !entry.IsDir() {
            continue
        }
        // Skip temporary directories (atomic install pattern from CloudCLI)
        if strings.HasPrefix(entry.Name(), ".tmp-") {
            continue
        }

        manifestPath := filepath.Join(adaptersDir, entry.Name(), "manifest.yaml")
        manifest, err := LoadManifest(manifestPath)
        if err != nil {
            log.Printf("skipping %s: invalid manifest: %v", entry.Name(), err)
            continue
        }

        // Determine load strategy from transport type
        var factory AdapterFactory
        switch manifest.Transport.Type {
        case "subprocess":
            factory = NewSubprocessAdapterFactory(manifest)
        case "sidecar":
            factory = NewSidecarAdapterFactory(manifest)
        case "http":
            factory = NewHTTPAdapterFactory(manifest)
        default:
            log.Printf("skipping %s: unknown transport type %q", entry.Name(), manifest.Transport.Type)
            continue
        }

        if err := registry.RegisterExternal(entry.Name(), factory, manifest); err != nil {
            log.Printf("skipping %s: %v", entry.Name(), err)
            continue
        }
        registered = append(registered, entry.Name())
    }
    return registered, nil
}
```

### 3.4 Layer 3: Lifecycle

```go
// packages/adapter/lifecycle/manager.go

// ProcessManager handles subprocess/sidecar lifecycle.
// Reference: CloudCLI plugin-process-manager (cloudcli.md Section 2.5)
// Key patterns: ready protocol, timeout, SIGTERM->SIGKILL two-phase shutdown
type ProcessManager struct {
    processes map[string]*ManagedProcess
    mu        sync.Mutex
}

type ManagedProcess struct {
    Name    string
    Cmd     *exec.Cmd
    Port    int            // for HTTP/sidecar adapters
    Status  ProcessStatus
    ReadyCh chan struct{}   // closed when ready signal received
}

// Start spawns the adapter process and waits for ready signal.
// Reference: CloudCLI startPluginServer() -- spawn + JSON ready line + 10s timeout
func (pm *ProcessManager) Start(name string, config ProcessConfig) (*ManagedProcess, error) {
    cmd := exec.Command(config.Command, config.Args...)
    cmd.Env = sanitizeEnv(config.Env) // CloudCLI pattern: only inject PATH, HOME, NODE_ENV
    stdout, _ := cmd.StdoutPipe()
    cmd.Start()

    mp := &ManagedProcess{
        Name:    name,
        Cmd:     cmd,
        Status:  ProcessStarting,
        ReadyCh: make(chan struct{}),
    }

    // Ready protocol: read stdout for JSON ready signal
    go func() {
        scanner := bufio.NewScanner(stdout)
        if scanner.Scan() {
            var ready ReadySignal
            if json.Unmarshal(scanner.Bytes(), &ready) == nil && ready.Ready {
                mp.Port = ready.Port
                close(mp.ReadyCh)
            }
        }
    }()

    // Timeout: 10s (CloudCLI pattern)
    select {
    case <-mp.ReadyCh:
        mp.Status = ProcessRunning
    case <-time.After(10 * time.Second):
        pm.Stop(name)
        return nil, fmt.Errorf("adapter %s: ready timeout after 10s", name)
    }

    pm.mu.Lock()
    pm.processes[name] = mp
    pm.mu.Unlock()
    return mp, nil
}

// Stop gracefully terminates: SIGTERM (5s) -> SIGKILL.
// Reference: CloudCLI two-phase shutdown
func (pm *ProcessManager) Stop(name string) error {
    // ... SIGTERM, wait 5s, SIGKILL
}

// ReadySignal is the JSON object emitted by sidecar processes on stdout
// to indicate they are ready to accept requests.
// Reference: CloudCLI: {"ready": true, "port": <number>}
type ReadySignal struct {
    Ready bool `json:"ready"`
    Port  int  `json:"port"`
}
```

### 3.5 End-to-End Registration Flow

```
AgentHub Runner Startup
│
├─ 1. Built-in adapters (init() side-effect imports)
│      import _ "adapters/claude-code"   → registry.Register("claude-code", factory)
│      import _ "adapters/codex"         → registry.Register("codex", factory)
│      import _ "adapters/opencode"      → registry.Register("opencode", factory)
│
├─ 2. External adapters (manifest.yaml scan)
│      discovery.DiscoverExternal("~/.agenthub/adapters/")
│        → skip .tmp-* dirs (atomic install guard)
│        → LoadManifest() + validate
│        → NewAdapterFactory() from transport type
│        → registry.RegisterExternal()
│
├─ 3. Config adapters (AgentHub config YAML)
│      config.LoadAdapterConfigs()
│        → parse adapters: section
│        → registry.RegisterConfig()
│
└─ 4. Resolve at runtime
       adapter := registry.Get(requestedAgentID)
       session := adapter.Factory(config).Start(ctx, req)
```

---

## 4. Built-in Adapter vs External Adapter

### 4.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    AgentHub Runner                       │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ Built-in Adapters│    │   External Adapters       │   │
│  │ (compiled in)    │    │   (sidecar / MCP / plugin)│   │
│  │                  │    │                            │   │
│  │ Claude Code      │    │  ┌──────────────────────┐ │   │
│  │ Codex            │    │  │ Sidecar Process      │ │   │
│  │ OpenCode         │    │  │ (node server.js)     │ │   │
│  │                  │    │  │ ready protocol       │ │   │
│  │ Direct Go calls  │    │  │ HTTP/gRPC bridge     │ │   │
│  │ Shared memory    │    │  └──────────────────────┘ │   │
│  │                  │    │                            │   │
│  └──────────────────┘    │  ┌──────────────────────┐ │   │
│                          │  │ MCP Server           │ │   │
│  Extension interfaces   │  │ (tools/list +        │ │   │
│  SessionManager         │  │  tools/call)          │ │   │
│  PermissionBroker       │  │ AgentHub as MCP client│ │   │
│  InteractiveControl     │  └──────────────────────┘ │   │
│                          │                            │   │
│                          │  ┌──────────────────────┐ │   │
│                          │  │ CloudCLI-style Plugin│ │   │
│                          │  │ manifest.yaml        │ │   │
│                          │  │ RPC proxy (HTTP)     │ │   │
│                          │  └──────────────────────┘ │   │
│                          └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Comparison Table

| Dimension | Built-in Adapter | External Adapter (Sidecar) | External Adapter (MCP) |
|-----------|-----------------|---------------------------|----------------------|
| **Language** | Go | Any (Node.js, Python, Rust) | MCP protocol (any) |
| **Distribution** | Compiled into runner binary | Separate process, installed separately | MCP server, discovered via config |
| **Registration** | `init()` self-registration | `manifest.yaml` + ready protocol | MCP `tools/list` |
| **Communication** | Direct function calls | HTTP/gRPC via RPC proxy | MCP `tools/call` |
| **Performance** | Zero overhead | Subprocess overhead | MCP protocol overhead |
| **Hot-reload** | No (recompile) | Yes (restart process) | Yes (reconnect) |
| **Streaming** | Native Go channel | HTTP SSE / WebSocket | MCP notifications |
| **Concurrency** | Shared memory | Per-process isolation | Per-connection |
| **Security** | Same process | Process isolation (SIGTERM/SIGKILL) | MCP auth |
| **Permissions** | Function-level | manifest `permissions: []` | MCP capabilities |
| **Update** | Rebuild runner | `git pull` + restart | MCP server update |
| **Reference** | Flowise NodesPool | CloudCLI plugin-process-manager | langflow MCP Composer |

### 4.3 Built-in Adapter Development Pattern

Built-in adapters live in the AgentHub monorepo:

```
packages/adapter/
├── registry/           # Global registry (shared)
├── discovery/          # External adapter discovery (shared)
├── lifecycle/          # Process management (shared)
├── claude-code/        # Built-in: Claude Code
│   ├── adapter.go
│   ├── parser.go       # NDJSON -> AgentEvent
│   ├── permissions.go  # can_use_tool control protocol
│   └── ...
├── codex/              # Built-in: Codex
│   ├── adapter.go
│   ├── parser.go       # Rollout trace -> AgentEvent
│   └── ...
└── opencode/           # Built-in: OpenCode
    ├── adapter.go
    ├── parser.go       # SSE -> AgentEvent
    └── ...
```

Each built-in adapter is a separate Go package with an `init()` that calls `registry.Register()`. The runner imports all built-in adapters via blank imports.

From cross-analysis-adapters.md Section 5 (Next Steps):
> P0: Implement ClaudeCodeAdapter first -- the NDJSON protocol is the most mature.
> P1: Implement CodexAdapter with rollout replay.
> P1: Implement OpenCodeAdapter with HTTP server lifecycle management.

### 4.4 External Adapter Development Pattern

External adapters follow the CloudCLI plugin pattern (cloudcli.md Section 2):

**Sidecar process adapter:**

```
my-external-adapter/
├── manifest.yaml         # Plugin metadata
├── package.json          # Node.js package
├── server.js             # Sidecar entry (ready protocol)
├── adapter.js            # Normalization logic
└── README.md
```

`server.js` implements the **ready protocol**:

```javascript
// server.js -- Sidecar process for AgentHub
// Reference: CloudCLI startPluginServer (cloudcli.md Section 2.5)
import http from 'http';

const port = process.env.AGENTHUB_PORT || 0; // 0 = OS-assigned
const server = http.createServer(handleRequest);
server.listen(port, () => {
    // Ready signal: JSON line on stdout
    const addr = server.address();
    process.stdout.write(JSON.stringify({ ready: true, port: addr.port }) + '\n');
});

async function handleRequest(req, res) {
    // RPC proxy endpoint
    if (req.url.startsWith('/rpc/')) {
        // Handle AgentHub RPC calls
    }
}
```

**MCP server adapter** (from langflow.md Section 4 -- three-tier MCP):

The adapter itself is an MCP server. AgentHub is the MCP **client**.

```json
// .agenthub/mcp.json
{
  "mcpServers": {
    "my-agent-adapter": {
      "transport": "stdio",
      "command": "node",
      "args": ["my-agent-mcp-server.js"]
    }
  }
}
```

The MCP server exposes:
- `tools/list` -- returns available tool definitions
- `tools/call` -- executes a tool and returns the result

This is the langflow "Path C" (External MCP Server), where the adapter's capabilities are discovered at runtime via MCP protocol rather than declared in a manifest.

### 4.5 When to Use Which

```
Will the adapter be maintained in the AgentHub monorepo?
  ├─ YES → Built-in (Go, init() registration)
  └─ NO  → Is the agent a simple CLI with structured output?
            ├─ YES → Config-based (AgentHub config YAML)
            └─ NO  → Does the agent require complex logic or state?
                      ├─ YES → External Sidecar (manifest.yaml + ready protocol)
                      └─ NO  → Can the agent expose its tools via MCP?
                                ├─ YES → MCP Server adapter
                                └─ NO  → External Sidecar
```

---

## 5. Adapter Development Checklist

Inspired by opencode.md Section 1 (19 plugin hooks), cloudcli.md Section 2.2 (manifest validation), and cross-analysis-adapters.md Section 2.3 (Interface Coverage Map).

### 5.1 Pre-Development

- [ ] **Study the target agent's CLI/API**
  - [ ] Document the invocation command (non-interactive mode)
  - [ ] Document the output format (JSON, NDJSON, plain text, SSE)
  - [ ] Identify the completion signal (exit code? final event?)
  - [ ] List all native event types and their structure
  - [ ] Document any known quirks or gotchas (see cross-analysis-adapters.md Section 3 for examples)
  - Reference: cross-analysis-adapters.md Section 1.1 "Startup & Process Model"

- [ ] **Map native events to AgentEvent types**
  - [ ] Create an event mapping table (see cross-analysis-adapters.md Section 4.1)
  - [ ] Identify which AgentEvent types are REQUIRED vs optional
  - [ ] Determine MCP tool naming convention (`mcp__<server>__<tool>` normalization)
  - Reference: cross-analysis-adapters.md Section 4.2 "Tool Name Normalization"

- [ ] **Choose registration mode**
  - [ ] Built-in (Go, init()) -- if maintained in AgentHub monorepo
  - [ ] External Sidecar (manifest.yaml) -- if separate repo, complex logic
  - [ ] MCP Server -- if agent tools can be exposed via MCP
  - [ ] Config-based -- if simple CLI wrapper with structured output

### 5.2 Core Implementation

- [ ] **`Metadata()`**
  - [ ] Return `Name` (kebab-case identifier, e.g., `"my-agent"`)
  - [ ] Return `Version` (adapter implementation version, semver)
  - [ ] Return `AgentVersion` (underlying CLI version, via `--version`)
  - Reference: cross-analysis-adapters.md Section 2.2 "AdapterMetadata"

- [ ] **`Capabilities()`**
  - [ ] Set ALL boolean fields explicitly (no zero-value ambiguity)
  - [ ] `Streaming` -- does the agent support real-time event streaming?
  - [ ] `SessionPersist` -- do sessions survive process restart?
  - [ ] `Fork` -- does the agent support session forking?
  - [ ] `MultiAgent` -- does the agent support sub-agent spawning?
  - [ ] `PermissionHooks` -- can the adapter intercept tool execution?
  - [ ] `Sandbox` -- does the agent support OS-level sandboxing?
  - [ ] `ThinkingVisible` -- is reasoning content exposed in the stream?
  - [ ] `MCPIntegration` -- can MCP tools be registered?
  - [ ] `StreamingToolExec` -- can tools execute during API streaming?
  - [ ] `Compaction` -- does the agent auto-compact context?
  - [ ] `ResumeLast` -- does the agent support `--resume-last`?
  - [ ] `Steer` -- does the agent support mid-turn message injection?
  - Reference: cross-analysis-adapters.md Section 2.2 "AgentCapabilities"

- [ ] **`Start(ctx, req)`**
  - [ ] Validate `StartRequest` parameters
  - [ ] Map `StartRequest` to native CLI args or HTTP body
  - [ ] Launch subprocess or dial HTTP connection
  - [ ] Return `AgentSession` with unique session ID
  - [ ] Set initial `Status = StatusStarting`
  - [ ] Handle startup errors gracefully (timeout, binary not found)
  - Reference: cross-analysis-adapters.md Section 2.2 "StartRequest", "Start()"

- [ ] **`AttachStream(ctx, sessionID)`**
  - [ ] Create buffered channel (`make(chan AgentEvent, 64)`)
  - [ ] Start goroutine for stream consumption
  - [ ] Parse raw output lines/events
  - [ ] Normalize to AgentEvent (call parser.go)
  - [ ] Emit `system_init` as the FIRST event (if available)
  - [ ] Emit content and tool events in order
  - [ ] Emit `result` as the LAST event (always)
  - [ ] Close channel on stream end
  - [ ] Handle context cancellation (via `EventStream.Cancel`)
  - [ ] Handle abnormal termination: set `EventStream.Err`
  - Reference: cross-analysis-adapters.md Section 2.2 "EventStream"

- [ ] **`Resume(ctx, sessionID)`** (optional)
  - [ ] Return `ErrNotSupported` if the agent does not support session reuse
  - Otherwise: reconnect to existing session, return `AgentSession`

### 5.3 Stream Parsing

- [ ] **Parser implementation (`parser.go`)**
  - [ ] Define native event structs for deserialization
  - [ ] Implement state machine if the agent has multi-line events
  - [ ] Handle partial/incomplete lines (buffered scanner)
  - [ ] Map each native event type to the correct AgentEventType
  - [ ] Track monotonic sequence number (`Seq`)
  - [ ] Preserve raw event in `AgentEvent.Raw` for debugging
  - [ ] Handle stderr output separately (do NOT emit as AgentEvent)
  - Reference: kanna.md Section 3.7 (normalizeClaudeStreamMessage pattern)
  - Reference: cross-analysis-adapters.md Section 3 per-agent workarounds

- [ ] **Text content handling**
  - [ ] Mark streaming deltas as `TextPhaseDelta`
  - [ ] Mark final block as `TextPhaseBlockEnd`
  - [ ] Assign unique `MessageID` per turn
  - Reference: cross-analysis-adapters.md "AssistantTextPayload"

- [ ] **Tool call handling**
  - [ ] Map `tool_call` events with `ToolCallPending` status
  - [ ] Map `tool_result` events with `ToolCallCompleted`/`ToolCallFailed`
  - [ ] Normalize MCP tool names to `mcp__<server>__<tool>`
  - [ ] Track tool call ID for call/result matching
  - Reference: cross-analysis-adapters.md "ToolCallPayload", "ToolResultPayload"

- [ ] **Result handling**
  - [ ] Detect the final/termination event
  - [ ] Map to correct `ResultSubtype` (success, error_during_execution, error_max_turns, etc.)
  - [ ] Extract cost and usage information if available
  - [ ] Extract error messages if the turn failed
  - [ ] Always emit `result` as the LAST event on the channel
  - Reference: cross-analysis-adapters.md "ResultPayload"

### 5.4 Extension Interfaces (Optional, Capability-Gated)

- [ ] **SessionManager** (if `SessionPersist` or `Fork` capability)
  - [ ] `ForkSession` -- copy transcript + create new session
  - [ ] `ListSessions` -- enumerate stored sessions
  - [ ] `GetSessionInfo` -- return metadata for a session
  - [ ] `GetMessages` -- replay events from persisted transcript
  - Reference: cross-analysis-adapters.md Section 2.2 "SessionManager"

- [ ] **PermissionBroker** (if `PermissionHooks` capability)
  - [ ] `SetPermissionCallback` -- register AgentHub's approval hook
  - [ ] `ResolvePermission` -- block on tool execution until decision
  - [ ] Call the callback before executing any tool
  - [ ] Handle "allow"/"deny"/"ask_user" behaviors
  - [ ] Support modified input from approval engine
  - Reference: cross-analysis-adapters.md Section 2.2 "PermissionBroker"
  - Reference: kanna.md Section 3.5 (tool gating pattern)

- [ ] **InteractiveControl** (if `Steer` capability)
  - [ ] `Cancel` -- terminate the current turn gracefully
  - [ ] `SendSteer` -- inject mid-turn message (with ReplaceLast flag)
  - [ ] `Drain` -- wait for background tasks to complete after result
  - Reference: cross-analysis-adapters.md Section 2.2 "InteractiveControl"
  - Reference: kanna.md Section 3.4 (steer mode + drainingStreams pattern)

### 5.5 Registration & Packaging

- [ ] **For Built-in Adapters:**
  - [ ] Add `init()` with `registry.Register("name", factory)`
  - [ ] Add blank import in runner's `main.go`
  - [ ] Ensure no import cycles with registry package
  - Reference: Section 3.2 Layer 1

- [ ] **For External Sidecar Adapters:**
  - [ ] Create `manifest.yaml` with all required fields
  - [ ] Validate against manifest schema:
    - [ ] `name`: regex `^[a-zA-Z0-9_-]+$`
    - [ ] `displayName`: non-empty
    - [ ] `transport.type`: "subprocess" | "http" | "sidecar"
    - [ ] `entry` / `server`: no path traversal (`..`)
  - [ ] Implement ready protocol (stdout `{"ready":true,"port":<number>}`)
  - [ ] Handle SIGTERM gracefully (cleanup, close connections)
  - Reference: cloudcli.md Section 2.2 (manifest schema + validation)

- [ ] **For MCP Server Adapters:**
  - [ ] Implement MCP `tools/list` returning tool definitions
  - [ ] Implement MCP `tools/call` executing tools
  - [ ] Add server to AgentHub's MCP config
  - Reference: langflow.md Section 4 (three-tier MCP pattern)

### 5.6 Documentation

- [ ] **README.md**
  - [ ] What the adapter does and which agent it wraps
  - [ ] Prerequisites (CLI binary version, environment variables)
  - [ ] Configuration options (all fields, defaults)
  - [ ] Known limitations or workarounds
  - [ ] Transport model explained (subprocess / HTTP / sidecar)
  - [ ] MCP tool naming convention (if applicable)
  - [ ] Simple usage example from AgentHub config
  - Reference: cross-analysis-adapters.md Section 3 (per-agent workarounds format)

- [ ] **manifest.yaml** (for external adapters)
  - [ ] All required fields filled accurately
  - [ ] `description` field usable by AgentHub UI
  - [ ] `capabilities` match what the adapter actually implements
  - [ ] `permissions` list (fs.read, process.spawn, network.http, etc.)

### 5.7 Testing

- [ ] **Unit tests**
  - [ ] Test native event parsing with fixture data
  - [ ] Test each native-to-unified event mapping
  - [ ] Test error handling (malformed output, timeout, crash)
  - [ ] Test result extraction (success, error subtypes, usage)
  - [ ] Test MCP tool name normalization
  - [ ] Test partial line buffering (if applicable)

- [ ] **Integration tests** (using AgentHub test harness)
  - [ ] `TestBasic` -- prompt -> text response -> success result
  - [ ] `TestToolUse` -- tool call -> tool result -> final response
  - [ ] `TestCancellation` -- cancel mid-turn, verify stream closes
  - [ ] `TestPermission` -- approval request -> allow/deny -> continue
  - [ ] `TestStreaming` -- verify delta events arrive before result
  - [ ] `TestError` -- invalid prompt, binary crash, network error

- [ ] **End-to-end tests**
  - [ ] Adapter registered in AgentHub runner
  - [ ] User can select the adapter in UI/config
  - [ ] Full turn: start -> streaming events -> result
  - [ ] Session resume works (if supported)
  - [ ] Concurrent sessions do not interfere

### 5.8 Production Readiness

- [ ] **Error handling**
  - [ ] Binary not found: clear error message with path
  - [ ] Binary crash: capture stderr, set `EventStream.Err`
  - [ ] Timeout: context deadline exceeded, cleanup process
  - [ ] Invalid output: log warning, skip malformed lines, continue
  - [ ] Stderr vs stdout: separate logging channel (CC stdout-guard pattern)
  - Reference: cross-analysis-adapters.md Section 3.1 Workaround 1 (stdout guard)

- [ ] **Process lifecycle**
  - [ ] Process cleanup on context cancellation
  - [ ] Process cleanup on session close
  - [ ] Zombie process prevention (wait for exit)
  - [ ] Two-phase shutdown: SIGTERM (5s grace) -> SIGKILL
  - Reference: cloudcli.md Section 2.5 (process-manager shutdown)

- [ ] **Concurrency safety**
  - [ ] Multiple sessions do not share mutable state
  - [ ] Registry access is thread-safe (sync.RWMutex)
  - [ ] Channel operations are properly synchronized
  - [ ] No goroutine leaks (all goroutines exit on stream close)

- [ ] **Observability**
  - [ ] Log adapter startup with version info
  - [ ] Log each turn start with session ID
  - [ ] Log stream errors and abnormal terminations
  - [ ] Log permission decisions (allow/deny, reason)
  - [ ] Preserve raw events in `AgentEvent.Raw` for debugging

### 5.9 Submission Checklist (for Third-Party Adapters)

- [ ] `manifest.yaml` passes validation
- [ ] All 4 core methods implemented (`Metadata`, `Capabilities`, `Start`, `AttachStream`)
- [ ] `Resume()` returns `ErrNotSupported` or works correctly
- [ ] All 12 AgentEvent types that apply are correctly mapped
- [ ] `result` event is always the last event emitted
- [ ] MCP tools use `mcp__<server>__<tool>` naming convention
- [ ] Process cleanup works on cancel/timeout/crash
- [ ] Stderr is not mixed into the AgentEvent stream
- [ ] README.md covers prerequisites and configuration
- [ ] Unit tests pass with fixture data
- [ ] Integration tests pass with AgentHub test harness
- [ ] Adapter name is unique (no conflict with built-in adapters)

---

## Appendix A: Quick-Start Skeleton

```go
// my-adapter/adapter.go -- Minimum viable adapter
package myadapter

import (
    "context"
    "bufio"
    "encoding/json"
    "os/exec"
    "sync"

    "github.com/agenthub/agenthub/packages/protocol"
    "github.com/agenthub/agenthub/packages/adapter/registry"
)

func init() {
    registry.Register("my-agent", func(cfg protocol.AdapterConfig) (protocol.AgentAdapter, error) {
        return &Adapter{binaryPath: cfg.BinaryPath}, nil
    })
}

type Adapter struct {
    binaryPath string
    mu         sync.Mutex
    sessions   map[string]*sessionState
}

type sessionState struct {
    cmd    *exec.Cmd
    stdout io.ReadCloser
}

func (a *Adapter) Metadata() protocol.AdapterMetadata {
    return protocol.AdapterMetadata{Name: "my-agent", Version: "0.1.0"}
}

func (a *Adapter) Capabilities() protocol.AgentCapabilities {
    return protocol.AgentCapabilities{Streaming: true}
}

func (a *Adapter) Start(ctx context.Context, req protocol.StartRequest) (*protocol.AgentSession, error) {
    cmd := exec.CommandContext(ctx, a.binaryPath, "--prompt", req.Prompt)
    stdout, _ := cmd.StdoutPipe()
    cmd.Start()

    sessionID := generateID()
    a.sessions[sessionID] = &sessionState{cmd: cmd, stdout: stdout}

    return &protocol.AgentSession{ID: sessionID, Status: protocol.StatusRunning}, nil
}

func (a *Adapter) Resume(ctx context.Context, sessionID string) (*protocol.AgentSession, error) {
    return nil, fmt.Errorf("resume not supported")
}

func (a *Adapter) AttachStream(ctx context.Context, sessionID string) (*protocol.EventStream, error) {
    state := a.sessions[sessionID]
    ch := make(chan protocol.AgentEvent, 64)
    ctx, cancel := context.WithCancel(ctx)

    go func() {
        defer close(ch)
        defer state.cmd.Wait()
        scanner := bufio.NewScanner(state.stdout)
        seq := 0
        for scanner.Scan() {
            seq++
            var native map[string]any
            json.Unmarshal(scanner.Bytes(), &native)
            // Normalize native -> AgentEvent ...
            ch <- protocol.AgentEvent{Seq: seq, SessionID: sessionID, Type: protocol.EventAssistantText, ...}
        }
        ch <- protocol.AgentEvent{Type: protocol.EventResult, ...}
    }()

    return &protocol.EventStream{C: ch, Cancel: cancel}, nil
}
```

## Appendix B: Event Mapping Template

Use this template when designing your native-to-AgentEvent mapping:

| Native Event Type | AgentHub AgentEvent | Payload Struct | Notes |
|------------------|--------------------|---------------|-------|
| `init`           | `system_init`     | `SystemInitPayload` | Model, tools, permissions |
| `text_start`     | `assistant_text`  | `AssistantTextPayload` (delta) | |
| `text_delta`     | `assistant_text`  | `AssistantTextPayload` (delta) | |
| `text_end`       | `assistant_text`  | `AssistantTextPayload` (block_end) | |
| `thinking`       | `reasoning`       | `ReasoningPayload` | Only if thinking is visible |
| `tool_call`      | `tool_call`       | `ToolCallPayload` (pending) | |
| `tool_output`    | `tool_result`     | `ToolResultPayload` | Match by ToolCallID |
| `tool_error`     | `tool_result`     | `ToolResultPayload` (IsError: true) | |
| `done`           | `result`          | `ResultPayload` | Always LAST event |
| `error`          | `result`          | `ResultPayload` (IsError: true) | |
| `status`         | `status_change`   | `StatusChangePayload` | Optional |

## Appendix C: Cross-Reference Index

| This Document Section | Primary Source | Secondary Sources |
|---|---|---|
| 1.1 Step-by-step flow | cross-analysis-adapters.md Section 2 | Section 5 (Next Steps) |
| 1.2 Minimum adapter | cross-analysis-adapters.md Section 2.2 | Section 2.3 (coverage map) |
| 1.3 Registration modes | flowise.md Section 3.2.3 (NodesPool) | cloudcli.md Section 2.2 (manifest) |
| 1.4 Registration comparison | flowise.md + cloudcli.md | kanna.md (ProviderCatalog) |
| 2.1 Directory layout | cross-analysis-adapters.md Section 3 (per-agent) | opencode.md Section 1 (plugin layout) |
| 2.2 File responsibilities | cross-analysis-adapters.md Section 2.2 | Section 3 workarounds |
| 3.1 Registry Layer 1 | flowise.md Section 3.2.3 | kanna.md Section 3.1 (Node DLL) |
| 3.2 Registry Layer 2 | cloudcli.md Section 2.2 | opencode.md Section 1.3 (loader) |
| 3.3 Registry Layer 3 | cloudcli.md Section 2.5 | opencode.md Section 5.1 Workaround 1 |
| 4. Built-in vs External | flowise.md Section 3.2 (monorepo) | cloudcli.md Section 2 (plugin system) |
| 4.4 Sidecar ready protocol | cloudcli.md Section 2.5 | kanna.md Section 3.6 (AsyncMessageQueue) |
| 4.4 MCP server adapter | langflow.md Section 4 (three-tier MCP) | opencode.md Section 4 (MCP management) |
| 5. Checklist | opencode.md Section 1 (19 hooks) | cross-analysis-adapters.md Section 2.3 (coverage) |
| App A. Skeleton | cross-analysis-adapters.md Section 2.2 | kanna.md Section 3.7 (normalization) |
| App B. Event mapping template | cross-analysis-adapters.md Section 4.1 | kanna.md Section 3.7 |

---

*Design complete. 2026-05-21.*
