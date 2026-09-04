/* ═══════════════════════════════════════════════════════════════════════
   Settings page public types — extracted for Phase 18 strangler slice #572.
   ═══════════════════════════════════════════════════════════════════════ */

import type { DesignNavIconName } from '../../designIcons';
import type { LocalCliDiscoveryManifest, RuntimeSessionSummary } from '@shared/platform';

export type SettingsPaneId = 'appearance' | 'notify' | 'agent' | 'local' | 'states' | 'shortcuts';

export type StatePanelKind = 'empty' | 'invalid' | 'missing';

export interface SettingsPageProps {
  /** Currently active settings pane id. */
  activePane: SettingsPaneId;
  /** Human-friendly label for the current space. */
  spaceTitle: string;
  /** Meta description for the current space. */
  spaceMeta: string;
  /** Theme value for the appearance segment. */
  theme: string;
  /** Density value for the appearance segment. */
  density: string;
  /** Default run-step state for Agent blocks. */
  runStepDefault: string;
  /** Animation intensity. */
  animationIntensity: string;
  /** Right inspector default visibility. */
  inspectorVisible: boolean;
  /** Stacked Agent avatar mode. */
  stackedAvatars: boolean;
  /** Task-complete notification enabled. */
  taskCompleteNotify: boolean;
  /** Approval notification level. */
  approvalNotifyLevel: string;
  /** Failure notification enabled. */
  failureNotify: boolean;
  /** Project group message notify level. */
  projectGroupNotifyLevel: string;
  /** Cloud doc update notify level. */
  docUpdateNotifyLevel: string;
  /** Do-not-disturb window label. */
  dndWindow: string;
  /** Default model label. */
  defaultModel: string;
  /** Default executor label. */
  defaultExecutor: string;
  /** Tool call display level. */
  toolCallDisplay: string;
  /** Deep-thinking display level. */
  deepThinkingDisplay: string;
  /** Permission values keyed by tool name. */
  permissions: Record<string, string>;
  /** Local Vite preview URL. */
  vitePreviewUrl: string;
  /** Composer keyboard submit behavior. */
  composerSubmitBehavior: string;
  /** Local workspace path. */
  workspacePath: string;
  /** Target project path. */
  targetProjectPath: string;
  /** Hot-reload overlay enabled. */
  hrmOverlayEnabled: boolean;
  /** Visual QA mode label. */
  visualQaMode: string;
  /** Log level. */
  logLevel: string;
  /** Design-system validation mode. */
  designSystemValidation: string;
  /** Optional Desktop host CLI discovery status. */
  localCliDiscovery?: LocalCliDiscoveryManifest | null | undefined;
  /** Desktop-only local runtime session import list (#1192). */
  sessionImportItems?: RuntimeSessionSummary[] | undefined;
  sessionImportLoading?: boolean | undefined;
  sessionImportError?: string | undefined;
  sessionImportVisible?: boolean | undefined;
  onRefreshSessionImport?: (() => void) | undefined;
  /** State strategy toggles. */
  stateStrategies: Record<'empty' | 'invalid' | 'missing', boolean>;
  /** Called when the user selects a different pane. */
  onSelectPane: (pane: SettingsPaneId) => void;
  /** Called when any setting value changes. */
  onChangeSetting: (key: string, value: string | boolean) => void;
  /** Called when the user wants to open individual Agent configuration.
   *  Navigates to the AgentsPage where per-agent runtime, model, system
   *  prompt and MCP bindings can be configured. */
  onOpenAgentConfig?: () => void;
  /** Current user display name from OIDC. */
  currentUserDisplayName?: string | undefined;
  /** True while settingsService is loading remote values. */
  settingsLoading?: boolean | undefined;
  /** Last settings load/write error message. */
  settingsError?: string | null | undefined;
  /** Whether the last error came from init or write. */
  settingsErrorKind?: 'init' | 'write' | null | undefined;
  /** Retry loading settings after an init failure. */
  onRetrySettingsLoad?: (() => void) | undefined;
  /** Dismiss a transient write-error notice. */
  onDismissSettingsError?: (() => void) | undefined;
}

export interface NavItem {
  id: SettingsPaneId;
  label: string;
  glyph: DesignNavIconName;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'appearance', label: '外观', glyph: 'palette' },
  { id: 'notify', label: '通知', glyph: 'bell' },
  { id: 'agent', label: 'Agent 默认值', glyph: 'agent' },
  { id: 'local', label: '本地开发', glyph: 'laptop' },
  { id: 'shortcuts', label: '快捷键', glyph: 'edit' },
  { id: 'states', label: '状态组件', glyph: 'states' },
];

export interface PaneMeta {
  title: string;
  description: string;
}

export const PANE_META: Record<SettingsPaneId, PaneMeta> = {
  appearance: {
    title: '外观',
    description: '统一控制应用主题、密度、动画和 Agent 运行块的默认呈现方式。',
  },
  notify: {
    title: '通知',
    description: '管理 Agent 运行、审批、项目群和云文档更新的提醒策略。',
  },
  agent: {
    title: 'Agent 默认值',
    description: '设置新会话默认模型、工具权限、审批策略和运行记录展示方式。',
  },
  local: {
    title: '本地开发',
    description: '配置本地 Vite 预览、工作目录、日志和设计 demo 调试开关。',
  },
  shortcuts: {
    title: '快捷键',
    description: '查看和自定义键盘快捷键。红色标记表示存在按键冲突。',
  },
  states: {
    title: '状态组件',
    description: '统一空状态、无效状态、404 和错误恢复样式，避免各页面自行发挥。',
  },
};

/** Permission row config: [tool, default-value, description]. */
export const PERMISSION_ROWS: [string, string, string][] = [
  ['Read', '允许', '读取仓库文件和设计文档'],
  ['Write', '需确认', '写入源码、样式、配置'],
  ['Shell', '需确认', '运行本地命令和验证脚本'],
  ['Browser', '允许', '打开本地预览和截图验证'],
];
