# Settings Empty / Error / Loading Inventory

> pending external archive — see docs/history.md
> last-updated: 2026-07-17
> issue: #470 / residual #479 / #492-#504 / #516 / #517 / #529
> scope: shared workbench Settings SSOT + residual desktop/web shell

## 0. Summary

Product Settings SSOT is already the shared workbench page. Desktop orphan
`SettingsPage` is gone; residual shell files are mostly dead typing, dead menu
hooks, leftover i18n, and surface metadata still describing ~20 old sections.

Settings form UI now surfaces real **loading / init error / write error** UX via
shared `StatusNotice` + `RecoveryPanel`. Failures still log to `console.error`,
but no longer remain silent in the Settings product surface.

## 1. SSOT product surface

| Path | Role |
|---|---|
| `app/shared/src/workbench/pages/SettingsPage.tsx` | Product Settings UI SSOT (panes: `appearance \| notify \| agent \| local \| states`) + load/error chrome |
| `app/shared/src/workbench/pages/SettingsPage.module.css` | Settings layout + local `StatePanel` styles + status stack |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | Mounts SettingsPage; hardcodes `spaceTitle="AgentHub Desktop"`, `spaceMeta="桌面设计 demo"`; plumbs settings service loading/error |
| `app/shared/src/workbench/AgentHubWorkbench.tsx` | Creates `settingsService`; rail nav to `settings` |
| `app/shared/src/workbench/settingsService.ts` | External store; init/write fail → defaults/rollback + `error` / `errorKind` / `loading` |
| `app/shared/src/workbench/settingsTypes.ts` | Persist keys (incl. `stateStrategies`) |
| `app/shared/src/workbench/GlobalRail.tsx` | Real settings entry (rail gear → `handleNavigate('settings')`) |
| `app/shared/src/workbench/mockData.ts` | Default settings incl. `stateStrategies` |

## 2. Persistence adapters (shell → SSOT)

| Path | Role |
|---|---|
| `app/desktop/src/platform/desktopSettingsAdapter.ts` | Edge → Hub → localStorage; silent catch |
| `app/web/src/platform/webSettingsAdapter.ts` | Hub → localStorage; silent catch |
| `app/desktop/src/platform/desktopPlatform.ts` | Wires `settings: createDesktopSettingsAdapter()` |
| `app/web/src/platform/webPlatform.ts` | Wires `settings: createWebSettingsAdapter()` |

## 3. Residual desktop/web entry points after orphan deletion

