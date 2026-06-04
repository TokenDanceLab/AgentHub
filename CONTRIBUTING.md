# Contributing to AgentHub

## Getting Started

1. Clone and checkout the development branch:
   ```powershell
   git clone <repo-url>
   cd AgentHub
   git checkout dev/delicious233
   ```

2. Run setup to enable git hooks and verify tooling:
   ```powershell
   # Windows
   .\scripts\setup.ps1

   # macOS / Linux
   ./scripts/setup.sh
   ```

3. Read `AGENTS.md` for project conventions, architecture boundaries, and agent workflow rules.

## Development Flow

- Always branch from `dev/delicious233` (master is lagging behind).
- Sync before starting:
  ```powershell
  git checkout dev/delicious233
  git pull --ff-only
  ```
- Branch naming: `feat/xxx`, `fix/xxx`, `docs/xxx`, `refactor/xxx`
- Commit format:
  ```
  type(scope): 中文摘要
  ```
  Types: `init|feat|fix|docs|refactor|chore|test|perf|ci|revert`
- PR to `dev/delicious233`, not master directly.
- Keep PRs small and focused. Rebase onto latest `dev/delicious233` before opening a PR.
- Push frequently -- do not leave uncommitted changes across days.

## Testing

| Layer | Command |
|-------|---------|
| Edge Server | `cd edge-server && go test ./... -short -count=1` |
| Hub Server | `cd hub-server && go test ./... -short -count=1` |
| Desktop (unit) | `cd app/desktop && pnpm test` |
| Desktop (typecheck) | `cd app/desktop && pnpm typecheck` |
| Web (build) | `cd app/web && pnpm build` |
| Web (typecheck) | `cd app/web && corepack.cmd pnpm typecheck` (Windows) |

For Edge changes, also run:
```powershell
.\scripts\verify-runtime-readiness.ps1
```

For security-sensitive changes, run:
```powershell
.\scripts\verify-ci-gates.ps1 -StrictReleaseGate
```

## Code Style

| Language | Tool |
|----------|------|
| Go | Standard `gofmt` formatting |
| TypeScript | Prettier + ESLint (`pnpm lint`) |
| Styles | CSS Modules + OKLCH design tokens (`var(--primary)`, `var(--border)`) |

- Documentation and commit messages in Chinese; code identifiers, paths, API fields, and CLI commands in English.
- Use `@shared/ui` for all reusable components -- do not create duplicate local UI copies in desktop or web.
- Run `git diff --check` before committing to catch whitespace errors.

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `app/desktop/` | Tauri desktop app (port 5173) |
| `app/mobile/` | Tauri mobile app (port 5174) |
| `app/web/` | Web workbench (port 5175 reserved) |
| `app/shared/` | Shared UI, types, API client (`@agenthub/shared`) |
| `hub-server/` | Hub: accounts, IM, sync, relay (port 8090) |
| `edge-server/` | Edge: execution node, runtime adapters (port 3210) |
| `api/` | REST OpenAPI spec + WebSocket event contract |
| `docs/` | Guides, architecture, governance, handoff, operations, roadmaps, reference, archive |
| `scripts/` | Setup, dev start/stop, verification scripts |

Desktop and Mobile are independent Tauri projects. Do not modify each other's `tauri.conf.json`, `Cargo.toml`, or `lib.rs`.

## Security

- Never commit `.env`, API keys, tokens, cookies, private keys, certificates, SSH configs, or production database connection strings.
- Use `.env.example` as a template with placeholder values.
- Server aliases (hk1, hk2, us1, gz1) must not appear in repository files.
- Production secrets live in `.env.production` (already in `.gitignore`).
- Check diff output for sensitive data before pushing.
- If you accidentally commit secrets, stop pushing immediately, notify the maintainer, rotate keys, then clean up git history.
- Report security issues privately -- do not file public issues.

## Architecture Boundaries

- **Agent Runtime** (what runs): Claude Code, Codex, OpenCode CLI/SDK adapters in `edge-server/internal/adapters/`
- **Agent Profile** (who acts): User-managed agent entities combining Runtime + Model + Skill + MCP + approval policy
- **Agent Configuration**: Rules, memory, context, chat history, working directory
- **Execution Target** (where it runs): Local Edge, Remote Edge, Cloud Edge, Hub Relay

Local execution does not require Hub. Hub enters the path for accounts, cloud IM, multi-device sync, remote viewing/approval, device routing, and relay.

## Documentation

- Three primary docs: product requirements, system architecture, implementation guide
- Reference and research go in `docs/reference/`; historical proposals in `docs/archive/`
- Before modifying APIs, read `api/README.md`, `api/openapi.yaml`, `api/events.md`
- Before auth/i18n/Feishu changes, read the corresponding docs under `../docs/` (TokenDance workspace level)
