/* ═══════════════════════════════════════════════════════════════════════
   designIconsHelpers — pure types/constants/maps/type-guards from designIcons
   residual thin (#754). No React components / no UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export const DESIGN_FILE_ICON_SIZE = 17;
export const DESIGN_FILE_ICON_RADIUS = 3;
export const DESIGN_NAV_ICON_SIZE = 16;
export const DESIGN_NAV_ICON_STROKE_WIDTH = 1.9;
export const DESIGN_NAV_GLYPH_SIZE = 17;
export const DESIGN_NAV_GLYPH_STROKE_WIDTH = 1.85;

export type DesignOpenWithIconName =
  | 'androidStudio'
  | 'antigravity'
  | 'cursor'
  | 'defaultApp'
  | 'folder'
  | 'gitBash'
  | 'terminal'
  | 'visualStudio'
  | 'vscode'
  | 'wsl';

export type DesignFileIconType =
  | 'css'
  | 'csv'
  | 'db'
  | 'file'
  | 'git'
  | 'html'
  | 'js'
  | 'link'
  | 'markdown'
  | 'md'
  | 'powershell'
  | 'ps1'
  | 'sql'
  | 'ts'
  | 'tsx'
  | 'xlsx'
  | 'yaml'
  | 'yml';

const DESIGN_FILE_ICON_TYPES = new Set<DesignFileIconType>([
  'css',
  'csv',
  'db',
  'file',
  'git',
  'html',
  'js',
  'link',
  'markdown',
  'md',
  'powershell',
  'ps1',
  'sql',
  'ts',
  'tsx',
  'xlsx',
  'yaml',
  'yml',
]);

export function isDesignFileIconType(value: string): value is DesignFileIconType {
  return DESIGN_FILE_ICON_TYPES.has(value as DesignFileIconType);
}

export function getDesignFileIconType(
  type: string | undefined,
  name: string | undefined
): DesignFileIconType {
  const fileName = (name ?? '').toLowerCase();
  if (fileName === '.gitignore' || fileName.startsWith('.git')) return 'git';

  const ext = fileName.match(/\.([a-z0-9]+)$/)?.[1];
  const normalized = (ext || type || 'file').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return isDesignFileIconType(normalized) ? normalized : 'file';
}

/** Color map aligned to tokendance-design/desktop file icons. */
export const DESIGN_FILE_ICON_COLORS: Record<DesignFileIconType, string> = {
  md: 'var(--td-ink-muted)',
  markdown: 'var(--td-ink-muted)',
  yml: 'var(--td-ink-muted)',
  yaml: 'var(--td-ink-muted)',
  css: '#1572b6',
  html: '#e34f26',
  js: '#f7df1e',
  ts: '#3178c6',
  tsx: '#3178c6',
  sql: 'var(--info, var(--state-running))',
  db: 'var(--info, var(--state-running))',
  ps1: '#5391fe',
  powershell: '#5391fe',
  git: '#f05032',
  xlsx: '#217346',
  csv: '#217346',
  link: 'var(--td-plum)',
  file: 'var(--td-ink-subtle)',
};

export function getDesignFileIconColor(type: DesignFileIconType): string {
  return DESIGN_FILE_ICON_COLORS[type] ?? 'var(--td-ink-subtle)';
}

export type DesignNavIconName =
  | 'agent'
  | 'archive'
  | 'audit'
  | 'back'
  | 'bell'
  | 'browser'
  | 'chat'
  | 'check'
  | 'checkCircle'
  | 'chevron'
  | 'close'
  | 'copy'
  | 'done'
  | 'download'
  | 'drive'
  | 'edit'
  | 'error404'
  | 'external'
  | 'fileText'
  | 'filter'
  | 'folder'
  | 'forward'
  | 'grid'
  | 'groups'
  | 'help'
  | 'home'
  | 'inbox'
  | 'library'
  | 'link'
  | 'laptop'
  | 'lock'
  | 'logout'
  | 'model'
  | 'more'
  | 'notes'
  | 'overview'
  | 'package'
  | 'palette'
  | 'policy'
  | 'pin'
  | 'plus'
  | 'paperclip'
  | 'preview'
  | 'qrcode'
  | 'railAgent'
  | 'railContacts'
  | 'railDevices'
  | 'railDocs'
  | 'railProjects'
  | 'railSettings'
  | 'railUsage'
  | 'refresh'
  | 'running'
  | 'search'
  | 'settings'
  | 'service'
  | 'send'
  | 'sidebarLeft'
  | 'sidebarRight'
  | 'split'
  | 'star'
  | 'states'
  | 'stop'
  | 'store'
  | 'sun'
  | 'tasks'
  | 'template'
  | 'tools'
  | 'upload'
  | 'user'
  | 'userPlus'
  | 'users';

/** Ordered keyword → glyph rules for profile action labels (first match wins). */
export const PROFILE_ACTION_ICON_RULES: ReadonlyArray<readonly [string, DesignNavIconName]> = [
  ['消息', 'notes'],
  ['项目', 'grid'],
  ['云文档', 'fileText'],
  ['配置', 'tools'],
  ['复制', 'copy'],
  ['设置', 'settings'],
  ['登录更多', 'plus'],
  ['退出', 'logout'],
  ['二维码', 'qrcode'],
  ['名片', 'user'],
  ['资料', 'user'],
  ['帮助', 'help'],
  ['客服', 'help'],
  ['管理后台', 'grid'],
  ['状态', 'check'],
  ['邀请', 'userPlus'],
];

export function profileActionIconName(action: string): DesignNavIconName {
  for (const [keyword, icon] of PROFILE_ACTION_ICON_RULES) {
    if (action.includes(keyword)) return icon;
  }
  return 'external';
}
