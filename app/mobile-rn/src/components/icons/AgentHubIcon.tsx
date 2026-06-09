import {
  AlertTriangle,
  AtSign,
  Bell,
  Bot,
  CircleDot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Link,
  Maximize2,
  Clock3,
  Cloud,
  FileText,
  GitPullRequest,
  Grid2X2,
  Hash,
  Image,
  Menu,
  Mic,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  PlusCircle,
  PlayCircle,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Star,
  Sun,
  UserCircle,
  UserPlus,
  Users,
  Video,
  XCircle,
  X,
  type LucideIcon,
} from 'lucide-react-native';

export type AgentHubIconName =
  | 'account'
  | 'agent'
  | 'approval'
  | 'attachment'
  | 'at'
  | 'back'
  | 'bell'
  | 'browser'
  | 'call'
  | 'chat'
  | 'check'
  | 'chevronRight'
  | 'clock'
  | 'cloud'
  | 'danger'
  | 'diff'
  | 'expand'
  | 'file'
  | 'grid'
  | 'hash'
  | 'image'
  | 'info'
  | 'invite'
  | 'link'
  | 'menu'
  | 'mic'
  | 'more'
  | 'moon'
  | 'overview'
  | 'plus'
  | 'plusCircle'
  | 'runs'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'smile'
  | 'star'
  | 'status'
  | 'sun'
  | 'team'
  | 'video'
  | 'x';

const iconMap: Record<AgentHubIconName, LucideIcon> = {
  account: UserCircle,
  agent: Bot,
  approval: ShieldCheck,
  attachment: Paperclip,
  at: AtSign,
  back: ChevronLeft,
  bell: Bell,
  browser: Cloud,
  call: Phone,
  chat: MessageCircle,
  check: CheckCircle2,
  chevronRight: ChevronRight,
  clock: Clock3,
  cloud: Cloud,
  danger: XCircle,
  diff: GitPullRequest,
  expand: Maximize2,
  file: FileText,
  grid: Grid2X2,
  hash: Hash,
  image: Image,
  info: Info,
  invite: UserPlus,
  link: Link,
  menu: Menu,
  mic: Mic,
  more: MoreHorizontal,
  moon: Moon,
  overview: Grid2X2,
  plus: Plus,
  plusCircle: PlusCircle,
  runs: PlayCircle,
  search: Search,
  send: Send,
  settings: Settings,
  shield: ShieldCheck,
  smile: Smile,
  star: Star,
  status: CircleDot,
  sun: Sun,
  team: Users,
  video: Video,
  x: X,
};

interface AgentHubIconProps {
  name: AgentHubIconName;
  color: string;
  size?: number;
}

export function AgentHubIcon({ name, color, size = 18 }: AgentHubIconProps): React.ReactElement {
  const Icon = iconMap[name] ?? AlertTriangle;

  return <Icon color={color} size={size} strokeWidth={1.8} />;
}
