import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Bot,
  Check,
  CircleHelp,
  ClipboardCheck,
  Copy,
  Cpu,
  Download,
  Ellipsis,
  ExternalLink,
  FileQuestion,
  FileText,
  Filter,
  Folder,
  Globe,
  HardDrive,
  Headphones,
  Home,
  Inbox,
  Laptop,
  LayoutGrid,
  LayoutTemplate,
  Library,
  List,
  ListChecks,
  Lock,
  LogOut,
  MessageSquare,
  Notebook,
  Package,
  Palette,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Store,
  Sun,
  Upload,
  User,
  UserPlus,
  Users,
  Wrench,
  X,
  ChevronDown,
  Send,
} from 'lucide-react';
import AntigravityIcon from '@lobehub/icons/es/Antigravity/components/Color.js';

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

type IconProps = {
  className?: string | undefined;
  name?: string | undefined;
  type?: string | undefined;
};

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

export function getDesignFileIconType(
  type: string | undefined,
  name: string | undefined
): DesignFileIconType {
  const fileName = (name ?? '').toLowerCase();
  if (fileName === '.gitignore' || fileName.startsWith('.git')) return 'git';

  const ext = fileName.match(/\.([a-z0-9]+)$/)?.[1];
  const normalized = (ext || type || 'file').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return DESIGN_FILE_ICON_TYPES.has(normalized as DesignFileIconType)
    ? (normalized as DesignFileIconType)
    : 'file';
}

export function getDesignFileIconColor(type: DesignFileIconType): string {
  switch (type) {
    case 'md':
    case 'markdown':
    case 'yml':
    case 'yaml':
      return 'var(--text-2)';
    case 'css':
      return '#1572b6';
    case 'html':
      return '#e34f26';
    case 'js':
      return '#f7df1e';
    case 'ts':
    case 'tsx':
      return '#3178c6';
    case 'sql':
    case 'db':
      return 'var(--info, var(--state-running))';
    case 'ps1':
    case 'powershell':
      return '#5391fe';
    case 'git':
      return '#f05032';
    case 'xlsx':
    case 'csv':
      return '#217346';
    case 'link':
      return 'var(--primary)';
    default:
      return 'var(--text-3)';
  }
}

