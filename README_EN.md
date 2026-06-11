<div align="center">
  <img src="app/desktop/src/assets/agenthub-product-icon-rounded.svg" width="96" alt="AgentHub" />

  # AgentHub

  Open-source AI agent collaboration workbench. Web, Desktop, and Mobile — three native clients connected to a distributed Hub-Edge architecture with unified multi-runtime scheduling.

  [中文](README.md) · [Website](https://hub.vectorcontrol.tech) · [Docs](https://hub.vectorcontrol.tech/docs) · [API](api/)

  ![version](https://img.shields.io/badge/version-0.4.0-blue?style=flat-square)
  ![go](https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go)
  ![react](https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react)
  ![tauri](https://img.shields.io/badge/tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=black)
  ![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square)
</div>

<div align="center">
  <img src="docs/images/desktop-workbench-preview.png" alt="AgentHub Desktop Workbench" width="800" />
</div>

## What is AgentHub?

AgentHub lets you collaborate with AI agents the same way you'd work with a team in a group chat. Drop Builder, Reviewer, Researcher, and Deployer agents into a shared project session — they work together on code, documents, diffs, previews, approvals, and artifacts.

## Key Features

- **IM-native collaboration** — DMs, group chats, @agent mentions — all in one task stream
- **Multi-runtime dispatch** — Claude Code, Codex, OpenCode through a unified adapter interface
- **Diff / Preview / Approval** — inline code changes, review workflows
- **Three native clients** — Tauri Desktop + Web + Expo React Native Mobile
- **Hub-Edge distributed** — local execution works offline; Hub adds multi-device sync, remote viewing, and audit

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Tauri 2 · React 19 · TypeScript · Vite |
| Web | React 19 · TypeScript · Vite |
| Mobile | React Native · Expo |
| Backend | Go · PostgreSQL · Redis · SQLite |

## Repository Structure

| Directory | Description |
|---|---|
| `app/web` | Browser workbench |
| `app/desktop` | Tauri Desktop workbench |
| `app/mobile-rn` | Expo / React Native Mobile |
| `app/shared` | Shared UI components, types, transcript logic |
| `hub-server` | Hub API: identity, sessions, projects, tasks, messages, approvals |
| `edge-server` | Local execution node: CLI adapters, SQLite, event replay |
| `api` | OpenAPI and WebSocket event contracts |
| `docs` | Architecture, roadmap, design docs |

## Quick Start

### Requirements

- Go 1.25+
- Node.js 20+
- pnpm / Corepack

### Install

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
corepack enable
corepack pnpm install --dir app --frozen-lockfile
```

### Run Hub Server

```bash
cd hub-server
go run ./cmd/server-hub
```

### Run Web Workbench

```bash
cd app
corepack pnpm --filter agenthub-web dev
```

### Run Desktop

```bash
cd app
corepack pnpm --filter agenthub-desktop dev
```

### Production Deploy

Docker Compose + Nginx. See [deployments/README.md](hub-server/deployments/README.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
