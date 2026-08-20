<div align="center">
  <img src="app/desktop/src/assets/agenthub-product-icon-rounded.svg" width="96" alt="AgentHub" />

  # AgentHub

  Invite AI agents as teammates into your group chat. Real people, AI Builder, AI Reviewer — all in the same IM conversation. Messages are your task stream. Chat is your workbench.

  [中文](README.md) · [Website](https://hub.vectorcontrol.tech) · [Docs](https://hub.vectorcontrol.tech/docs) · [API](api/)

  [![CI](https://img.shields.io/github/actions/workflow/status/TokenDanceLab/AgentHub/checks.yml?branch=master&style=flat-square&label=CI)](https://github.com/TokenDanceLab/AgentHub/actions/workflows/checks.yml)
  [![release](https://img.shields.io/github/v/release/TokenDanceLab/AgentHub?style=flat-square)](https://github.com/TokenDanceLab/AgentHub/releases)
  ![go](https://img.shields.io/badge/go-1.26+-00ADD8?style=flat-square&logo=go)
  ![react](https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react)
  ![tauri](https://img.shields.io/badge/tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=black)
  [![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square)](https://github.com/TokenDanceLab/AgentHub/blob/master/LICENSE)
</div>

<div align="center">
  <img src="docs/images/desktop-workbench-preview.png" alt="AgentHub Desktop Workbench" width="800" />
</div>

## What is AgentHub?

AgentHub lets you collaborate with human teammates and AI agents in the same group chat. Drop real people, Builder, Reviewer, Researcher, and Deployer agents into a shared project session — they work together on code, documents, diffs, previews, approvals, and artifacts.

## Key Features

- **IM-native collaboration** — DMs, group chats, @agent mentions — all in one task stream
- **Multi-runtime dispatch** — Claude Code, Codex, OpenCode through a unified adapter interface
- **Diff / Preview / Approval** — inline code changes, review workflows
- **Three native clients** — Tauri Desktop + Web + Expo React Native Mobile (Desktop/Web are the mainline; Mobile in assembly)
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

Minimal local bootstrap (5 steps). Requires Docker, Go 1.26+, Node 22+/corepack, pnpm 10+.

```bash
cp .env.example .env                        # 1. Copy dev env vars (includes dev defaults)
docker compose up -d postgres redis         # 2. Start infra (PG16 + Redis7, 127.0.0.1 only)
cd hub-server && go run ./cmd/server-hub    # 3. Start Hub Server (auto-migrates; API on :8080)
cd ../app && corepack pnpm install          # 4. Install frontend deps
pnpm dev                                    # 5. Start Desktop Vite (:5173); web uses pnpm dev:web
```

Full bootstrap, OIDC setup, and Edge Server debugging: [docs/developer-quickstart.md](docs/developer-quickstart.md). Production deployment and required vars: [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md).

## Development

| Entry | Description |
|---|---|
| [docs/developer-quickstart.md](docs/developer-quickstart.md) | Shortest local bootstrap path |
| [docs/architecture.md](docs/architecture.md) | Architecture overview and module index |
| [docs/README.md](docs/README.md) | Docs navigation |
| [AGENTS.md](AGENTS.md) | Project rules SSOT (branch, red lines, evidence grades) |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
