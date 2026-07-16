# Settings SectionId / surfaceMetadata Residual Inventory

> last-updated: 2026-07-17  
> issue: #530 (Phase 14 residual of #470 / #443)  
> scope: residual section model vs 5-pane Settings SSOT — inventory + collapse plan only  
> non-goals: UX redesign, MASTER edits, product Settings UI changes

## 0. Summary

Product Settings navigation SSOT is already the shared workbench 5-pane model:

| SSOT | Values |
|---|---|
| Type | `SettingsPaneId` in `app/shared/src/workbench/pages/SettingsPage.tsx` |
| Panes | `appearance` \| `notify` \| `agent` \| `local` \| `states` |
| Mount | `WorkbenchRoutes` state `settingsPane` / `setSettingsPane` |
| Entry | `GlobalRail` gear → `handleNavigate('settings')` (default pane `appearance`) |

Residual layers still describe the **deleted orphan multi-section Settings shell** (~20–32 ids):

1. Desktop `SectionId` type (32 members) — menu typing only  
2. Unmounted menu/shortcut hooks that call `openSettings('general'|'tasks'|'agentScheduling')`  
3. Shared `surfaceMetadata` `desktopSectionId` map (20 members) + tests  
4. Web/desktop leftover `settings.*` i18n for old sections / orphan form copy  

This issue documents the residual graph and a collapse plan. No product UX redesign in this PR.

## 1. SSOT vs residual models

### 1.1 Navigable product panes (`SettingsPaneId`)

| Pane | Product role (current UI) |
|---|---|
| `appearance` | Theme / density / animation / run-block presentation |
| `notify` | Run / approval / project / docs notification policy |
| `agent` | Default model / tools / approval / run-record defaults |
| `local` | Local Vite / workspace / logs / design-demo switches |
| `states` | Empty/invalid/404/error preview chrome |

Source: `app/shared/src/workbench/pages/SettingsPage.tsx` (`NAV_ITEMS`, `PANE_META`, `PANE_RENDERERS`).

### 1.2 Residual `SectionId` (desktop typing only)

Path: `app/desktop/src/components/settings/sectionIds.ts`

32 members (orphan shell IA):

```text
general | appearance | configuration | personalization | permissions |
agentProfiles | executionTargets | tasks | onlineIm | groupChat |
agentScheduling | agentMarket | keyboard | mcp | skills | hooks |
models | modelMapping | ccSwitch | connections | remoteControl |
git | environment | worktree | browser | computerUse | platforms |
account | securityAudit | archived | data | about
```

