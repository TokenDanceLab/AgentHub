# Competitor Analysis: IDE Extensions (Cline + Continue)

> Researcher 2: VS Code extensions handle agent chat fundamentally differently from desktop apps -- they integrate with the IDE's native capabilities.

## 1. Cline (VS Code Extension + CLI + Kanban)

### Architecture
- **Extension model**: VS Code Extension API + webview UI (React)
- **Communication**: gRPC-like protocol over VS Code message passing
  - Proto files in `proto/` define all message types
  - Generated TypeScript types from protobuf (nice-grpc for promise-based clients)
  - Separate proto domains: task, ui, state, models, account
- **Core**: `src/core/` -- task execution, tool handling, prompts, slash commands
- **Webview UI**: `webview-ui/` -- React app with Storybook components
- **SDK**: `sdk/` -- programmable API for embedding Cline
  - `packages/` -- reusable packages
  - `apps/cli/` -- CLI entry point
  - `apps/kanban/` -- web-based task board for parallel agents

### Unique Features
1. **Kanban Mode**: Run multiple AI agents in parallel from a web task board
   - Each card gets its own worktree
   - Auto-commit
   - Dependency chains between tasks
2. **Focus Chain**: Parallel agent orchestration for complex tasks
3. **Standalone Mode**: Run Cline outside VS Code as CLI or API
4. **Proto-based Comm**: Type-safe message passing between extension and webview
5. **Protobus Service**: Internal message bus for inter-process communication
6. **Hook System**: Pre/post tool execution hooks, command sequences

### Chat/UI Handling
- **ChatRow.tsx**: Complex message rendering with:
  - Status-based display (generating, complete, error)
  - Cancelled/interrupted state detection (non-obvious pattern: check `!isLast` + `resume_task` ask type)
  - Tool call visualization
  - Browser session integration
- **slashCommands.ts**: Autocomplete for `/` commands in chat
- **context-mentions.ts**: `@` mentions for files, folders, problems
- **ChatContent.ts**: Simple interface `{message, images[], files[]}`
- **ChatRow Cancellation Pattern**:
  ```typescript
  const wasCancelled = status === "generating" &&
      (!isLast || lastModifiedMessage?.ask === "resume_task" ||
       lastModifiedMessage?.ask === "resume_completed_task")
  ```

### Provider/Model System
- **15+ providers**: Anthropic, OpenAI, Google, OpenRouter, Ollama, etc.
- **Model Families**: generic, next-gen, native-next-gen, gpt-5, gemini-3, xs, hermes, glm
- **Responses API**: Native tool calling for OpenAI Codex
- **Provider Conversion Layer**: Two-way proto conversion (string <-> enum)
- **Model features**: Thinking budgets, extended thinking, native tool calls

### Tool System
- **Tool definitions**: Modular files in `src/core/prompts/system-prompt/tools/`
- **Variants per model family**: Generic, Native Next-Gen, XS, etc.
- **Auto-fallback**: Tools not defined for a model family auto-fallback to GENERIC
- **Handlers**: In `src/core/task/tools/handlers/`
- **Tool gating**: User approval flow for tool execution

### System Prompt Architecture
- **Components**: Reusable sections (rules, capabilities, editing_files, etc.)
- **Variants**: Model-specific overrides (generic/, next-gen/, xs/, gpt-5/, gemini-3/)
- **Templates**: `{{PLACEHOLDER}}` resolution with template engine
- **Variant tiers**: Next-gen (Claude 4, GPT-5) / Standard (generic) / Local (xs)

### Networking
- **Proxy-aware fetch**: `import { fetch } from '@/shared/net'` -- mandatory for JetBrains/CLI
- **axios wrapper**: `getAxiosSettings()` injects proxy agent
- **Third-party clients**: Must pass custom fetch to OpenAI, Ollama, etc.

---

## 2. Continue (VS Code / JetBrains Extension)

### Architecture (from file structure)
- **Monorepo**: Multiple packages in a single repo
- **Extension core**: `.continue/` directory with agents, checks, environment config
- **Agent system**: Specialized agents for specific tasks
  - breaking-change-detector
  - dependency-security-review
  - error-message-quality
  - input-validation
  - test-coverage
- **Check system**: Automated code review checks
  - anti-slop
  - react-best-practices
  - security-audit
  - setup-scripts
- **Environment config**: `.continue/environment.json`

### Key Differentiators from Cline
1. **Inline editing**: Continue pioneered inline code editing in the IDE
2. **Diff viewing**: Side-by-side diff within the IDE native interface
3. **File tree integration**: Deep integration with VS Code's file explorer
4. **Agent specialization**: Task-specific agents rather than one general agent
5. **Check system**: Automated quality gates as part of the development workflow

---