function fileSvg(type: DesignFileIconType): React.ReactElement {
  const common = {
    'aria-hidden': true,
    viewBox: '0 0 24 24',
  } as const;

  switch (type) {
    case 'md':
    case 'markdown':
      return (
        <svg {...common} fill="currentColor">
          <rect x="2.5" y="5" width="19" height="14" rx="1.6" />
          <path
            fill="var(--surface)"
            d="M5.2 15.5V8.6h2l1.75 2.2 1.75-2.2h2v6.9h-2v-4l-1.75 2.08L7.2 11.5v4h-2Zm10.7 0-2.5-3.05h1.65V8.6h1.9v3.85h1.65l-2.7 3.05Z"
          />
        </svg>
      );
    case 'css':
      return (
        <svg {...common} fill="currentColor">
          <path d="M4 2h16l-1.45 16.25L12 22l-6.55-3.75L4 2Z" />
          <path
            fill="var(--surface)"
            d="M8.2 7h8l-.18 2H10.4l.13 1.55h5.35l-.42 4.75L12 17.3l-3.45-2-.22-2.48h2.05l.1 1.12L12 14.8l1.52-.86.13-1.45H8.15L7.8 7Z"
          />
        </svg>
      );
    case 'html':
      return (
        <svg {...common} fill="currentColor">
          <path d="M4 2h16l-1.45 16.25L12 22l-6.55-3.75L4 2Z" />
          <path
            fill="var(--surface)"
            d="M8.05 7h7.9l-.18 2H10.2l.13 1.45h5.3l-.42 4.85L12 17.25l-3.2-1.95-.22-2.45h2.02l.1 1.1 1.3.78 1.32-.78.14-1.55H8.46L8.05 7Z"
          />
        </svg>
      );
    case 'js':
      return (
        <svg {...common} fill="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path
            fill="var(--surface)"
            d="M8.3 16.1c.35.55.78.95 1.55.95.72 0 1.15-.36 1.15-1.75V8.2h1.95v7.15c0 2.05-1.2 3.25-3.02 3.25-1.62 0-2.56-.84-3.04-1.85l1.41-.65Zm5.8-.16c.52.85 1.2 1.18 2.05 1.18.86 0 1.4-.42 1.4-1 0-.7-.55-.95-1.5-1.36l-.52-.22c-1.48-.63-2.46-1.42-2.46-3.1 0-1.54 1.17-2.7 3-2.7 1.3 0 2.24.45 2.91 1.64l-1.38.88c-.35-.63-.72-.88-1.53-.88-.7 0-1.15.44-1.15.98 0 .68.42.95 1.38 1.37l.52.22c1.75.75 2.73 1.52 2.73 3.24 0 1.86-1.46 2.88-3.42 2.88-1.92 0-3.16-.92-3.76-2.12l1.73-1Z"
          />
        </svg>
      );
    case 'ts':
    case 'tsx':
      return (
        <svg {...common} fill="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path
            fill="var(--surface)"
            d="M6.4 9.1h7.1v1.82h-2.55v7.18H8.96v-7.18H6.4V9.1Zm7.55 7.72c.48.76 1.1 1.05 1.86 1.05.78 0 1.26-.36 1.26-.9 0-.62-.5-.84-1.35-1.2l-.48-.2c-1.35-.58-2.23-1.28-2.23-2.78 0-1.4 1.06-2.46 2.72-2.46 1.2 0 2.04.42 2.66 1.48l-1.26.8c-.32-.56-.66-.78-1.4-.78-.64 0-1.04.4-1.04.9 0 .6.38.84 1.25 1.22l.48.2c1.58.68 2.47 1.36 2.47 2.92 0 1.68-1.32 2.6-3.1 2.6-1.72 0-2.84-.82-3.4-1.9l1.56-.95Z"
          />
        </svg>
      );
    case 'sql':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="5.5" rx="7" ry="3" />
          <path d="M5 5.5v8.8c0 1.65 3.13 3 7 3s7-1.35 7-3V5.5" />
          <path d="M5 10c0 1.65 3.13 3 7 3s7-1.35 7-3" />
        </svg>
      );
    case 'db':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="5.5" rx="7" ry="3" />
          <path d="M5 5.5v13c0 1.65 3.13 3 7 3s7-1.35 7-3v-13" />
          <path d="M5 12c0 1.65 3.13 3 7 3s7-1.35 7-3" />
        </svg>
      );
    case 'yaml':
    case 'yml':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M8 8 4 12l4 4M16 8l4 4-4 4" />
          <path d="m13.5 6-3 12" />
        </svg>
      );
    case 'ps1':
    case 'powershell':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="m5 7 5 5-5 5" />
          <path d="M12 17h7" />
        </svg>
      );
    case 'git':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M7 7a2 2 0 1 0 0 .01V17a2 2 0 1 0 2 2" />
          <path d="M7 9c4 0 4 3 8 3" />
          <circle cx="17" cy="12" r="2" />
        </svg>
      );
    case 'xlsx':
    case 'csv':
      return (
        <svg {...common} fill="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path
            fill="var(--surface)"
            d="M7 8.2h2.25l1.48 2.62 1.5-2.62h2.1l-2.45 4.04 2.68 4.56h-2.24l-1.68-2.98-1.72 2.98H6.8l2.72-4.48L7 8.2Zm8.2.05h2v8.5h-2v-8.5Z"
          />
        </svg>
      );
    case 'link':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M14 3h7v7" />
          <path d="M10 14 21 3" />
          <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
        </svg>
      );
  }
}

