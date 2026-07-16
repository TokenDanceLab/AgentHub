// Extracted from orphan SettingsPage for menu typing (#443).
// Product Settings UI SSOT remains app/shared workbench SettingsPage.
//
// Product navigable panes (SettingsPaneId in shared SettingsPage):
//   appearance | notify | agent | local | states
//
// SectionId below is a residual shell/menu type only. Do NOT treat these
// values as navigable Settings panes. Dead openSettings('general'|'tasks'|
// 'agentScheduling') callers (useTopMenuConfig / useShellShortcuts) are
// currently unmounted; if rewired, map intent to SettingsPaneId, e.g.
//   general / appearance  → 'appearance'
//   tasks / agentScheduling → 'agent' (nearest product pane; not 1:1)
// Full collapse of SectionId → SettingsPaneId is a larger follow-up (#470).

export type SectionId =
  | 'general'
  | 'appearance'
  | 'configuration'
  | 'personalization'
  | 'permissions'
  | 'agentProfiles'
  | 'executionTargets'
  | 'tasks'
  | 'onlineIm'
  | 'groupChat'
  | 'agentScheduling'
  | 'agentMarket'
  | 'keyboard'
  | 'mcp'
  | 'skills'
  | 'hooks'
  | 'models'
  | 'modelMapping'
  | 'ccSwitch'
  | 'connections'
  | 'remoteControl'
  | 'git'
  | 'environment'
  | 'worktree'
  | 'browser'
  | 'computerUse'
  | 'platforms'
  | 'account'
  | 'securityAudit'
  | 'archived'
  | 'data'
  | 'about';
