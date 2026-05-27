# Changelog

## [0.1.0] — 2026-05-27

### Desktop Command Center (P0)
- Multi-runtime Agent CLI support (Claude Code, Codex, OpenCode)
- IM-native workspace with thread-based collaboration
- Side-by-side diff review panel with approval workflow
- Artifact preview and run output rendering
- Tauri 2 desktop shell with glassmorphism chat UI
- Operational Home dashboard, settings search, Tooltip
- Agent Profile configuration (Runtime, Model, Skill, MCP, approval policy)

### Hub Server (P1-P2)
- TokenDance ID unified login (OIDC PKCE exchange)
- Hub-local session management with access/refresh tokens
- IM contacts, group sessions, multi-device sync
- Agent dispatch bridge (Web -> Hub -> Desktop -> Edge)
- WebSocket typed events + REST JSON API (OpenAPI 3.0)
- AgentTeam models, API, and StartTeamRun orchestration
- Target-bound device routing and execution target inventory
- Team run events, conflict resolution, artifact indexing
- Approval controls queue with team decision recording
- Runtime event history, stream validation, offline task queue
- 78 database migrations (PostgreSQL + Redis)

### Edge Server
- Local execution node with Agent Runtime adapters (Claude Code, Codex, OpenCode)
- Process lifecycle management, EventStore, workspace allowlist
- Run cleanup, output budget caps, context auto-compaction engine
- SKILL.md discovery and injection into agent adapters
- AgentTree slot enforcement and mailbox trigger_turn
- Prometheus metrics and health checks
- Context budget tracking with per-child ratio enforcement

### Web App
- Browser workspace for remote viewing and approvals
- Hub typed RunEvent replay and projection
- Structured runtime message display
- Ecosystem console with Hub session authentication

### Mobile App
- Tauri 2 mobile shell with independent project configuration
- Mobile-native bubble chat, run review, approval workflow
- Bottom navigation, activity cards, context awareness
- i18n (zh/en)

### Engineering
- CI/CD: GitHub Actions (Go test/lint/race/vet, pnpm test/typecheck/build)
- Cross-platform build matrix (ubuntu, windows, macos)
- Edge >= 75% coverage, Hub >= 40% coverage (hard gate)
- golangci-lint v2, gosec, govulncheck
- Benchmark regression checks for events and adapters
- Docker build verification and Docker Compose production deployment
- Commit message format enforcement: type(scope): 中文摘要
- Secret guard, whitespace check, CI gate policy validation
