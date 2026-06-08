import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  GitPullRequest,
  MessageCircle,
  Moon,
  PlayCircle,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  UserCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';

export type AgentHubIconName =
  | 'account'
  | 'approval'
  | 'bell'
  | 'chat'
  | 'check'
  | 'chevronRight'
  | 'clock'
  | 'danger'
  | 'diff'
  | 'file'
  | 'moon'
  | 'runs'
  | 'search'
  | 'send'
  | 'settings'
  | 'sun';

const iconMap: Record<AgentHubIconName, LucideIcon> = {
  account: UserCircle,
  approval: ShieldCheck,
  bell: Bell,
  chat: MessageCircle,
  check: CheckCircle2,
  chevronRight: ChevronRight,
  clock: Clock3,
  danger: XCircle,
  diff: GitPullRequest,
  file: FileText,
  moon: Moon,
  runs: PlayCircle,
  search: Search,
  send: Send,
  settings: Settings,
  sun: Sun,
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
