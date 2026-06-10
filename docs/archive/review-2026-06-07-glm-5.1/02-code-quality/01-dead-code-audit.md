# Dead Code Audit Report

> **Date**: 2026-06-07
> **Scope**: `app/`, `edge-server/`, `hub-server/`
> **Branch**: `feat/desktop-web-v4-clean-rebuild`
> **Status**: Read-only audit, no code modifications

---

## 1. Orphan Component Files

### Desktop Orphan Components (app/desktop/src/components/)

The following components exist in `app/desktop/src/components/` but are never imported or rendered by any other file:

| Component | File | Lines |
|---|---|---|
| ContextUsage | `app/desktop/src/components/ContextUsage.tsx` | ~50 |
| MarkdownRenderer | `app/desktop/src/components/MarkdownRenderer.tsx` | ~103 |
| ApprovalCard | `app/desktop/src/components/ApprovalCard.tsx` | ~80 |
| WorkspacePicker | `app/desktop/src/components/WorkspacePicker.tsx` | ~60 |
| ModelReasoningPicker | `app/desktop/src/components/ModelReasoningPicker.tsx` | ~120 |
| ShellIconButton | `app/desktop/src/components/ShellIconButton.tsx` | ~40 |
| FileSearchDialog | `app/desktop/src/components/FileSearchDialog.tsx` | ~160 |
| DesktopHubTaskBridge | `app/desktop/src/components/DesktopHubTaskBridge.tsx` | ~30 |
| ModelDropdown | `app/desktop/src/components/ModelDropdown.tsx` | ~70 |

Also check for orphan CSS modules:
- `app/desktop/src/components/ContextUsage.module.css`
- `app/desktop/src/components/MarkdownRenderer.module.css`
- `app/desktop/src/components/ApprovalCard.module.css`
- `app/desktop/src/components/WorkspacePicker.module.css`
- `app/desktop/src/components/ModelReasoningPicker.module.css`
- `app/desktop/src/components/ShellIconButton.module.css`
- `app/desktop/src/components/FileSearchDialog.module.css`
- `app/desktop/src/components/ModelDropdown.module.css`

**Severity**: 🔴 Critical

**Impact**: ~713 lines of dead component code + associated CSS. These components consume maintenance burden, increase bundle size, and confuse new contributors.

**Recommendation**: Delete all 9 orphan components and their CSS modules. If any are planned for future use, add a `// @alpha` marker and a tracking issue number.

---

### Web Orphan Components (app/web/src/components/)

The web app now renders entirely through `AgentHubWorkbench` (from `@shared/workbench`). All traditional component files in `app/web/src/components/` are dead:

| Component | Status |
|---|---|
| ErrorBoundary | Orphan |
| MarkdownRenderer | Orphan |
| ModelDropdown | Orphan |
| ShortcutHelp | Orphan |
| StatusBar | Orphan |
| AuthPage | Orphan |
| ContextUsage | Orphan |
| AgentList | Referenced in `api/agentQueries.ts` types only |
| NotificationBell | Orphan |
| CodeBlock | Orphan |
| WelcomeScreen | Orphan |
| MentionPopover | Orphan |
| SettingsPage | Orphan |
| ApprovalCard | Orphan |
| SearchDialog | Orphan |
| DiffViewer | Orphan |

**Note**: `LoginForm` is the only component still imported (by `AuthPage`, which itself is orphan).

**Severity**: 🔴 Critical

**Impact**: Nearly the entire `app/web/src/components/` directory is dead code (~1,500+ lines). This is a direct consequence of the v4 workbench migration.

**Recommendation**: Delete all orphan web components. The web app now uses `AgentHubWorkbench` exclusively. Keep only `IM/` subfolder components (still used by `TeamRunConsole`).

---

## 2. Unused Shared UI Exports

### Commented-Out Components Still on Disk

These 12 components have their exports commented out in `app/shared/src/ui/index.ts` but their source files, tests, and stories still exist on disk:

| Component | File Size | Has Tests | Has Stories |
|---|---|---|---|
| Button | 47 lines | Yes | Yes |
| Icon | 32 lines | Yes | No |
| Card | 40 lines | Yes | Yes |
| Pill | 29 lines | Yes | Yes |
| Avatar | 29 lines | Yes | Yes |
| ProgressBar | 30 lines | Yes | Yes |
| SearchInput | 26 lines | Yes | No |
| CollapsibleBlock | 84 lines | Yes | Yes |
| Tooltip | 105 lines | Yes | No |
| SkeletonBar | 50 lines | Yes | No |
| FileChangeGroup | 98 lines | Yes | No |
| ArtifactVersionTimeline | 112 lines | Yes | No |

Total: **~682 lines** of component code + 17 associated test/story files.

**Severity**: 🟡 Warning

