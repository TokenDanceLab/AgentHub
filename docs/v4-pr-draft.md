# Draft PR: Desktop/Web v4 Shared Workbench

> 当前没有远端 PR。此草稿用于工作树收口、rebase 和验证完成后创建 draft PR。
> 暂不创建 ready PR：本地分支仍需与最新 `dev/delicious233` 对齐，并且 backend/mobile 并行改动不纳入本 UI PR。

## Title

```text
feat(ui): migrate desktop and web to v4 shared workbench
```

## Base / Head

```text
base: dev/delicious233
head: feat/desktop-web-v4-clean-rebuild
```

## Body

```markdown
## Summary

- Migrates Desktop 5173 and Web 5174 to the current shared v4 workbench baseline; `agenthub-design/desktop` remains historical visual reference only.
- Adds/extends shared workbench shell, transcript blocks, composer, inspector, floating controls, pages, design icons, demo runtime and theme sync.
- Keeps Desktop-specific capability in `app/desktop/src/platform` and Tauri host, and enforces Web 5174 as Hub-only with no Tauri/Local Edge boundary leak.
- Documents the frozen frontend state, design parity evidence, merge readiness, and the next Desktop Edge / Web Hub production integration plan.

## Validation

- [ ] `git status --short --branch`
- [ ] `git diff --check`
- [ ] `.\scripts\verify-v4-old-ui-active-paths.ps1`
- [x] `.\scripts\verify-web-hub-boundary.ps1` (15/15)
- [x] `cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\workbench\designIcons.test.tsx --reporter=dot` (2 files / 31 tests)
- [x] `cd app\desktop; corepack.cmd pnpm exec vitest run src\platform\desktopPlatform.test.ts --reporter=dot` (1 file / 1 test)
- [x] `cd app\desktop; corepack.cmd pnpm typecheck`
- [x] `cd app\web; corepack.cmd pnpm exec vitest run src\api\hubAuth.test.ts src\platform\webPlatform.test.ts --reporter=dot` (2 files / 14 tests)
- [x] `cd app\web; corepack.cmd pnpm typecheck`
- [ ] visual smoke: `v4_style_compare.mjs`, `v4_responsive_audit.mjs`, `v4_design_compare.mjs`

## Known Follow-ups

- Branch must be rebased or merged with the latest `dev/delicious233` before marking this PR ready.
- Desktop/Tauri Host API split remains open and is tracked in `docs/desktop-edge-web-integration-plan.md`.
- Desktop Local Edge runtime facade still needs production hardening; Web Hub-only boundary is now guarded, while Hub runtime facade still needs broader E2E coverage.
- Agents subpage first-card padding/background residual diff remains tracked.
- Backend/mobile changes currently present in the worktree require owner confirmation before inclusion.

## Notes

- This PR is the Desktop/Web v4 shared UI clean rebuild. It does not claim Edge backend production hardening is complete.
- Backend/security review reports are included only as planning/reference material unless explicitly confirmed by backend owners.
```

## Create Command

After rebase/merge, commit organization, validation, and push:

```powershell
gh pr create `
  --repo TokenDanceLab/AgentHub `
  --base dev/delicious233 `
  --head feat/desktop-web-v4-clean-rebuild `
  --draft `
  --title "feat(ui): migrate desktop and web to v4 shared workbench" `
  --body-file .tmp\v4-pr-body.md
```

Do not mark the PR ready before the branch is pushed with the latest frozen docs, backend/mobile ownership is resolved, and the branch is refreshed against `dev/delicious233`.
