# Settings / TeamRun orphan decision (#439)

最后更新：2026-07-16

## Decision

| Surface | Status | Action |
|---|---|---|
| `app/shared/.../SettingsPage.tsx` | **Product SSOT** (WorkbenchRoutes) | Keep |
| `app/desktop/src/components/SettingsPage.tsx` | **Deleted** | Physically removed with orphan settings tree (kept only `sectionIds.ts` for menu typing) |
| `app/web/src/components/SettingsPage.tsx` | **Deleted** | Physically removed |
| `app/*/views/TeamRunConsole.tsx` | **Deleted** | Physically removed (+ web tests/css; desktop TeamRunDock removed as unused mount) |

## Non-goals

- No merge of dead UI into shared workbench in this slice
- No UX redesign

## Landed follow-ups

- Extract desktop `SectionId` type away from orphan SettingsPage (`sectionIds.ts`)
- Physical delete of orphan Settings/TeamRun UI surfaces
- Product Settings continues via shared workbench `pages/SettingsPage.tsx`