**Recommendation**: If these components are not planned for re-adoption in the v4 workbench, delete the files. If they are planned, uncomment their exports and add tracking issues.

---

### Active Exports Never Consumed

These 24 components are actively exported from `app/shared/src/ui/index.ts` but are never imported by any platform or by other shared code:

| Component | Exported Name |
|---|---|
| SkeletonLine / SkeletonBlock / SkeletonCircle | `Skeleton` |
| DiffReviewPanel | `DiffReviewPanel` |
| TextShimmer | `TextShimmer` |
| EmptyState | `EmptyState` |
| SelectableRow | `SelectableRow` |
| TokenDanceMark | `TokenDanceMark` |
| CodePreviewCard | `CodePreviewCard` |
| DisclosureRow | `DisclosureRow` |
| MetricGrid | `MetricGrid` |
| MessageBubble | `MessageBubble` |
| ActivityCard | `ActivityCard` |
| ContextSummary | `ContextSummary` |
| SectionHeader | `SectionHeader` |
| StatusNotice | `StatusNotice` |
| BottomSheet | `BottomSheet` |
| RecoveryPanel | `RecoveryPanel` |
| ActionList | `ActionList` |
| SegmentedControl | `SegmentedControl` |
| SurfaceHeader | `SurfaceHeader` |
| TriageCard | `TriageCard` |
| ToolTimeline | `ToolTimeline` |
| PermissionModePicker | `PermissionModePicker` |
| ArtifactCard | `ArtifactCard` |
| ArtifactPreview | `ArtifactPreview` |
| DeployCard | `DeployCard` |
| LinkCard | `LinkCard` |
| MessageSearchPanel | `MessageSearchPanel` |

**Severity**: 🔴 Critical

**Impact**: 27 exported but unused components. Each has a `.tsx`, `.module.css`, and often a `.test.tsx` and `.stories.tsx` file. Estimated **2,500+ lines** of dead code across all associated files.

**Recommendation**: These appear to be a v3-era component library that was superseded by the v4 workbench blocks system. If not planned for immediate adoption, remove from the codebase. They can be restored from git history when needed.

---

### Unused Workbench Exports

- `AgentTimeline` (block) -- exported from `app/shared/src/workbench/blocks/` but never referenced anywhere.
- `PersonPanel` (floating) -- exported from `app/shared/src/workbench/floating/` but never referenced anywhere.

**Severity**: 🟢 Info

**Recommendation**: Remove exports if unused, or wire them into the workbench UI.

---

## 3. Old UI Remnant Files

### IM Directories

- `app/desktop/src/components/IM/` -- **Still exists and ACTIVE**. Used by `TeamRunConsole.tsx`.
- `app/web/src/components/IM/` -- **Still exists and ACTIVE**. Used by `TeamRunConsole.tsx`.

**Severity**: 🟢 Info

**Note**: These are NOT remnants. The IM components are actively used by TeamRunConsole views in both desktop and web.

### Old Hooks

- `useChatMessages`, `useIMChat`, `useChatSession` -- **No traces found**. Fully cleaned up.

**Severity**: 🟢 Info

---

## 4. TODO / FIXME / HACK Scan

**Severity**: 🟢 Info

No `TODO`, `FIXME`, or `HACK` comments were found in `app/`, `edge-server/`, or `hub-server/` source code.

The only hit was a string literal in `edge-server/internal/adapters/control_protocol_test.go:416` which is test data, not a code annotation.

---

## 5. Commented-Out Code Blocks

### app/shared/src/ui/index.ts (lines 2-13)

```typescript
// export { Button } from './Button';
// export type { ButtonProps } from './Button';
// export { Icon } from './Icon';
// export { Card, CardHeader, CardContent, CardFooter } from './Card';
// export { Pill } from './Pill';
// export { Avatar } from './Avatar';
// export { ProgressBar } from './ProgressBar';
// export { SearchInput } from './SearchInput';
// export { CollapsibleBlock } from './CollapsibleBlock';
// export { Tooltip } from './Tooltip';
// export { SkeletonBar } from './SkeletonBar';
// export type { SkeletonBarProps } from './SkeletonBar';
```

### app/shared/src/ui/index.ts (lines 67-70)

```typescript
// export { default as FileChangeGroup } from './FileChangeGroup';
// export type { FileChangeGroupProps, FileChangeItem } from './FileChangeGroup';
// export { default as ArtifactVersionTimeline } from './ArtifactVersionTimeline';
// export type { ArtifactVersionTimelineProps, ArtifactVersion } from './ArtifactVersionTimeline';
```

**Severity**: 🟡 Warning

**Impact**: 16 lines of commented-out exports. The corresponding component files still exist on disk (see Section 2).

**Recommendation**: Remove commented-out exports. Delete the underlying component files if not planned for use.

---

## 6. Empty or Near-Empty Files

Files under 15 lines (excluding build output, tests, and `.d.ts`):

