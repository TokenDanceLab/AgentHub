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
}

export interface WorkbenchDocsRoute {
  docsNav: string;
  setDocsNav: (nav: string) => void;
  docsTab: DocsPane;
  setDocsTab: (tab: DocsPane) => void;
  docsPreview: WorkbenchDocumentPreview | null;
  rows: DocRow[];
  openDocPreview: (doc: DocRow) => void;
  closeDocPreview: () => void;
  documentsActions: WorkbenchDocumentsActions | undefined;
}

export function useWorkbenchDocsRoute({
  documents,
  documentsActions,
}: UseWorkbenchDocsRouteOptions): WorkbenchDocsRoute {
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const [docsPreview, setDocsPreview] = useState<WorkbenchDocumentPreview | null>(null);
  const rows = documents ?? WORKBENCH_MOCK_DOC_ROWS;

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
    openDocPreview,
    closeDocPreview,
    documentsActions,
  };
}
