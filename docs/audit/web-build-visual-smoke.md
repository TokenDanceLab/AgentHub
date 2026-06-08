# Web Build And Visual Smoke Audit

Date: 2026-06-09
Branch/worktree: `codex/p1-web-build-visual-smoke` / `.worktrees/p1-web-build-visual-smoke`
Base HEAD: `fd94c54d` / `origin/codex/p1-remote-control-integration`

This report records deploy-readiness and local visual-smoke evidence for AgentHub Web after the rc.6 integration branch. It does not perform public deployment, live TokenDanceID login, or real CLI/model execution.

## Result

- `app/web` typecheck passed.
- Focused Web tests passed: 4 files / 36 tests.
- Shared workbench/composer tests passed: 2 files / 39 tests.
- Production Web build passed and produced `app/web/dist`.
- Web deploy-readiness gate passed: 16 passed / 0 failed.
- Web Hub-only boundary gate passed: 15 passed / 0 failed.
- Local preview visual smoke passed on `http://127.0.0.1:4174/`.
- `git diff --check` passed.

## Commands Run

Install from the committed app workspace lockfile:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app
corepack.cmd pnpm install --frozen-lockfile
```

Web typecheck:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web
corepack.cmd pnpm typecheck
```

Focused Web tests:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web
corepack.cmd pnpm exec vitest run src\platform\webPlatform.test.ts src\views\TeamRunConsole.test.tsx src\platform\useWebWorkbenchModel.test.ts src\App.test.tsx --reporter=dot
```

Focused shared workbench tests:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\shared
corepack.cmd pnpm exec vitest run src\workbench\UnifiedComposer.test.tsx src\workbench\AgentHubWorkbench.test.tsx --reporter=dot
```

Production build without deploy secrets:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web
corepack.cmd pnpm build
```

Production build with documented non-secret Hub endpoint config for final preview artifact:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web
$env:VITE_HUB_URL='https://api.hub.vectorcontrol.tech'
$env:VITE_HUB_WS_URL='wss://api.hub.vectorcontrol.tech/client/ws'
corepack.cmd pnpm build
```

Deploy-readiness and Hub-only boundary gates:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-web-deploy-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-web-hub-boundary.ps1
```

Local preview target:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web
corepack.cmd pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort
```

Visual smoke capture used Playwright against:

```text
http://127.0.0.1:4174/
```

Final diff hygiene:

```powershell
cd D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke
git diff --check
```

## Visual Smoke Evidence

Local preview target: `http://127.0.0.1:4174/`

Screenshot artifact:

```text
D:\Code\TokenDance\AgentHub\.worktrees\p1-web-build-visual-smoke\app\web\dist\visual-smoke-web-preview.png
```

The screenshot is an ignored local artifact under `app/web/dist`; it is not committed.

Playwright summary:

| Check | Result |
|---|---|
| Page title | `AgentHub Web` |
| Body text length | 2805 |
| Console warnings/errors | 0 |
| Desktop chrome detected | false |
| Tauri/Local Edge text detected | false |
| Viewport | 1440 x 1000 |

The rendered UI showed the AgentHub Web workbench with rail, conversation sidebar, workspace transcript, composer, and right inspector. No fake Desktop chrome or direct Local Edge/Tauri surface was observed.

## Evidence Boundary

- UI content is fixture/mock evidence, not live production or real user data.
- No real TokenDanceID login was performed.
- No public deploy, artifact upload, push, merge, or tag was performed.
- No direct Local Edge, Desktop/Tauri bridge, or local file capability was used by the Web app.
- No secrets were read, printed, committed, or required. The final production build used only documented non-secret Hub endpoint URLs.

## Residual Warning

The Web production build exits 0, but Vite reports the main bundle chunk is larger than 500 kB after minification:

```text
dist/assets/index-*.js  4,119 kB+  gzip: 922 kB+
(!) Some chunks are larger than 500 kB after minification.
```

This is deploy-readiness debt, not a blocker for this audit slice.

## Next Steps

Real TokenDanceID login approval needs an approved OAuth client, disposable or test account, Hub environment, callback URL confirmation, browser evidence boundary, and no-token-disclosure logging rules.

Public Web deploy approval needs the target environment, env var ownership for `VITE_HUB_URL` and `VITE_HUB_WS_URL`, callback URL confirmation, deploy log redaction rules, artifact retention policy, and explicit approval to upload or publish the built `app/web/dist` artifact.
