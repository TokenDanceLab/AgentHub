import React from 'react';
import styles from './DocsPage.module.css';
import {
  DocMain,
  DocsNav,
} from './docs';
import type { DocsPageProps } from './docs';

/* ═══════════════════════════════════════════════════════════════════════
   DocsPage — pure presentational workbench page

   Subcomponents / types extracted under ./docs:
   - Types, shared helpers, DocsNav, DocTableViews (#582).
   - DocMain shell (#605).
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  DocRow,
  DocsPane,
  DocsPageNavItem,
  DocsPageProps,
} from './docs';

// ── Main component ──

export function DocsPage({
  activeNav,
  onNavChange,
  searchQuery = '',
  onSearchChange,
  navItems,
  // No default injection: an absent/empty list renders no
  // shortcut block. Demo mode passes WORKBENCH_MOCK_DOC_SHORTCUTS explicitly.
  shortcuts = [],
  activeTab,
  onTabChange,
  rows,
  documentsLoading,
  profiles,
  activePreview,
  onDocClick,
  onClosePreview,
  onCreateDoc,
  onUploadDoc,
  onTemplateLibrary,
  onSettings,
  onPlusTab,
  onShortcutClick,
  onDeleteDoc,
}: DocsPageProps): React.ReactElement {
  return (
    <section className={`${styles.page} workbench docs-page`}>
      <DocsNav
        activeNav={activeNav}
        onNavChange={onNavChange}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        navItems={navItems}
        shortcuts={shortcuts}
        onShortcutClick={onShortcutClick}
      />
      <DocMain
        activeTab={activeTab}
        onTabChange={onTabChange}
        rows={rows}
        documentsLoading={documentsLoading ?? false}
        profiles={profiles}
        activePreview={activePreview}
        onDocClick={onDocClick}
        onClosePreview={onClosePreview}
        onCreateDoc={onCreateDoc}
        onUploadDoc={onUploadDoc}
        onTemplateLibrary={onTemplateLibrary}
        onSettings={onSettings}
        onPlusTab={onPlusTab}
        onDeleteDoc={onDeleteDoc}
      />
    </section>
  );
}