export function DesignFileIcon({ className, name, type }: IconProps): React.ReactElement {
  const normalized = getDesignFileIconType(type, name);
  return (
    <span
      aria-hidden="true"
      className={className}
      data-design-file-icon={normalized}
      style={{ color: getDesignFileIconColor(normalized) }}
    >
      {fileSvg(normalized)}
    </span>
  );
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
  | 'railDocs'
  | 'railProjects'
  | 'railSettings'
  | 'refresh'
  | 'running'
  | 'search'
  | 'settings'
  | 'service'
  | 'send'
  | 'sidebarLeft'
  | 'sidebarRight'
  | 'star'
  | 'states'
  | 'store'
  | 'sun'
  | 'tasks'
  | 'template'
  | 'tools'
  | 'upload'
  | 'user'
  | 'userPlus'
  | 'users';

export function profileActionIconName(action: string): DesignNavIconName {
  if (action.includes('消息')) return 'notes';
  if (action.includes('项目')) return 'grid';
  if (action.includes('云文档')) return 'fileText';
  if (action.includes('配置')) return 'tools';
  if (action.includes('复制')) return 'copy';
  if (action.includes('设置')) return 'settings';
  if (action.includes('登录更多')) return 'plus';
  if (action.includes('退出')) return 'logout';
  if (action.includes('二维码')) return 'qrcode';
  if (action.includes('名片') || action.includes('资料')) return 'user';
  if (action.includes('帮助') || action.includes('客服')) return 'help';
  if (action.includes('管理后台')) return 'grid';
  if (action.includes('状态')) return 'check';
  if (action.includes('邀请')) return 'userPlus';
  return 'external';
}

function navIconPaths(name: DesignNavIconName): React.ReactNode {
  switch (name) {
    case 'chat':
      return <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    case 'railContacts':
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );
    case 'railDocs':
      return (
        <>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M9 13h6M9 17h4" />
        </>
      );
    case 'railAgent':
      return (
        <>
          <rect x="4.5" y="9" width="15" height="11.5" rx="3" />
          <path d="M12 5.5v3.5" />
          <circle cx="12" cy="4.25" r="1.75" />
          <path d="M3.25 13.5v3.5M20.75 13.5v3.5" />
          <path d="M8.5 14.25h.1M15.5 14.25h.1" />
          <path d="M9.5 17.75h5" />
        </>
      );
    case 'railProjects':
      return (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </>
      );
    case 'railSettings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
      );
    case 'users':
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="3.5" />
          <path d="M20.5 21v-2.2a3.4 3.4 0 0 0-2.4-3.2" />
          <path d="M16.4 3.5a3.4 3.4 0 0 1 0 6.6" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
        </>
      );
    case 'external':
      return (
        <>
          <path d="M8 18a6 6 0 0 1 8-8" />
          <path d="M10 14a6 6 0 0 1 8-8" />
          <path d="M14 19h5v-5" />
          <path d="m19 19-6-6" />
        </>
      );
    case 'userPlus':
      return (
        <>
          <circle cx="9" cy="7" r="3.5" />
          <path d="M3 21v-1.5A4.5 4.5 0 0 1 7.5 15h3" />
          <path d="M17 11v8" />
          <path d="M13 15h8" />
        </>
      );
    case 'groups':
      return (
        <>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </>
      );
    case 'service':
      return (
        <>
          <path d="M4 13a8 8 0 0 1 16 0" />
          <path d="M5 13h3v5H6a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2Z" />
          <path d="M16 13h3a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2v-5Z" />
          <path d="M17 18c0 2-1.8 3-5 3" />
        </>
      );
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.8 2.8 0 0 1 5.1 1.6c0 1.9-2.6 2.2-2.6 4" />
          <path d="M12 18h.01" />
        </>
      );
    case 'home':
      return (
        <>
          <path d="m4 11 8-7 8 7" />
          <path d="M6 10v10h12V10" />
          <path d="M10 20v-5h4v5" />
        </>
      );
    case 'drive':
      return (
        <>
          <path d="M4 17h16" />
          <path d="m7 17 3-10h4l3 10" />
          <path d="M7 17l-2 4h14l-2-4" />
        </>
      );
    case 'library':
      return (
        <>
          <path d="M5 4h5v17H5z" />
          <path d="M10 4h5v17h-5z" />
          <path d="m17 5 3 16" />
        </>
      );
    case 'notes':
      return (
        <>
          <path d="M6 4h12v16H6z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </>
      );
    case 'overview':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h9" />
        </>
      );
    case 'browser':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.4 2.6 3.6 5.6 3.6 9S14.4 18.4 12 21" />
          <path d="M12 3C9.6 5.6 8.4 8.6 8.4 12S9.6 18.4 12 21" />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 20h14" />
        </>
      );
    case 'package':
      return (
        <>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
          <path d="M4 7.5 12 12l8-4.5" />
          <path d="M12 12v9" />
        </>
      );
    case 'store':
      return (
        <>
          <path d="M4 10h16l-1.5-6h-13Z" />
          <path d="M6 10v10h12V10" />
          <path d="M9 20v-5h6v5" />
        </>
      );
    case 'policy':
      return (
        <>
          <path d="M12 3v5l3-3" />
          <path d="M12 8 9 5" />
          <path d="M5 12a7 7 0 0 1 13-3" />
          <path d="M12 21v-5l-3 3" />
          <path d="m12 16 3 3" />
          <path d="M19 12a7 7 0 0 1-13 3" />
        </>
      );
    case 'model':
      return (
        <>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          <path d="M9 9h6v6H9z" />
        </>
      );
    case 'audit':
      return (
        <>
          <path d="M6 4h12v18H6z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h3" />
          <path d="m15 17 1.5 1.5 3-3" />
        </>
      );
    case 'folder':
      return <path d="M4 6h7l2 2h7v12H4z" />;
    case 'grid':
      return (
        <>
          <path d="M5 5h6v6H5z" />
          <path d="M13 5h6v6h-6z" />
          <path d="M5 13h6v6H5z" />
          <path d="M13 13h6v6h-6z" />
        </>
      );
    case 'running':
      return (
        <>
          <path d="M5 12h6" />
          <path d="m12 5 7 7-7 7" />
        </>
      );
    case 'done':
      return <path d="M20 6 9 17l-5-5" />;
    case 'archive':
      return (
        <>
          <path d="M4 7h16" />
          <path d="M6 7v14h12V7" />
          <path d="M9 11h6" />
          <path d="M5 3h14v4H5z" />
        </>
      );
    case 'bell':
      return (
        <>
          <path d="M6 9a6 6 0 0 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9" />
          <path d="M10 21h4" />
        </>
      );
    case 'palette':
      return (
        <>
          <path d="M12 4a8 8 0 0 0 0 16h1.5a1.8 1.8 0 0 0 .6-3.5 1.8 1.8 0 0 1 .6-3.5H16a4 4 0 0 0 0-8Z" />
          <circle cx="8.5" cy="10" r=".8" />
          <circle cx="11" cy="8" r=".8" />
          <circle cx="7.5" cy="13.5" r=".8" />
        </>
      );
    case 'agent':
      return (
        <>
          <rect x="4" y="9" width="16" height="11" rx="2" />
          <path d="M12 5v4" />
          <circle cx="12" cy="4" r="2" />
          <path d="M8 14h.1M16 14h.1" />
        </>
      );
    case 'tasks':
      return (
        <>
          <path d="M4 6h11" />
          <path d="M4 12h9" />
          <path d="M4 18h7" />
          <path d="m16 17 2 2 4-5" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z" />
          <path d="M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4m-8.6 8.6l-1.4 1.4" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </>
      );
    case 'sidebarLeft':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      );
    case 'sidebarRight':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M15 4v16" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </>
      );
    case 'laptop':
      return (
        <>
          <path d="M5 5h14v10H5z" />
          <path d="M3 19h18l-2-4H5Z" />
        </>
      );
    case 'states':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h14" />
          <circle cx="7" cy="7" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="17" cy="17" r="2" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M4 13h4l2 3h4l2-3h4" />
          <path d="M5 13 7.5 5h9L19 13v6H5Z" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V8a4 4 0 0 1 8 0v2" />
          <path d="M12 14v2" />
        </>
      );
    case 'error404':
      return (
        <>
          <path d="M14 3H6v18h12V7Z" />
          <path d="M14 3v4h4" />
          <path d="M9.5 12.5h.01" />
          <path d="M14.5 12.5h.01" />
          <path d="M10 17c1.2-1 2.8-1 4 0" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      );
    case 'logout':
      return (
        <>
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
          <path d="M14 8l4 4-4 4" />
          <path d="M18 12H9" />
        </>
      );
    case 'qrcode':
      return (
        <>
          <path d="M4 4h6v6H4z" />
          <path d="M14 4h6v6h-6z" />
          <path d="M4 14h6v6H4z" />
          <path d="M14 14h2v2h-2z" />
          <path d="M18 14h2v4h-4v2h-2v-4h4z" />
        </>
      );
    case 'check':
      return <path d="M20 6 9 17l-5-5" />;
    case 'checkCircle':
      return (
        <>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" fill="currentColor" stroke="none" />
          <path
            d="m10.8 15.8-4-4 1.4-1.4 2.6 2.6 5.9-5.9 1.4 1.4-7.3 7.3Z"
            fill="var(--surface)"
            stroke="none"
          />
        </>
      );
    case 'plus':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      );
    case 'pin':
      return (
        <>
          <path d="M12 19V5" />
          <path d="m6 11 6-6 6 6" />
        </>
      );
    case 'paperclip':
      return (
        <>
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </>
      );
    case 'upload':
      return (
        <>
          <path d="M12 20V6" />
          <path d="m7 11 5-5 5 5" />
          <path d="M5 20h14" />
        </>
      );
    case 'template':
      return (
        <>
          <path d="M5 5h6v6H5z" />
          <path d="M13 5h6v6h-6z" />
          <path d="M5 13h14v6H5z" />
        </>
      );
    case 'fileText':
      return (
        <>
          <path d="M14 3H6v18h12V7Z" />
          <path d="M14 3v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </>
      );
    case 'filter':
      return (
        <>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </>
      );
    case 'back':
      return (
        <>
          <path d="M15 18 9 12l6-6" />
          <path d="M20 12H9" />
        </>
      );
    case 'forward':
      return (
        <>
          <path d="m9 18 6-6-6-6" />
          <path d="M4 12h11" />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M20 11a8 8 0 0 0-14.5-4.6L4 8" />
          <path d="M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14.5 4.6L20 16" />
          <path d="M20 20v-4h-4" />
        </>
      );
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </>
      );
    case 'tools':
      return (
        <>
          <path d="m14.7 6.3 3 3" />
          <path d="M4 20l7.5-7.5" />
          <path d="M13 5a4 4 0 0 0 5 5l-8 8H6v-4Z" />
        </>
      );
    case 'star':
      return <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9Z" />;
    case 'link':
      return (
        <>
          <path d="M14 3h7v7" />
          <path d="M10 14 21 3" />
          <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </>
      );
    case 'send':
      return (
        <>
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </>
      );
    case 'chevron':
      return <polyline points="6 9 12 15 18 9" />;
    case 'close':
      return (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      );
    case 'preview':
      return (
        <>
          <path d="M9 18H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
          <path d="M9 8h5" />
          <path d="M9 12h3" />
          <path d="M14 15h6" />
          <path d="m17 12 3 3-3 3" />
        </>
      );
    default:
      return <path d="M4 6h7l2 2h7v12H4z" />;
  }
}

