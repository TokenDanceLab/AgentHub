# v4 合并与 PR 准备记录

> 日期：2026-06-07
> 分支：`feat/desktop-web-v4-clean-rebuild`
> 目标主线：`dev/delicious233`
> 状态：前端 UI 冻结后进入合并准备；当前仍有未提交变更，暂不应直接合并。

## 当前分支事实

| 项 | 当前值 |
|---|---|
| 本地分支 | `feat/desktop-web-v4-clean-rebuild` |
| 远端分支 | `origin/feat/desktop-web-v4-clean-rebuild` |
| 主线分支 | `origin/dev/delicious233` |
| 本地 HEAD | `9e72640b test(ui): guard workbench icons and demo data` |
| 本地相对远端 feature | ahead 3 |
| 本地相对 `dev/delicious233` | 31 ahead / 11 behind |
| 工作树 | index 已清空；仍有大量 tracked 和 untracked 工作区变更，必须按 owner 分组 stage |
| 当前 GitHub PR | Draft PR [#291](https://github.com/TokenDanceLab/AgentHub/pull/291) |

本地 ahead 3 个提交：

```text
9e72640b test(ui): guard workbench icons and demo data
7505815f fix(ui): polish workbench demo routing
c1f79944 feat(ui): align desktop and web v4 workbench
```

## 未提交变更分类

### v4 前端冻结成果候选

这些路径与当前 UI 冻结目标直接相关，合并前应作为同一 PR 的主体审查：

- `app/shared/src/workbench/**`
- `app/shared/src/demo/**`
- `app/shared/src/theme.ts`
- `app/shared/src/i18n/**`
- `app/shared/src/ui/Select.*`
- `app/shared/src/ui/ContextSummary.module.css`
- `app/shared/src/ui/DiffReviewPanel.module.css`
- `app/shared/src/ui/syntaxHighlight.ts`
- `app/shared/package.json`
- `app/pnpm-lock.yaml`
- `app/desktop/src/App.tsx`
- `app/desktop/src/components/DesktopChrome.*`
- `app/desktop/src/platform/**`
- `app/desktop/src/styles/{tokens.css,themes.css}`
- `app/web/src/platform/**`
- `app/web/src/styles/{tokens.css,themes.css}`
- `app/web/src/contexts/ThemeContext.tsx`
- `app/desktop/src/contexts/ThemeContext.tsx`

### 文档与治理候选

这些路径用于解释冻结状态、设计对齐和下一阶段计划，应随 PR 一起提交，但需要确认没有重复叙述：

- `README.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/roadmap.md`
- `docs/architecture.md`
- `docs/desktop-web-v4-clean-rebuild-plan.md`
- `docs/v4-frontend-progress-2026-06-07.md`
- `docs/v4-design-parity-audit-2026-06-07.md`
- `docs/v4-shared-i18n-design.md`
- `docs/desktop-edge-web-integration-plan.md`
- `docs/v4-merge-pr-readiness-2026-06-07.md`
- `docs/v4-pr-draft.md`
- `docs/governance/**`
- `docs/review-2026-06-07-glm-5.1/**`

### 需要单独确认的并行/非前端路径

这些路径不应被默认算作 v4 UI 冻结成果。合并前必须由对应 owner 确认是本 PR 必需，或者拆出后续 PR：

- `edge-server/internal/api/handlers.go`
- `edge-server/internal/api/handlers_test.go`
- `edge-server/internal/store/file_store.go`
- `edge-server/internal/store/store.go`
- `BACKEND-MERGE-PLAN.md`
- `app/mobile/README.md`
- `app/mobile/scripts/visual-qa.mjs`
- `app/mobile/vite.config.ts`

## PR 前置条件

1. 等并行归档/整理 Agent 停止改同一批文档后，重新跑 `git status --short --branch`。
2. 对未提交变更做一次 owner 分类：
   - v4 UI / docs：纳入本 PR。
   - backend / mobile：确认是否拆出或由对应 owner 一并纳入。
   - generated `.tmp` / 截图 / build 输出：不得提交，除非已有明确文档路径和用途。
3. 处理相对 `dev/delicious233` 落后 11 个提交的问题，rebase 或 merge 后重新验证。
4. 推送本地 ahead 3 和最终整理提交到 `origin/feat/desktop-web-v4-clean-rebuild`。
5. 基于 `dev/delicious233` 创建 draft PR；验证和非前端路径归属确认后再标记 ready。PR 草稿见 [v4-pr-draft.md](v4-pr-draft.md)。

## 最小合并前验证

```powershell
git status --short --branch
git diff --check
.\scripts\verify-v4-old-ui-active-paths.ps1
.\scripts\verify-web-hub-boundary.ps1
cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\workbench\designIcons.test.tsx --reporter=dot
cd app\desktop; corepack.cmd pnpm typecheck
cd app\web; corepack.cmd pnpm typecheck
```

最新 Web boundary 复验：`verify-web-hub-boundary.ps1` 已扩展到 JSON 和 Tauri/Desktop runtime 引用扫描，当前 15/15 passed；`app/web` focused tests `hubAuth.test.ts + webPlatform.test.ts` 2 文件 / 14 测试通过；Web typecheck 通过。

若保留 Edge Server thread pins / store 改动，追加：

```powershell
cd edge-server; go test ./internal/api ./internal/store -count=1
```

视觉冻结回归建议在最终 PR ready 前跑：

```powershell
cd app\desktop; corepack.cmd pnpm exec node .\.tmp\v4_style_compare.mjs
cd app\desktop; corepack.cmd pnpm exec node .\.tmp\v4_responsive_audit.mjs
cd app\desktop; corepack.cmd pnpm exec node .\.tmp\v4_design_compare.mjs
cd app\desktop; corepack.cmd pnpm exec node .\.tmp\v4_subpage_compare.mjs
```

`v4_subpage_compare.mjs` 当前允许记录残余 diff，但 PR 描述必须写明：最新已知 Agents `已安装 Agent/市场` 首卡仍有 padding/background 细节需继续对齐。

## PR 描述骨架

```markdown
## Summary
- Replace Desktop/Web active UI with the current shared v4 workbench; `agenthub-design` desktop shell is historical visual reference only.
- Add shared transcript/composer/inspector/pages/floating controls and design icon registry.
- Keep Desktop-specific capability in platform adapter/Tauri, and Web-specific capability in Hub adapter.
- Document v4 freeze state, design parity evidence, and next Desktop Edge / Web Hub integration plan.

## Validation
- [ ] git diff --check
- [ ] verify-v4-old-ui-active-paths.ps1
- [ ] verify-web-hub-boundary.ps1
- [ ] shared focused tests
- [ ] Desktop typecheck
- [ ] Web typecheck
- [ ] visual compare smoke

## Known Follow-ups
- Branch is not merge-ready until rebased/merged with `dev/delicious233` and revalidated.
- Desktop/Tauri Host API split remains open.
- Desktop Local Edge runtime facade and Web Hub runtime facade need production hardening.
- Agents subpage first-card padding/background residual diff remains tracked.
- Backend/mobile changes in the worktree require owner confirmation before merging.
```

## 合并策略

- 已创建 draft PR [#291](https://github.com/TokenDanceLab/AgentHub/pull/291)，标题：`feat(ui): migrate desktop and web to v4 shared workbench`。
- PR base：`dev/delicious233`。
- PR head：`feat/desktop-web-v4-clean-rebuild`。
- 等验证和非前端路径归属确认后再标记 ready。
- 不建议在当前脏工作树直接 squash merge；先把提交整理成 2-4 个主题提交：
  1. `feat(ui): align desktop and web v4 shared workbench`
  2. `feat(platform): wire desktop and web v4 adapters`
  3. `docs(v4): freeze frontend progress and merge readiness`
  4. 如确需包含后端：`fix(edge): ...`，否则拆 PR。
