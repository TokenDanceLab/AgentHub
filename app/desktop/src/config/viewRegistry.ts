import { lazy, type ComponentType } from 'react';
import { MessageSquare, Bot, PanelRight, Search, Keyboard, Shield, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Slot in the layout shell that views can occupy. */
export type ViewSlot = 'sidebar' | 'centerSidebar' | 'center' | 'rightPanel' | 'agentOverlay' | 'modal';

/**
 * Standardized props that every registered view component can receive.
 * Views destructure only what they need; unused props are harmlessly passed through.
 */
export interface ViewProps {
  online: boolean;
  isConnected: boolean;
  isStreaming: boolean;
  isMobile: boolean;
  isTablet: boolean;
  [key: string]: unknown;
}

/** Metadata for a single view in the registry. */
export interface ViewConfig {
  /** Unique identifier; doubles as route key or slot selector. */
  id: string;
  /** The React component that renders this view. */
  component: ComponentType<any>;
  /** Which layout zone this view occupies. */
  slot: ViewSlot;
  /** Visible on mobile (< 768px). */
  showOnMobile: boolean;
  /** Visible on tablet (768px – 1023px). */
  showOnTablet: boolean;
  /** Icon for toolbar buttons / navigation. */
  icon: LucideIcon;
  /** i18n key for human-readable label. */
  label: string;
  /** Whether the component is lazy-loaded (code-split). */
  lazy?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════

// Lazy imports
const ChatView = lazy(() => import('@/components/ChatView'));
const RunDetail = lazy(() => import('@/components/RunDetail'));
const SearchDialog = lazy(() => import('@/components/SearchDialog'));
const IMView = lazy(() => import('@/views/IMView'));

// Eager imports
import StatusBar from '@/components/StatusBar';
import ThreadPanel from '@/components/ThreadPanel';
import AgentList from '@/components/AgentList';
import MainView from '@/views/MainView';
import PromptInput from '@/components/PromptInput';
import PermissionDialog from '@/components/PermissionDialog';
import ShortcutHelp from '@/components/ShortcutHelp';

/** Master view registry — add new views here. */
export const VIEW_REGISTRY: Record<string, ViewConfig> = {
  'status-bar': {
    id: 'status-bar',
    component: StatusBar,
    slot: 'shell' as ViewSlot,
    showOnMobile: true,
    showOnTablet: true,
    icon: Shield,
    label: 'view.statusBar',
  },
  'thread-panel': {
    id: 'thread-panel',
    component: ThreadPanel,
    slot: 'sidebar',
    showOnMobile: true,
    showOnTablet: true,
    icon: MessageSquare,
    label: 'view.threads',
  },
  'agent-list': {
    id: 'agent-list',
    component: AgentList,
    slot: 'centerSidebar',
    showOnMobile: false,
    showOnTablet: true,
    icon: Bot,
    label: 'view.agents',
  },
  'main-view': {
    id: 'main-view',
    component: MainView,
    slot: 'center',
    showOnMobile: true,
    showOnTablet: true,
    icon: MessageSquare,
    label: 'view.chat',
  },
  'prompt-input': {
    id: 'prompt-input',
    component: PromptInput,
    slot: 'shell' as ViewSlot,
    showOnMobile: true,
    showOnTablet: true,
    icon: MessageSquare,
    label: 'view.prompt',
  },
  'permission-dialog': {
    id: 'permission-dialog',
    component: PermissionDialog,
    slot: 'modal',
    showOnMobile: true,
    showOnTablet: true,
    icon: Shield,
    label: 'view.permissions',
  },
  'shortcut-help': {
    id: 'shortcut-help',
    component: ShortcutHelp,
    slot: 'modal',
    showOnMobile: true,
    showOnTablet: true,
    icon: Keyboard,
    label: 'view.shortcuts',
  },
  'run-detail': {
    id: 'run-detail',
    component: RunDetail,
    slot: 'rightPanel',
    showOnMobile: true,
    showOnTablet: true,
    icon: PanelRight,
    label: 'view.runDetail',
    lazy: true,
  },
  'search-dialog': {
    id: 'search-dialog',
    component: SearchDialog,
    slot: 'modal',
    showOnMobile: true,
    showOnTablet: true,
    icon: Search,
    label: 'view.search',
    lazy: true,
  },
  'im-view': {
    id: 'im-view',
    component: IMView,
    slot: 'center',
    showOnMobile: true,
    showOnTablet: true,
    icon: Users,
    label: 'view.messages',
    lazy: true,
  },
};

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Return all view configs assigned to a given layout slot. */
export function getViewsForSlot(slot: ViewSlot): ViewConfig[] {
  return Object.values(VIEW_REGISTRY).filter((v) => v.slot === slot);
}

/** Get a single view config by id (throws if not found). */
export function getView(id: string): ViewConfig {
  const v = VIEW_REGISTRY[id];
  if (!v) throw new Error(`[viewRegistry] Unknown view: "${id}"`);
  return v;
}

/**
 * Check whether a view should be visible at the current breakpoints.
 * Desktop always shows all views.
 */
export function isViewVisible(
  view: ViewConfig,
  isMobile: boolean,
  isTablet: boolean,
): boolean {
  if (isMobile) return view.showOnMobile;
  if (isTablet) return view.showOnTablet;
  return true;
}

/** Flat list of all registered views (for iteration / tab generation). */
export const VIEW_LIST: ViewConfig[] = Object.values(VIEW_REGISTRY);

// ── Main content view mode (used by MainView resolution) ──

export type ViewMode = 'welcome' | 'loading' | 'chat' | 'im';

export interface ViewDescriptor {
  mode: ViewMode;
  label: string;
}

export const VIEWS: Record<ViewMode, ViewDescriptor> = {
  welcome: { mode: 'welcome', label: 'Welcome' },
  loading: { mode: 'loading', label: 'Loading' },
  chat: { mode: 'chat', label: 'Chat' },
  im: { mode: 'im', label: 'Messages' },
};
