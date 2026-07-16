# Settings / TeamRun orphan decision (#439)

最后更新：2026-07-16

## Decision

| Surface | Status | Action |
|---|---|---|
| `app/shared/.../SettingsPage.tsx` | **Product SSOT** (WorkbenchRoutes) | Keep |
| `app/desktop/src/components/SettingsPage.tsx` | Orphan / residual (type import only via menus) | Quarantine; do not feature-expand; extract `SectionId` then delete in follow-up |
| `app/web/src/components/SettingsPage.tsx` | Orphan giant | Quarantine; prefer delete after import-graph CI check |
| `app/*/views/TeamRunConsole.tsx` | No product App/workbench mount | Quarantine; productize only if TeamRun owner reopens SPEC |

## Non-goals

- No merge of dead UI into shared workbench in this slice
- No UX redesign

## Follow-ups

- Extract desktop `SectionId` type away from orphan SettingsPage
- Add import-graph guard preventing new imports of orphan paths
