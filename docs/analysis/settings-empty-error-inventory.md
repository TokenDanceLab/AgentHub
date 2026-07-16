# Settings Empty / Error / Loading Inventory

> last-updated: 2026-07-17
> issue: #470
> status: inventory + trivial consistency fixes landed
> scope: shared workbench Settings SSOT + residual desktop/web shell

## 0. Summary

Product Settings SSOT is already the shared workbench page. Desktop orphan
`SettingsPage` is gone; residual shell files are mostly dead typing, dead menu
hooks, leftover i18n, and surface metadata still describing ~20 old sections.

Settings form UI has design-system **empty/invalid/missing previews**, but **no
real loading/error UX** for settings persistence. Failures stay in
`console.error` with silent defaults/rollback.

## 1. SSOT product surface

| Path | Role |
|---|---|
| `app/shared/src/workbench/pages/SettingsPage.tsx` | Product Settings UI SSOT (panes: `appearance \| notify \| agent \| local \| states`) |
| `app/shared/src/workbench/pages/SettingsPage.module.css` | Settings layout + local `StatePanel` styles |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | Mounts SettingsPage; hardcodes `spaceTitle="AgentHub Desktop"`, `spaceMeta="桌面设计 demo"` |
| `app/shared/src/workbench/AgentHubWorkbench.tsx` | Creates `settingsService`; rail nav to `settings` |
| `app/shared/src/workbench/settingsService.ts` | External store; init/write fail → defaults + `console.error` only |
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
| `app/shared/src/ui/StatusNotice.tsx` | Inline status; **not** wired to settings load/write |
| `app/shared/src/ui/RecoveryPanel.tsx` | Error recovery; **not** used by Settings |
| `app/shared/src/ui/Skeleton.tsx` / `SkeletonBar.tsx` | Loading; **not** used by Settings |

## 5. Empty / error / loading inventory (Settings-related)

### SettingsPage itself

| State | Present? | Notes |
|---|---|---|
| Loading | **No** | `settingsService.initialized` never rendered; page always paints defaults |
| Error | **No** | init/write failures logged only; silent rollback/defaults |
| Empty | **N/A as page** | Settings is form UI, not a list |
| Empty/invalid/missing **preview** | Yes | `StatesPane` + local `StatePanel` (design-system preview only) |
| Search empty | Non-functional | Search input has no state/filter |

### Settings service / adapters

| Path | Loading | Error | Empty |
|---|---|---|---|
| `settingsService.ts` | `initialized` flag only | `console.error`; keep defaults / roll back write | N/A |
| `desktopSettingsAdapter.ts` | none | silent tier fallback | empty `{}` from LS |
| `webSettingsAdapter.ts` | none | silent tier fallback | empty `{}` from LS |

### Neighbor workbench pages (state-system divergence)

| Path | Pattern |
|---|---|
| `pages/AgentsPage.tsx` | ad-hoc `agent-empty-state` / `role="alert"` (not `EmptyState`) |
| `pages/TasksPage.tsx` | ad-hoc `emptyState` + optional `emptyStateLabel` |
| `pages/ContactsPage.tsx` | ad-hoc `emptyState` + search loading text |
| `pages/ProjectsPage.tsx` | loading caption / error alert / editor error |
| Shell lists (desktop/web AgentList, NotificationBell, WelcomeScreen, DiffViewer, IMContactList) | shared `@shared/ui/EmptyState` |

## 6. Copy / structure divergences after orphan deletion

1. **Pane model mismatch**: SSOT panes = 5 (`appearance/notify/agent/local/states`); residual `SectionId` / `surfaceMetadata` still describe ~20 orphan sections.
2. **Dead menu wiring**: `useTopMenuConfig` / `useShellShortcuts` target `general` / `tasks` / `agentScheduling` — none map to `SettingsPaneId`; hooks currently unmounted.
3. **Hardcoded scope**: `WorkbenchRoutes` always passes Desktop demo scope even for Web.
4. **EN/CN mix in Settings UI**: section counters previously rendered `{count} items` while surrounding copy is Chinese (same on Projects detail settings panel).
5. **State system dual track**: Settings previews custom `StatePanel`; product lists use `EmptyState`; other workbench pages still use ad-hoc divs.
6. **Locale drift**: large desktop/web `settings.*` residual strings no longer backed by a Settings UI.

## 7. Landed consistency fixes (#470)

1. **Section counter language** — Chinese chrome alignment:
   - `app/shared/src/workbench/pages/SettingsPage.tsx`: `{count} items` → `{count} 项`
   - `app/shared/src/workbench/pages/ProjectsPage.tsx`: `{settings.length} items` → `{settings.length} 项`
2. **Residual menu section mapping note** —
   - `app/desktop/src/components/settings/sectionIds.ts`: document that only `SettingsPaneId` is navigable; map dead `openSettings('general')` intent → `'appearance'` when rewired later.

## 8. Larger follow-ups (do not land as “trivial”)

- Surface `settingsService` loading/error via `StatusNotice` / `RecoveryPanel` on SettingsPage (needs service error state + WorkbenchRoutes prop; avoid #467 ownership collision on god workbench file).
- Rebind or delete dead `useTopMenuConfig` / `useShellShortcuts` / TopMenuBar `openSettings`.
- Collapse `surfaceMetadata` `desktopSectionId`s + web residual section i18n to current 5-pane SSOT (or mark `interfaceGap`).
- Migrate `StatesPane` previews onto shared `EmptyState` + variants.
- Stop hardcoding Desktop demo `spaceTitle` / `spaceMeta` for Web mounts.

## 9. Evidence

- Real entry path: GlobalRail → workbench `settings` page.
- Residual desktop/web settings affordances are mostly **dead code + leftover i18n/surface metadata**, not alternate Settings UIs.
- Settings page has design-system empty/invalid/missing **previews**, but **no real loading/error UX** for settings persistence.