## 3. IDE Extension vs Desktop App Patterns

### What IDE Extensions Do Better (that desktop apps can't)
| Capability | Why Desktop Can't Match |
|-----------|------------------------|
| Inline code editing | Requires direct IDE access to text buffers |
| Native diff viewing | Uses VS Code's built-in diff editor |
| File tree context | IDE knows which files are open, modified, selected |
| Symbol awareness | LSP integration for go-to-definition, references |
| Problem/error integration | Direct access to diagnostics panel |
| Selection-based actions | User can select code and ask agent about it |
| Multi-file edit preview | IDE's native change preview (before saving) |

### What Desktop Apps Do Better
| Capability | Why Desktop Wins |
|-----------|-----------------|
| System-wide access | Can interact with any app, not just the editor |
| Background operation | Runs even when IDE is closed |
| Native performance | No extension host overhead |
| Custom window management | Multiple windows, resize, positioning |
| File system operations | Direct fs access without IDE sandboxing |
| Terminal integration | Full PTY support, multiple terminals |
| Notifications | System-level notifications |

---

## 4. Patterns We Can Translate to Desktop

### From Cline
1. **Proto-based communication** -> Rust structs with serde for our Tauri IPC
2. **Modular tool system with variants** -> Different agent providers have different tool capabilities
3. **Kanban/worktree integration** -> Can adapt for AgentHub's multi-agent task management
4. **Hook system** -> Pre/post agent action hooks for workflows
5. **Focus Chain** -> AgentHub's multi-agent orchestration can use dependency chains
6. **Cancellation state detection** -> Important for our chat UI (was this message cancelled mid-stream?)
7. **Network proxy awareness** -> Essential if AgentHub needs to work in corporate environments

### From Continue
1. **Agent specialization** -> Different agent types for different tasks (our multi-agent model)
2. **Check system** -> Automated quality validation after agent actions
3. **Inline diff preview** -> We can render diffs inline in chat (Jean does this with @pierre/diffs)
4. **Context awareness** -> Pass relevant context (open files, recent changes) to agents

---

## 5. Cross-Cutting Questions

### How do they handle the chat input area?
- **Cline**: Webview textarea with `/` slash commands and `@` file mentions
- **Continue**: Sidebar chat input, with IDE-native context attachment
- Pattern: File/@ mentions are critical for IDE context -- desktop apps need equivalents (file path mentions, recent file list)

### How do they display agent thinking/reasoning?
- **Cline**: Thinking content shown as specialized ChatRow sections with collapsible display
- **Continue**: Expandable reasoning sections in chat

### How do they handle tool calls?
- **Cline**: Tool calls are rendered as structured ChatRow components:
  - Each tool has a specific rendering component
  - Browser tools: BrowserSessionRow with tab state
  - File tools: Diff preview integrated
  - Command tools: Terminal output with syntax highlight
  - Approval gate before execution
- **Continue**: Inline tool feedback integrated with IDE UI

### What design tokens are used?
- **Cline**: VSCode theme variables (adapts to user's VS Code theme automatically)
- **Continue**: VS Code native theme integration

### ONE thing each does better than anyone else?
- **Cline**: **Extreme modularity** -- the variant-based system prompt architecture means Cline optimizes prompts for every specific model family, from tiny local models to Claude 4. This is textbook prompt engineering at scale.
- **Continue**: **Deep IDE integration** -- Continue feels like a native part of the editor, not a bolted-on chat window. The inline editing and diff preview make AI assistance feel fluid and natural.

---

## 6. Borrow/Adapt/Ignore for AgentHub

### BORROW
| Feature | Source | Why |
|---------|--------|-----|
| Proto/type-safe IPC messages | Cline | Apply to our Rust<->React Tauri commands |
| Modular tool capability system | Cline | Different agents have different tool sets |
| /commands + @mentions in input | Cline | Essential UX for agent chat |
| Status-based message rendering | Cline | Handle streaming, done, error, cancelled states |
| Hook system | Cline | Pre/post agent action hooks |

### ADAPT
| Feature | Source | How to Adapt |
|---------|--------|-------------|
| Kanban multi-agent | Cline | AgentHub's multi-agent view could be kanban-style |
| Variant system prompts | Cline | Per-agent-type system prompts for multi-agent |
| Inline diff preview | Continue | Show diffs in chat with accept/reject (like Jean) |
| Check/validation system | Continue | Post-agent quality gates |
| Slash commands | Cline | Our own command palette for agent actions |

### IGNORE
| Feature | Reason |
|---------|--------|
| Proto/gRPC layer | We already have Tauri invoke/IPC |
| VS Code theme integration | Desktop app, not IDE extension |
| LSP integration | Desktop context, not IDE |
| IDE diagnostic integration | Not applicable |