| Path | Residual status |
|---|---|
| `app/desktop/src/components/settings/sectionIds.ts` | Only residual under `components/settings/`; orphan `SectionId` typing for menu (#443). Documented as non-navigable vs `SettingsPaneId`. |
| `app/desktop/src/hooks/useTopMenuConfig.ts` | `openSettings('general'\|'tasks'\|'agentScheduling')` — **no callers** in tree |
| `app/desktop/src/hooks/useShellShortcuts.ts` | Ctrl+, → `openSettings('general')` — **no callers** |
| `app/desktop/src/components/TopMenuBar.tsx` | Menu chrome only; not wired to workbench settings |
| `app/shared/src/surfaceMetadata.ts` | Still maps `desktopSectionId` to deleted orphan sections |
| `app/web/src/i18n/locales/{en,zh}/common.json` | Orphan section baseline copy for surface metadata |
| `app/desktop/src/i18n/locales/{en,zh}.json` | Large leftover `settings.*` tree from deleted orphan page |
| `app/desktop/src/i18n/locales.test.ts` | Documents SSOT = shared SettingsPage; scans residual `components/settings` |

## 4. Shared empty/error/loading primitives

| Path | Role vs Settings |
|---|---|
| `app/shared/src/ui/EmptyState.tsx` | Shared empty SSOT (shell lists); **not** used by SettingsPage |
| `app/shared/src/ui/StatusNotice.tsx` | Inline status; **wired** for settings loading + write failure |
| `app/shared/src/ui/RecoveryPanel.tsx` | Error recovery; **wired** for settings init failure |
| `app/shared/src/ui/Skeleton.tsx` / `SkeletonBar.tsx` | Loading; **not** used by Settings |

## 5. Empty / error / loading inventory (Settings-related)

### SettingsPage itself

| State | Present? | Notes |
|---|---|---|
| Loading | **Yes** | `settingsLoading` → shared `StatusNotice` (“正在加载设置…”) |
| Error | **Yes** | init → `RecoveryPanel` + retry/dismiss; write → `StatusNotice` + dismiss |
| Empty | **N/A as page** | Settings is form UI, not a list |
| Empty/invalid/missing **preview** | Yes | `StatesPane` + local `StatePanel` (design-system preview only) |
| Search empty | Non-functional | Search input has no state/filter |

### Settings service / adapters

| Path | Loading | Error | Empty |
|---|---|---|---|
| `settingsService.ts` | `loading` + `initialized` | `error` / `errorKind` (`init`\|`write`); keep defaults / roll back write | N/A |
| `desktopSettingsAdapter.ts` | none | silent tier fallback | empty `{}` from LS |
| `webSettingsAdapter.ts` | none | silent tier fallback | empty `{}` from LS |

### Neighbor workbench pages (state-system divergence)

| Path | Pattern |
|---|---|
| `pages/AgentsPage.tsx` | installed + skill/MCP market empties use shared `EmptyState` (#492); load/action errors use `StatusNotice` / `RecoveryPanel` (#529) |
| `pages/TasksPage.tsx` | primary empty uses shared `EmptyState` (#503); public `emptyStateLabel` maps to description |
| `pages/ContactsPage.tsx` | primary empty uses shared `EmptyState` (#504); residual search loading text |
| `pages/ProjectsPage.tsx` | empty uses shared `EmptyState`; loading/error use `StatusNotice` (#516) |
| `pages/DocsPage.tsx` | empty uses shared `EmptyState` (#517); residual loading/error TBD |
| Shell lists (desktop/web AgentList, NotificationBell, WelcomeScreen, DiffViewer, IMContactList) | shared `@shared/ui/EmptyState` |

## 6. Copy / structure divergences after orphan deletion

1. **Pane model mismatch**: SSOT panes = 5 (`appearance/notify/agent/local/states`); residual `SectionId` / `surfaceMetadata` still describe ~20 orphan sections.
2. **Dead menu wiring**: `useTopMenuConfig` / `useShellShortcuts` target `general` / `tasks` / `agentScheduling` — none map to `SettingsPaneId`; hooks currently unmounted.
3. **Hardcoded scope**: `WorkbenchRoutes` always passes Desktop demo scope even for Web.
4. **EN/CN mix in Settings UI**: recovery eyebrow still English (`Settings recovery`) while surrounding chrome is Chinese; product copy can be unified later.
5. **State system dual track**: Settings previews custom `StatePanel`; product lists use `EmptyState`; other workbench pages still use ad-hoc divs.
6. **Locale drift**: large desktop/web `settings.*` residual strings no longer backed by a Settings UI.

## 7. Landed consistency fixes (#470)

1. **Section counter language** — Chinese chrome alignment:
   - `app/shared/src/workbench/pages/SettingsPage.tsx`: `{count} items` → `{count} 项`
   - `app/shared/src/workbench/pages/ProjectsPage.tsx`: `{settings.length} items` → `{settings.length} 项`
2. **Residual menu section mapping note** —
   - `app/desktop/src/components/settings/sectionIds.ts`: document that only `SettingsPaneId` is navigable; map dead `openSettings('general')` intent → `'appearance'` when rewired later.

## 8. Landed load/error UX (#479)

1. **`settingsService` state surface**
   - `loading`, `error`, `errorKind`, `clearError()`
   - init failure keeps defaults and marks initialized so UI can recover
   - write failure rolls back snapshot and keeps a dismissible write error
2. **`WorkbenchRoutes` plumbing**
   - subscribes to service state and passes `settingsLoading` / `settingsError` / `settingsErrorKind`
   - retry = re-run `settingsService.init()`; dismiss = `clearError()`
3. **`SettingsPage` shared primitives**
   - loading → `StatusNotice`
   - init error → `RecoveryPanel` (retry + continue with defaults)
   - write error → `StatusNotice` (dismiss)
4. **Tests**
   - `settingsService.test.ts`
   - `pages/SettingsPage.test.tsx`

## 9. Residual follow-ups (do not land as “trivial”)

- Rebind or delete dead `useTopMenuConfig` / `useShellShortcuts` / TopMenuBar `openSettings`.
- Collapse `surfaceMetadata` `desktopSectionId`s + web residual section i18n to current 5-pane SSOT (or mark `interfaceGap`).
  - Full residual inventory + collapse plan: [`settings-sectionid-residual-inventory.md`](./settings-sectionid-residual-inventory.md) (#530).
- Migrate `StatesPane` previews onto shared `EmptyState` + variants.
- Stop hardcoding Desktop demo `spaceTitle` / `spaceMeta` for Web mounts.
- Optionally surface adapter-tier fallback detail (Edge/Hub/localStorage) in recovery meta.
- Optionally replace loading StatusNotice with Skeleton rows for denser form chrome.

## 9.1 Residual after Agents/Tasks/Contacts/Projects/Docs EmptyState + Agents load/action (#492 / #503 / #504 / #516 / #517 / #529)

| Surface | After | Next |
|---|---|---|
| Agents installed/market empty | shared `EmptyState` (#492) | market loading captions residual |
| Agents load/action errors | hard empty+error → `RecoveryPanel`; soft list+error / mutation → `StatusNotice` (#529) | desktop `error`/`actionError` conflation + `onAgentsRetry` no-op refetch residual; no action-error dismiss callback |
| TasksPage primary empty | shared `EmptyState` (#503) | — |
| ContactsPage primary empty | shared `EmptyState` (#504) | residual search loading text |
| ProjectsPage primary empty | shared `EmptyState` + loading/error `StatusNotice` (#516) | form-inline editor error residual; no `RecoveryPanel` retry plumbing yet; nested runs/artifacts/feed empty optional |
| DocsPage primary empty | shared `EmptyState` (#517) | loading/error status not plumbed; mock fallback can mask real empty/error; tab/search filter empty residual |

## 9.2 ProjectsPage inventory + fix (#516)
| Path | Before | After (#516) |
|---|---|---|
| Loading caption | ad-hoc `navCaption` repeating `t('nav.projects')` | shared `StatusNotice role="status"` + `projects.loading` |
| Nav load error | ad-hoc `navCaption role="alert"` | shared `StatusNotice role="alert"` + error text |
| Primary empty | custom `detailHead` h1 + optional create CTA; empty description conflated with load error | shared `EmptyState` (`titleLevel={1}`) + pure empty copy; load error shown via nav `StatusNotice` |
| Editor mutation error | local `editorError` box | residual form-inline (acceptable; lower priority) |
| Nested empties (runs/artifacts/feed) | section headers only | residual / out of scope |
Blocked without product plumbing: full `RecoveryPanel` for projects load needs `onProjectsRetry` through WorkbenchRoutes/hub load.

## 9.3 AgentsPage load/action inventory + fix (#529)
| Path | Before | After (#529) |
|---|---|---|
| Installed empty | shared `EmptyState` (#492) | unchanged; suppressed while `agentsError` is active |
| Hard load error (`agentsError` + empty list) | ad-hoc `agent-inline-state` + raw retry | shared `RecoveryPanel` (`error404` / `refresh`, busy on `agentsLoading`) |
| Soft load error (`agentsError` + partial list) | same ad-hoc banner | compact `StatusNotice role="alert"` + optional retry action |
| Mutation/action error (`agentActionError`) | ad-hoc danger `agent-inline-state` | `StatusNotice role="alert"` danger styling; display-only |
| Loading residual | section caption `"同步中"` | kept; market loading captions residual |
| CSS residual | `.agent-inline-state*` | removed; replaced by `.statusStack` / `.statusNotice*` / `.statusAction` / `.recoveryPanel` |
Known residual: Desktop host still conflates `error`/`actionError` and `onAgentsRetry` may only clear local state without refetch.