Comments already state: **not navigable**; full collapse was noted as follow-up (#470 residual / this #530).

### 1.3 Residual `surfaceMetadata` desktop settings surfaces

Path: `app/shared/src/surfaceMetadata.ts`

| Count | Kind |
|---:|---|
| 20 | `desktop.settings.*` rows with `desktopSectionId` |
| 1 | `desktop.commandCenter` (no section id) |
| 4 | `mobile.*` (no section id) |

`desktopSectionId` values (20):

```text
general | appearance | permissions | agentProfiles | executionTargets |
tasks | onlineIm | groupChat | agentScheduling | agentMarket |
mcp | skills | models | modelMapping | ccSwitch | connections |
remoteControl | platforms | account | securityAudit
```

Helpers still exported from `@agenthub/shared`:

- `getSurfaceByDesktopSectionId`
- `getSurfaceMetadata` / `SURFACE_METADATA` / `surfaceMetadataById`
- `getSurfacesByCategory` / `getSurfacesByPlatform`

**Runtime consumers outside definition + unit test + re-export: none** (scan of `app/{desktop,shared,web}/src` `*.{ts,tsx}`).

## 2. Residual call graph (evidence)

Scan root: `app/desktop/src`, `app/shared/src`, `app/web/src` (excluding `node_modules` / build).

| Symbol | Hits | Notes |
|---|---:|---|
| `SettingsPaneId` | live | SettingsPage + WorkbenchRoutes + package exports |
| `SectionId` | 2 | `sectionIds.ts` definition; `useTopMenuConfig.ts` type import |
| `useTopMenuConfig` | 2 | self + comment in `sectionIds.ts` — **no mount caller** |
| `useShellShortcuts` | 2 | self + comment in `sectionIds.ts` — **no mount caller** |
| `TopMenuBar` | chrome only | imported by `useTopMenuConfig` only; not mounted by workbench |
| `getSurfaceByDesktopSectionId` | 3 | `surfaceMetadata.ts`, test, `shared/index.ts` re-export |
| `SURFACE_METADATA` / `getSurfaceMetadata` | 3 | same (definition / test / export) |
| `openSettings('…')` literals | 3 ids | `general`, `tasks`, `agentScheduling` only |

Dead open-settings intents (unmounted):

| Caller | Intent | Residual SectionId |
|---|---|---|
| `useTopMenuConfig` File/Help | settings / about / desktop-settings | `general` |
| `useTopMenuConfig` View | tasks | `tasks` |
| `useTopMenuConfig` View | team runs | `agentScheduling` |
| `useShellShortcuts` Ctrl+, | open settings | `general` |

Product path that **is** live: rail → `settings` route → default `SettingsPaneId = 'appearance'`.

## 3. SectionId / surface → SettingsPaneId collapse map

Nearest-product mapping only (not 1:1 feature parity). Use when rewiring menus/shortcuts or collapsing metadata.

| Residual `SectionId` / `desktopSectionId` | In surfaceMetadata? | Dead `openSettings`? | Collapse target | Notes |
|---|---|---|---|---|
| `general` | yes | yes | `appearance` | Default settings entry |
| `appearance` | yes | no | `appearance` | Name overlap with SSOT |
| `personalization` | no | no | `appearance` | Orphan IA only |
| `about` | no | no | `appearance` | Or open external about; menu currently reuses settings |
| `onlineIm` | yes | no | `notify` | Nearest product pane |
| `groupChat` | yes | no | `notify` | Nearest product pane |
| `configuration` | no | no | `agent` | Orphan IA only |
| `permissions` | yes | no | `agent` | Tools/approval defaults live under agent pane |
| `agentProfiles` | yes | no | `agent` | |
| `executionTargets` | yes | no | `agent` | |
| `tasks` | yes | yes | `agent` | Not TasksPage; old settings section |
| `agentScheduling` | yes | yes | `agent` | |
| `agentMarket` | yes | no | `agent` | Product Agents market is separate page |
| `mcp` | yes | no | `agent` | |
| `skills` | yes | no | `agent` | |
| `hooks` | no | no | `agent` | Orphan IA only |
| `models` | yes | no | `agent` | |
| `modelMapping` | yes | no | `agent` | |
| `ccSwitch` | yes | no | `agent` | |
| `keyboard` | no | no | `local` | Orphan IA only |
| `connections` | yes | no | `local` | |
| `remoteControl` | yes | no | `local` | |
| `git` | no | no | `local` | Orphan IA only |
| `environment` | no | no | `local` | |
| `worktree` | no | no | `local` | |
| `browser` | no | no | `local` | |
| `computerUse` | no | no | `local` | |
| `platforms` | yes | no | `local` | |
| `account` | yes | no | **external** | Menu uses `handleOpenHubAccount`, not Settings panes |
| `securityAudit` | yes | no | `states` *or* interfaceGap | No product pane; status/recovery chrome only |
| `archived` | no | no | drop / interfaceGap | Orphan IA only |
| `data` | no | no | drop / interfaceGap | Desktop still has live `settings.dataCategory.*` **labels** for data hygiene UI outside SettingsPage |

### 3.1 Explicit non-mappings

- `SettingsPaneId` does **not** include Tasks, Agents market, Account, or IM surfaces. Those are other workbench routes/pages.
- Collapsing a residual section to a pane only restores a **navigation intent**, not the deleted section body.

## 4. i18n residual inventory

### 4.1 Web `common.json` settings keys (28)

Paths: `app/web/src/i18n/locales/{en,zh}/common.json`

| Bucket | Keys | Code refs outside locales |
|---|---|---|
| Surface-bound descriptions (20) | `settings.<section>.description` for the 20 desktop sections | `surfaceMetadata.ts` only |
| Residual shell chrome (7) | `settings.open`, `settings.language`, `settings.theme`, `settings.sharedDesktopSection`, `settings.webLocal.{section,status,description}` | **none** |
| Test-touched title (1) | `settings.title` | `AgentHubWorkbench.test.tsx` mock map only |

Label keys used by surfaceMetadata (`settings.general`, `settings.tasks`, …) live on **desktop** locales, not web `common.json` — split ownership drift.

### 4.2 Desktop locales `settings.*` (1064 keys)

Paths: `app/desktop/src/i18n/locales/{en,zh}.json`  
EN/ZH key sets match (0 missing each side).

Classification against `app/{desktop,shared,web}/src` TS/TSX string refs:

| Class | Count | Meaning |
|---|---:|---|
| `static` | 39 | Exact `'settings…'` / `"settings…"` in source (includes surface label keys + dataCategory + a few live non-settings UI strings) |
| `dynamic` | 13 | Covered by `` t(`settings.${prefix}.${x}`) `` prefixes: `teamRunStatus`, `teamTaskStatus`, `teamMemberRole` |
| `dead` (no static/dynamic hit) | **1012** | Orphan Settings form/section copy mass |

Live non-surface desktop `settings.*` still used by shell UI (keep):

| Key / prefix | Consumer |
|---|---|
| `settings.dataCategory.*` (15) | `locales.test.ts` runtime list; residual data hygiene labeling |
| `settings.loading` | `FileSearchDialog.tsx` |
| `settings.statusReady`, `settings.targetLocalEdge` | Desktop/Web `WelcomeScreen.tsx` |
| `settings.teamRunStatus.*` | `HomeDashboard.tsx` (dynamic) |
| `settings.teamTaskStatus.*` | `IM/TeamTaskBoard.tsx` (dynamic) |
| `settings.teamMemberRole.*` | `IM/TeamMemberList.tsx` (dynamic) |

Workbench SettingsPage itself mostly hardcodes Chinese chrome / uses test-only `settings.nav.*` / `settings.pane.*` mocks — **not** the desktop 1064-key tree.

### 4.3 Surface translation key coverage gaps

| Key family | Desktop locale | Web locale |
|---|---|---|
| `settings.<section>` labels (20) | present | missing |
| `settings.<section>.description` (20) | missing | present |
| `surface.status.*` | missing | present |
| `surface.desktop.commandCenter.*` | missing | present |
| `surface.mobile.account.*` | missing | present |
| `surface.mobile.{threads,chat,runs}.*` | missing | **missing** |

No runtime UI currently resolves surfaceMetadata keys (registry unused outside tests), so gaps are latent until a surface browser returns.

## 5. Collapse plan (ordered, no UX redesign)

### Phase A — Document + fence (this PR / #530)

1. Keep `SettingsPaneId` as the only navigable SSOT.  
2. Leave `SectionId` annotated as residual typing (already).  
3. Publish this inventory + map.  
4. Optional: delete **zero-ref** residual shell i18n that is **not** surface-bound (see §6).  
5. Hold bulk desktop 1012-key deletion until surfaceMetadata collapse lands (keys are cheap; wrong deletes are noisy).

### Phase B — Dead menu/shortcut rebind or delete

| Option | Work | Risk |
|---|---|---|
| **B1 delete** unmounted `useTopMenuConfig` / `useShellShortcuts` / optional `TopMenuBar` if still unused | Removes `SectionId` sole import | Low if import-graph stays empty |
| **B2 rebind** hooks to `navigate('settings')` + `SettingsPaneId` using §3 map | Restores Ctrl+, / menu | Needs workbench mount decision |

Prefer B1 if product entry remains GlobalRail only; B2 if native menu bar returns.

Acceptance for B: no `SectionId` imports; `sectionIds.ts` deleted or reduced to re-export of `SettingsPaneId`.

### Phase C — `surfaceMetadata` collapse

Recommended target shape:

1. Replace 20 `desktop.settings.*` rows with **5** product rows:

   | Surface id | `desktopSectionId` / pane | defaultStatus (proposal) |
   |---|---|---|
   | `desktop.settings.appearance` | `appearance` | `localSource` |
   | `desktop.settings.notify` | `notify` | `localSource` |
   | `desktop.settings.agent` | `agent` | `localSource` |
   | `desktop.settings.local` | `local` | `localSource` |
   | `desktop.settings.states` | `states` | `localSource` |

2. Or drop `desktopSectionId` entirely and key surfaces by `SettingsPaneId`.  
3. Keep non-settings surfaces (`desktop.commandCenter`, `mobile.*`) unless a separate mobile IA task owns them.  
4. Update `surfaceMetadata.test.ts` expectations (`tasks` / `remoteControl` / `agentMarket` lookups).  
5. Align i18n keys to `settings.pane.<id>.*` or `surface.desktop.settings.<pane>.*` (one owner: shared or web).  
6. Mark truly missing product capabilities as `interfaceGap` rows **without** fake section bodies.

### Phase D — Locale cleanup after C

| Bucket | Action |
|---|---|
| Surface-bound old `settings.<section>(.description)` | Delete with surface rows |
| Desktop orphan form trees (`settings.agentCreator.*`, `settings.marketPublish.*`, section bodies, …) | Bulk delete once no static/dynamic refs remain |
| Live shell keys (§4.2) | Keep; optionally rename out of `settings.*` namespace later |
| Web residual shell keys | Deleted in §6 if zero-ref |

### Phase E — Optional product follow-ups (out of #530)

- Stop hardcoding Desktop demo `spaceTitle` / `spaceMeta` for Web (noted in settings empty/error inventory).  
- Wire SettingsPage copy to i18n (currently hardcoded CN) — separate product pass.  
- If menus return, map only the three dead intents: `general→appearance`, `tasks→agent`, `agentScheduling→agent`.

## 6. Optional dead-key cleanup in this PR

### 6.1 Evidence rule

Delete only when **all** are true:

1. Key is residual settings chrome / orphan shell copy  
2. Zero references in `app/**/*.{ts,tsx,js,jsx}` outside locale JSON  
3. Not required by `surfaceMetadata` labelKey/descriptionKey  
4. Not required by `locales.test.ts` runtime list / dynamic prefixes  

### 6.2 Applied (zero-ref shell chrome)

Removed from web `common.json` (en + zh) when present with zero non-locale refs:

- `settings.open`  
- `settings.language`  
- `settings.theme`  
- `settings.sharedDesktopSection`  
- `settings.webLocal.section`  
- `settings.webLocal.status`  
- `settings.webLocal.description`  

Matching desktop dead twins removed when present and zero-ref:

- `settings.sharedDesktopSection`  
- `settings.webLocal.section`  
- `settings.webLocal.status`  
- `settings.webLocal.description`  

### 6.3 Explicit hold

| Hold set | Why |
|---|---|
| 20 surface description keys (web) + 20 section labels (desktop) | Still string-coupled to `surfaceMetadata` |
| `settings.title` | Referenced by workbench test mock map |
| Desktop ~1000 orphan form keys | Zero-ref today, but mass delete is a separate hygiene PR; keep until Phase C/D |
| Live §4.2 keys | Still rendered |
| `SectionId` / hooks / surface rows | Code collapse is Phase B/C, not silent locale-only |

## 7. File checklist

| Path | Residual role | Next phase |
|---|---|---|
| `app/shared/src/workbench/pages/SettingsPage.tsx` | **SSOT** panes | keep |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | mounts pane state | keep |
| `app/desktop/src/components/settings/sectionIds.ts` | residual `SectionId` | B |
| `app/desktop/src/hooks/useTopMenuConfig.ts` | dead openSettings | B |
| `app/desktop/src/hooks/useShellShortcuts.ts` | dead Ctrl+, | B |
| `app/desktop/src/components/TopMenuBar.tsx` | unmounted chrome | B |
| `app/shared/src/surfaceMetadata.ts` | 20 orphan desktop sections | C |
| `app/shared/src/surfaceMetadata.test.ts` | locks orphan ids | C |
| `app/shared/src/index.ts` | re-exports surface helpers | C |
| `app/web/src/i18n/locales/{en,zh}/common.json` | surface descs + residual shell | C/D; shell subset cleaned in §6 |
| `app/desktop/src/i18n/locales/{en,zh}.json` | 1000+ orphan settings strings | D |
| `app/desktop/src/i18n/locales.test.ts` | residual settings root scan + dataCategory | B/D |
| `docs/analysis/settings-empty-error-inventory.md` | prior Settings empty/error inventory | companion; points residual mismatch |

## 8. Acceptance for #530

- [x] Residual inventory committed (`docs/analysis/settings-sectionid-residual-inventory.md`)  
- [x] Optional dead-key cleanup with evidence (§6 applied) **or** explicit hold (bulk desktop held)  
- [x] No UX redesign  
- [x] MASTER not modified  

## 9. Scan method (reproducible)

```bash
# From repo root (optional helper used while drafting):
python tmp/settings_residual_scan.py
```

Manual greps used for call-graph confirmation:

- `SectionId|SettingsPaneId|openSettings|desktopSectionId|getSurfaceByDesktopSectionId`
- `useTopMenuConfig|useShellShortcuts`
- `settings.<section>` across `app/**/*.{ts,tsx}`

Snapshot counts (2026-07-17 / branch `chore/530-settings-sectionid`):

- `SectionId` members: **32**  
- `surfaceMetadata` desktop sections: **20**  
- `SettingsPaneId` members: **5**  
- Desktop `settings.*` keys: **1064 → 1060** after §6 twin removal  
- Web `settings.*` keys: **28 → 21** after §6 shell chrome removal
