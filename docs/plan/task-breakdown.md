# AgentHub UI Polish — Task Breakdown

## Phase 1: focus-visible 补全 (10 个组件)

| Task | Component | File | What to add |
|------|-----------|------|-------------|
| T1 | Button | Button.module.css | `:focus-visible` ring for all 5 variants |
| T2 | SegmentedControl | SegmentedControl.module.css | `:hover` + `:focus-visible` on options |
| T3 | CollapsibleBlock | CollapsibleBlock.module.css | `:focus-visible` on header |
| T4 | DisclosureRow | DisclosureRow.module.css | `:hover` + `:focus-visible` on button |
| T5 | ActionList | ActionList.module.css | `:hover` + `:focus-visible` on items |
| T6 | Modal | Modal.module.css | `:focus-visible` on close/fullscreen btns |
| T7 | ArtifactCard | ArtifactCard.module.css | `:focus-visible` on actionBtn/applyBtn |
| T8 | ArtifactVersionTimeline | ArtifactVersionTimeline.module.css | `:focus-visible` on versionHeader/actionBtn |
| T9 | DeployCard | DeployCard.module.css | `:focus-visible` on previewBtn/openBtn |
| T10 | EmptyState | EmptyState.module.css | `:focus-visible` on action/suggestionChip |

## Phase 2: hardcoded hex 修复

| Task | File | Fix |
|------|------|-----|
| T11 | ArtifactPreview.module.css | `#ef4444` → remove fallback or use correct token |
| T12 | DocxPreview.module.css | Same |
| T13 | FileChangeGroup.module.css | Same |
| T14 | SlideshowPreview.module.css | `#1a1a2e` → `var(--text-1)`, `#999` → `var(--text-3)` |
| T15 | TablePreview.module.css | `#ef4444` → remove fallback |
| T16 | DiffReviewPanel.module.css | `#e0e0e0` → `var(--text-3)` |
| T17 | Markdown.module.css | hardcoded dark bg → theme-aware |
| T18 | ActionList.tsx | `#dc2626` → `var(--danger)` |
| T19 | Button.module.css | `#fff` fallback → remove |

## Phase 3: Stylelint 执行

| Task | What |
|------|------|
| T20 | Run `pnpm lint:css` and fix all violations |
