/* ═══════════════════════════════════════════════════════════════════════
   Docs page public types — extracted for Phase 19 strangler slice #582.
   ═══════════════════════════════════════════════════════════════════════ */

import type { DesignNavIconName } from '../../designIcons';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { WorkbenchProfileSource } from '../../profileRegistry';

export interface DocRow {
  id: string;
  title: string;
  /** Optional tag badge (e.g. '内部', '共享', '外部') */
  tag?: string;
  location: string;
  owner: string;
  time: string;
}

export type DocsPane = 'recent' | 'owned' | 'shared' | 'starred';

export interface DocsPageNavItem {
  id: string;
  label: string;
  icon?: DesignNavIconName;
  /** Optional small text (e.g. '下载中...') */
  trailing?: string;
}

export interface DocsPageProps {
  /** Currently active nav item id */
  activeNav: string;
  /** Called when user clicks a nav item */
  onNavChange: (navId: string) => void;

  /** Search query */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Nav items rendered in the left sidebar */
  navItems: DocsPageNavItem[];

  /** Doc shortcuts shown under "我的文档库" caption */
  shortcuts?: string[];

  /** Doc tab pane */
  activeTab: DocsPane;
  /** Called when user switches tab */
  onTabChange?: ((tab: DocsPane) => void) | undefined;

  /** Doc table rows */
  rows: DocRow[];
  /** True while real-mode documents are still loading (undefined → skeleton).
   *  Demo mode is never loading — mock rows render immediately. */
  documentsLoading?: boolean;
  /** Agent/user profiles available for owner avatar resolution */
  profiles?: WorkbenchProfileSource[] | undefined;
  /** Currently selected document preview */
  activePreview?: WorkbenchDocumentPreview | null | undefined;

  /** Called when a doc row is clicked */
  onDocClick?: ((doc: DocRow) => void) | undefined;
  /** Called when document preview closes */
  onClosePreview?: (() => void) | undefined;

  /** Callbacks for action buttons */
  onCreateDoc?: (() => void) | undefined;
  onUploadDoc?: (() => void) | undefined;
  onTemplateLibrary?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onPlusTab?: (() => void) | undefined;
  /** Called when a shortcut is clicked */
  onShortcutClick?: ((name: string) => void) | undefined;
  /** Called to delete a document */
  onDeleteDoc?: ((documentId: string) => Promise<unknown> | void) | undefined;
}