| File | Lines | Status |
|---|---|---|
| `app/desktop/src/hooks/useToast.ts` | 2 | 🟡 **Dead re-export wrapper** -- `useToast` never imported anywhere. `useToastStore` is used directly instead. |
| `app/web/src/hooks/useToast.ts` | 2 | 🟡 **Dead re-export wrapper** -- same as desktop. |
| `app/desktop/src/components/IM/index.ts` | 3 | 🟢 Barrel file, functional |
| `app/web/src/components/IM/index.ts` | 3 | 🟢 Barrel file, functional |
| `app/shared/src/components/index.ts` | 3 | 🟡 Empty barrel -- check if directory has any consumers |
| `app/desktop/src/api/queryClient.ts` | 4 | 🟢 Minimal but functional (queryClient config) |
| `app/web/src/api/queryClient.ts` | 4 | 🟢 Minimal but functional |
| `app/mobile/src/i18n/index.ts` | 5 | 🟢 Stub for i18n setup |
| `app/shared/src/inspector/index.ts` | 5 | 🟢 Barrel file |
| `edge-server/internal/adapters/context_budget.go` | 5 | 🟢 Stub/type file |
| `app/desktop/src/utils/threadSelection.ts` | 7 | 🟢 Small utility |
| `app/vitest.workspace.ts` | 7 | 🟢 Config file |
| `app/shared/src/ui/TokenDanceMark.tsx` | 8 | 🟡 Small but unused |
| `app/shared/src/workbench/blocks/DateDivider.module.css` | 8 | 🟢 Minimal styles |
| `app/web/src/types/permissions.ts` | 9 | 🟢 Type definitions |
| `app/desktop/src/utils/topMenuState.ts` | 10 | 🟢 Small utility |
| `app/mobile/src/native/resourceActions.ts` | 10 | 🟢 Small utility |
| `app/shared/src/__tests__/setup.ts` | 10 | 🟢 Test setup |
| `app/shared/src/workbench/blocks/DateDivider.tsx` | 10 | 🟢 Minimal component |
| `app/shared/src/workbench/inspector/index.ts` | 10 | 🟢 Barrel file |
| `app/web/src/utils/agentProfile.ts` | 10 | 🟢 Small utility |
| `app/desktop/src/utils/agentProfile.ts` | 11 | 🟢 Small utility |
| `hub-server/internal/model/message_attachment.go` | 10 | 🟢 Model struct |
| `hub-server/internal/model/message_pin.go` | 10 | 🟢 Model struct |
| `app/desktop/e2e/test-utils.ts` | 12 | 🟢 E2E helpers |
| `hub-server/pkg/uuidv7/uuidv7.go` | 12 | 🟢 Utility package |

**Severity**: 🟡 Warning (for the dead `useToast.ts` wrappers)

**Recommendation**: Delete `app/desktop/src/hooks/useToast.ts` and `app/web/src/hooks/useToast.ts` -- the `useToast` re-export is never consumed. All other small files are functional and appropriately sized for their purpose.

---

## Summary

| Category | Severity | Items | Est. Dead Lines |
|---|---|---|---|
| Desktop orphan components | 🔴 Critical | 9 components | ~713 |
| Web orphan components | 🔴 Critical | 15 components | ~1,500+ |
| Shared UI: commented-out on disk | 🟡 Warning | 12 components | ~682 |
| Shared UI: exported but unused | 🔴 Critical | 27 components | ~2,500+ |
| Unused workbench exports | 🟢 Info | 2 exports | ~100 |
| Commented-out code blocks | 🟡 Warning | 2 blocks | 16 |
| Dead useToast wrappers | 🟡 Warning | 2 files | 4 |
| Old UI remnants | 🟢 Info | None found | 0 |
| TODO/FIXME/HACK | 🟢 Info | None found | 0 |

**Total estimated dead code: ~5,500+ lines**

### Priority Actions

1. **[P0] Delete 15 orphan web components** -- The entire `app/web/src/components/` directory (minus `IM/` subfolder) is dead after the v4 migration.
2. **[P0] Evaluate 27 unused shared UI exports** -- These represent the bulk of dead code. Decide: adopt in v4 or delete.
3. **[P1] Delete 9 orphan desktop components** -- ContextUsage, MarkdownRenderer, ApprovalCard, WorkspacePicker, ModelReasoningPicker, ShellIconButton, FileSearchDialog, DesktopHubTaskBridge, ModelDropdown.
4. **[P1] Remove 12 commented-out shared UI component files** -- Button, Icon, Card, Pill, Avatar, ProgressBar, SearchInput, CollapsibleBlock, Tooltip, SkeletonBar, FileChangeGroup, ArtifactVersionTimeline and their tests/stories.
5. **[P2] Clean up dead useToast wrappers** and remove unused workbench exports (AgentTimeline, PersonPanel).
