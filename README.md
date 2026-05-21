<div align="center">

# AgentHub

## IM-native Multi-Agent Collaboration Platform

Chat with AI Agents like teammates. @mention them, create group chats, watch code, diffs, and previews unfold inline.

[中文文档](README_ZH.md) &nbsp;·&nbsp; [Architecture](docs/architecture.md) &nbsp;·&nbsp; [Research](docs/reference/)

<img src="https://img.shields.io/badge/status-research-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.24+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license">

</div>

<br>

## What is AgentHub

AgentHub turns AI coding agents into IM contacts. Instead of switching between terminals and IDEs, you chat with Claude Code, Codex, and OpenCode in a group chat — like you chat with teammates on Feishu or Slack.

**vs. existing tools**: Most Claude Code GUIs are single-player chat shells. AgentHub is a multi-agent collaboration platform — plan with an orchestrator, code with Claude Code, review with a reviewer agent, all in one conversation thread.

<br>

## Architecture

```
Desktop UI ─→ Edge Server ─→ Runner ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| Component | Dir | Responsibility |
|-----------|-----|---------------|
| **Hub Server** | `services/hub-server/` | Central IM: users, contacts, groups, message routing, multi-device sync, Edge relay |
| **Edge Server** | `services/edge-server/` | Local node: projects, memory, context, runner management, syncs to Hub |
| **Runner** | `services/runner/` | Executor: workspace, process lifecycle, Agent CLI adapters, diff/preview/logs |
| **Web UI** | `apps/web/` | React IM interface: sidebar, message tree, diff cards, preview panel |

> Every machine that runs a Runner is an **Edge Node** — your laptop, a remote server, or a cloud VM.

<br>

## Demo Flow

```
You: @ClaudeCode build a login page with email and OAuth

Orchestrator: Task split into 3 steps — scaffold, implement, review

Claude Code: Created src/LoginPage.tsx with form validation
             [View Diff] [Apply] [Preview]

Reviewer: Found missing loading state. Suggested edge-case handling.

Claude Code: Fixed. Added useFormStatus() and error boundary.

Orchestrator: Done. Preview running at http://localhost:5173
              [Deploy] [Share] [Archive]
```

<br>

## Product Layers

| Layer | Description | Phase |
|-------|------------|:-----:|
| **Desktop Command Center** | Local project, thread, agent lifecycle, worktree, diff, approval, preview | P0 |
| **IM Collaboration** | Direct chat, group chat, @Agent, orchestrator, multi-agent review, agent progress cards | P1 |
| **Hub Network** | Accounts, friends, groups, multi-device sync, Edge relay, team memory | P2-P4 |

<br>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite + shadcn/ui |
| Hub / Edge / Runner | Go 1.24 |
| Desktop | Tauri 2 |
| Mobile | PWA |
| Realtime | WebSocket (coder/websocket) |
| Database | SQLite + FTS5 (modernc.org/sqlite) |
| Protocol | Protobuf + Buf + Connect-RPC |
| Editor | Monaco Editor |

<br>

## Quick Start

```bash
# Edge Server (local node)
cd services/edge-server && go run ./cmd/main.go

# Runner (agent executor)
cd services/runner && go run ./cmd/main.go

# Web UI
cd apps/web && pnpm dev
```

> P0 does not require Hub Server. Edge + Runner work offline.

<br>

## Project Structure

```
AgentHub/
├── apps/                   # React frontends (web, desktop, mobile)
├── services/               # Go backends (hub-server, edge-server, runner)
├── packages/               # shared Go + TS libraries
├── proto/                  # Protobuf schema, the single protocol source
├── docs/                   # architecture + reference docs
│   └── reference/          # 68 research documents, including Multica Tier-0 reference
├── .githooks/              # commit-msg + prepare-commit-msg
└── .agenthub/              # project memory and rules
```

<br>

## Documentation

| Document | Description |
|----------|------------|
| [Architecture](docs/architecture.md) | Hub-Edge-Runner topology, deployment modes, sync protocol |
| [Glossary](docs/glossary.md) | Plain-language terms for Hub, Edge, Runner, AgentRun, artifacts and protocol |
| [Project Management](docs/project-management.md) | Milestones, labels and issue grouping rules |
| [Research Index](docs/reference/) | 68 cross-repo deep-dive documents, organized for Agent navigation |
| [Implementation Roadmap](docs/reference/04-plan/01-research-to-implementation.md) | P0 minimal system, priority matrix, research-to-code mapping |
| [Protocol Schema](docs/reference/03-build/backend/13-protobuf-schema.md) | 6 .proto files + buf.gen.yaml |

<br>

## References

- [Claude Code Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Multica](https://github.com/multica-ai/multica)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [Kanna](https://github.com/jakemor/kanna)
- [CloudCLI](https://github.com/siteboon/claudecodeui)

---

<div align="center">
<a href="README_ZH.md">中文文档</a> &nbsp;·&nbsp; <a href="docs/architecture.md">Architecture</a> &nbsp;·&nbsp; <a href="docs/reference/">Research</a>
</div>
