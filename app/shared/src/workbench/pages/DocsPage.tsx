import React from 'react';
import styles from './DocsPage.module.css';
import {
  DEFAULT_SHORTCUTS,
  DocMain,
  DocsNav,
} from './docs';
import type { DocsPageProps } from './docs';

/* ═══════════════════════════════════════════════════════════════════════
   DocsPage — pure presentational workbench page

   Subcomponents / types extracted under ./docs:
   - Phase 19 #582: types, shared, DocsNav, DocTableViews
   - Phase 21 #605: DocMain residual shell thin
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
  shortcuts = DEFAULT_SHORTCUTS,
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
