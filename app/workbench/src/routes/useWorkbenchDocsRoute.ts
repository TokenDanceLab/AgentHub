import { useState } from 'react';
import type { DocRow, DocsPane } from '../pages/index';
import type { WorkbenchDocumentPreview } from '../documentPreview';
import { WORKBENCH_MOCK_DOC_ROWS, WORKBENCH_MOCK_DOC_SHORTCUTS } from '../mockData';
import { createDocPreview } from './workbenchDocPreview';

/** Document mutation callbacks wired to Hub Documents API. */
export interface WorkbenchDocumentsActions {
  onCreateDoc?: (() => Promise<unknown> | void) | undefined;
  onUpdateDoc?: ((documentId: string, data: Record<string, unknown>) => Promise<unknown> | void) | undefined;
  onDeleteDoc?: ((documentId: string) => Promise<unknown> | void) | undefined;
}

export interface UseWorkbenchDocsRouteOptions {
  documents?: DocRow[] | undefined;
  documentsActions?: WorkbenchDocumentsActions | undefined;
  /** True when the owning app is in real (non-demo) data mode. When real and
   *  `documents` is undefined, the docs list is still loading — show a
   *  skeleton instead of falling back to mock rows. */
  realDataMode?: boolean | undefined;
  /**
   * Error message when the Hub documents request failed. Optional —
   * shells pass it through so the docs route can distinguish error from
   * loading/empty instead of collapsing into an empty list.
   */
  documentsError?: string | undefined;
}

export interface WorkbenchDocsRoute {
  docsNav: string;
  setDocsNav: (nav: string) => void;
  docsTab: DocsPane;
  setDocsTab: (tab: DocsPane) => void;
  docsPreview: WorkbenchDocumentPreview | null;
  rows: DocRow[];
  /**
   * Shortcut names for the docs.myLibrary nav section. Demo mode only; real
   * data mode is always empty and renders no shortcut block.
   */
  shortcuts: string[];
  /** True while real-mode documents are loading (undefined input). */
  documentsLoading: boolean;
  /** Present when the Hub documents request failed. */
  documentsError: string | undefined;
  openDocPreview: (doc: DocRow) => void;
  closeDocPreview: () => void;
  documentsActions: WorkbenchDocumentsActions | undefined;
}

export function useWorkbenchDocsRoute({
  documents,
  documentsActions,
  realDataMode,
  documentsError,
}: UseWorkbenchDocsRouteOptions): WorkbenchDocsRoute {
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const [docsPreview, setDocsPreview] = useState<WorkbenchDocumentPreview | null>(null);
  // Real mode while the Hub list is still undefined = loading; demo mode
  // (realDataMode false) keeps the mock-row fallback so demo content renders.
  const documentsLoading = Boolean(realDataMode && documents === undefined && !documentsError);
  // An errored request renders neither mock rows nor a skeleton so the page
  // can show its error state.
  const rows = documents ?? (documentsLoading || documentsError ? [] : WORKBENCH_MOCK_DOC_ROWS);
  // Shortcuts come from the mock data source, never from a page-level default.
  // Real data mode (and loading/error) renders none.
  const shortcuts = realDataMode || documentsLoading || documentsError
    ? []
    : WORKBENCH_MOCK_DOC_SHORTCUTS;

  function openDocPreview(doc: DocRow): void {
    setDocsPreview(createDocPreview(doc));
  }

  function closeDocPreview(): void {
    setDocsPreview(null);
  }

  return {
    docsNav,
    setDocsNav,
    docsTab,
    setDocsTab,
    docsPreview,
    rows,
    shortcuts,
    documentsLoading,
    documentsError,
    openDocPreview,
    closeDocPreview,
    documentsActions,
  };
}
