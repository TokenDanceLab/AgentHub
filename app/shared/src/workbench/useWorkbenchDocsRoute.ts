import { useState } from 'react';
import type { DocRow, DocsPane } from './pages';
import type { WorkbenchDocumentPreview } from './documentPreview';
import { WORKBENCH_MOCK_DOC_ROWS } from './mockData';
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
}

export interface WorkbenchDocsRoute {
  docsNav: string;
  setDocsNav: (nav: string) => void;
  docsTab: DocsPane;
  setDocsTab: (tab: DocsPane) => void;
  docsPreview: WorkbenchDocumentPreview | null;
  rows: DocRow[];
  /** True while real-mode documents are loading (undefined input). */
  documentsLoading: boolean;
  openDocPreview: (doc: DocRow) => void;
  closeDocPreview: () => void;
  documentsActions: WorkbenchDocumentsActions | undefined;
}

export function useWorkbenchDocsRoute({
  documents,
  documentsActions,
  realDataMode,
}: UseWorkbenchDocsRouteOptions): WorkbenchDocsRoute {
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const [docsPreview, setDocsPreview] = useState<WorkbenchDocumentPreview | null>(null);
  // Real mode while the Hub list is still undefined = loading; demo mode
  // (realDataMode false) keeps the mock-row fallback so demo content renders.
  const documentsLoading = Boolean(realDataMode && documents === undefined);
  const rows = documents ?? (documentsLoading ? [] : WORKBENCH_MOCK_DOC_ROWS);

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
    documentsLoading,
    openDocPreview,
    closeDocPreview,
    documentsActions,
  };
}