export function DesignNavIcon({
  className,
  name = 'folder',
  size = DESIGN_NAV_ICON_SIZE,
  strokeWidth = DESIGN_NAV_ICON_STROKE_WIDTH,
}: {
  className?: string | undefined;
  name?: DesignNavIconName | undefined;
  size?: number | undefined;
  strokeWidth?: number | undefined;
}): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {navIconPaths(name)}
    </svg>
  );
}

export function DesignOpenWithIcon({
  className,
  imageClassName,
  name,
  size = 18,
}: {
  className?: string | undefined;
  imageClassName?: string | undefined;
  name: DesignOpenWithIconName;
  size?: number | undefined;
}): React.ReactElement {
  switch (name) {
    case 'vscode':
      return (
        <svg aria-label="VS Code" className={imageClassName ?? className} viewBox="0 0 128 128">
          <path fill="#0065A9" d="M123.471 13.82 97.097 1.12A7.973 7.973 0 0 0 88 2.668L1.662 81.387a5.333 5.333 0 0 0 .006 7.887l7.052 6.411a5.333 5.333 0 0 0 6.811.303l103.971-78.875c3.488-2.646 8.498-.158 8.498 4.22v-.306a8.001 8.001 0 0 0-4.529-7.208Z" />
          <path fill="#007ACC" d="m123.471 114.181-26.374 12.698A7.973 7.973 0 0 1 88 125.333L1.662 46.613a5.333 5.333 0 0 1 .006-7.887l7.052-6.411a5.333 5.333 0 0 1 6.811-.303l103.971 78.874c3.488 2.647 8.498.159 8.498-4.219v.306a8.001 8.001 0 0 1-4.529 7.208Z" />
          <path fill="#1F9CF0" d="M97.098 126.882A7.977 7.977 0 0 1 88 125.333c2.952 2.952 8 .861 8-3.314V5.98c0-4.175-5.048-6.266-8-3.313a7.977 7.977 0 0 1 9.098-1.549L123.467 13.8A8 8 0 0 1 128 21.01v85.982a8 8 0 0 1-4.533 7.21l-26.369 12.681Z" />
        </svg>
      );
    case 'visualStudio':
      return (
        <svg aria-label="Visual Studio" className={imageClassName ?? className} viewBox="0 0 128 128">
          <path fill="#52218a" d="M14.39 26.295a5.333 5.333 0 0 0-1.417.373l-9.694 4A5.333 5.333 0 0 0 0 35.561v56.88a5.333 5.333 0 0 0 3.28 4.893l9.693 4.066a5.333 5.333 0 0 0 5.521-.865l2.172-1.867a2.947 2.947 0 0 1-4.666-2.4V31.734a2.947 2.947 0 0 1 4.666-2.4l-2.172-1.799a5.333 5.333 0 0 0-4.103-1.24z" />
          <path fill="#6c33af" d="M94.75.416A8 8 0 0 0 88 2.668l-82.666 91.4A3.08 3.08 0 0 1 0 92.002v.44a5.333 5.333 0 0 0 3.28 4.892l9.693 4.066a5.333 5.333 0 0 0 5.521-.865l2.172-1.867 99.08-81.24A5.053 5.053 0 0 1 128 21.334v-.307a8 8 0 0 0-4.533-7.213L97.094 1.121A8 8 0 0 0 94.75.416Z" />
          <path fill="#854cc7" d="M14.871 26.238a5.333 5.333 0 0 0-1.898.43l-9.694 4A5.333 5.333 0 0 0 0 35.561v.441a3.08 3.08 0 0 1 5.334-2.066L88 125.334a8 8 0 0 0 9.094 1.547l26.373-12.694a8 8 0 0 0 4.533-7.212v-.307a5.053 5.053 0 0 1-8.254 3.906l-99.08-81.24-2.172-1.865a5.333 5.333 0 0 0-3.623-1.23z" />
          <path fill="#b179f1" d="M94.75.416a8 8 0 0 0-5.674 1.469A4.693 4.693 0 0 1 96 6.015v116a4.693 4.693 0 0 1-8 3.319 8 8 0 0 0 9.094 1.547l26.373-12.68a8 8 0 0 0 4.533-7.213V21.016a8 8 0 0 0-4.533-7.215L97.094 1.12A8 8 0 0 0 94.75.416Z" />
        </svg>
      );
    case 'cursor':
      return (
        <svg aria-label="Cursor" className={className} role="img" viewBox="0 0 24 24">
          <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" fill="#000000" />
        </svg>
      );
    case 'antigravity':
      return <AntigravityIcon className={className} size={size} />;
    case 'defaultApp':
      return (
        <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
          <path d="M5 4h14v16H5z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case 'terminal':
      return (
        <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
          <path d="M4 5h16v14H4z" />
          <path d="m7 9 3 3-3 3M12 15h5" />
        </svg>
      );
    case 'gitBash':
      return (
        <svg aria-label="Git for Windows" className={className} role="img" viewBox="0 0 24 24">
          <path d="M11.976.0003a1.541 1.541 0 0 0-1.0928.4526L8.707 2.6287l2.7604 2.7604c.6417-.2166 1.377-.0715 1.8882.4399.514.5145.6583 1.2563.4362 1.9l.9101.9102 3.2768-3.2764L13.0684.4529A1.5394 1.5394 0 0 0 11.976.0003ZM7.638 3.698 5.926 5.4101l4.9095 4.9095c.1535.1536.332.267.5217.3423V8.831a1.8198 1.8198 0 0 1-.6024-.4011c-.5441-.5437-.6749-1.3422-.3958-2.0104Zm10.916 2.24-3.2765 3.2764 1.1743 1.1747c.6436-.2217 1.3862-.0782 1.9001.4366.7185.7183.7185 1.8823 0 2.6008-.7186.7187-1.8823.7187-2.6012 0-.5402-.5407-.674-1.3344-.4003-2l-1.1427-1.1423-.588.588c-.6036.604-.6036 1.5829 0 2.1865l4.9935 4.993 4.9342-4.9342c.6035-.6038.6035-1.5829 0-2.1865zM5.34 5.9956.4528 10.8825c-.6037.604-.6037 1.5828 0 2.1864l4.8395 4.8396 4.8873-4.8873c.6035-.6038.6035-1.5828 0-2.1865zm7.5293 2.9497v1.4986c.0516-.04.1048-.077.1522-.1243l.611-.611zm-1.5121 4.2224c-.2317.072-.4514.1927-.6349.376-1.6323 1.6325-3.2647 3.2649-4.8971 4.8972l5.1065 5.1062c.6033.6035 1.582.6035 2.1861 0l4.8967-4.8968-5.1065-5.1065c-.012-.012-.0264-.0202-.0387-.0317v1.9618a1.854 1.854 0 0 1 .4863.3477c.7183.7182.7183 1.8819 0 2.6012-.7185.7182-1.883.7182-2.6008 0-.7184-.7193-.7184-1.883 0-2.6012a1.8406 1.8406 0 0 1 .6024-.4012z" fill="#80B3FF" />
        </svg>
      );
    case 'wsl':
      return <DesignBrandPathIcon className={className} icon={siLinux} />;
    case 'androidStudio':
      return (
        <img alt="Android Studio" className={imageClassName ?? className} src={androidStudioIcon} />
      );
    case 'folder':
      return (
        <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
          <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15v-13.5Z" />
          <path d="M3.5 8.5h17" />
        </svg>
      );
  }
}

function DesignBrandPathIcon({
  className,
  icon,
}: {
  className?: string | undefined;
  icon: { hex: string; path: string; title: string };
}): React.ReactElement {
  return (
    <svg aria-label={icon.title} className={className} role="img" viewBox="0 0 24 24">
      <path d={icon.path} fill={`#${icon.hex}`} />
    </svg>
  );
}
