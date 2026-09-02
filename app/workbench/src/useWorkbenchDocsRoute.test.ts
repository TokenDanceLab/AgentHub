// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocRow } from './pages';
import { WORKBENCH_MOCK_DOC_ROWS, WORKBENCH_MOCK_DOC_SHORTCUTS } from './mockData';
import { useWorkbenchDocsRoute } from './useWorkbenchDocsRoute';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchDocsRoute — nav/tab state, mock-row fallback, real-mode
   loading skeleton, preview open/close and action passthrough.

   The route has no pagination/loadMore surface; the load guard is the
   realDataMode + undefined-documents skeleton branch.
   ═══════════════════════════════════════════════════════════════════════ */

function docRow(id: string, title: string, overrides: Partial<DocRow> = {}): DocRow {
  return {
    id,
    title,
    location: '我的文档库',
    owner: 'demo-user',
    time: '今天 10:00',
    ...overrides,
  };
}

describe('useWorkbenchDocsRoute — defaults and demo-mode rows', () => {
  it('defaults to the home nav, recent tab and the mock doc rows without loading', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({}));

    expect(result.current.docsNav).toBe('home');
    expect(result.current.docsTab).toBe('recent');
    expect(result.current.rows).toEqual(WORKBENCH_MOCK_DOC_ROWS);
    expect(result.current.documentsLoading).toBe(false);
    expect(result.current.docsPreview).toBeNull();
    expect(result.current.documentsActions).toBeUndefined();
  });

  it('updates the nav and tab through their setters', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({}));

    act(() => {
      result.current.setDocsNav('archive');
    });
    expect(result.current.docsNav).toBe('archive');

    act(() => {
      result.current.setDocsTab('shared');
    });
    expect(result.current.docsTab).toBe('shared');
  });

  it('uses parent-supplied documents instead of the mock rows', () => {
    const supplied: DocRow[] = [docRow('d1', 'Custom Doc')];
    const { result } = renderHook(() => useWorkbenchDocsRoute({ documents: supplied }));

    expect(result.current.rows).toEqual(supplied);
    expect(result.current.documentsLoading).toBe(false);
  });

  it('passes documentsActions through unchanged', () => {
    const actions = {
      onCreateDoc: vi.fn(),
      onDeleteDoc: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() => useWorkbenchDocsRoute({ documentsActions: actions }));

    expect(result.current.documentsActions).toBe(actions);
  });
});

describe('useWorkbenchDocsRoute — preview open/close', () => {
  it('opens a preview built from a tagged doc row', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({}));
    const tagged = WORKBENCH_MOCK_DOC_ROWS[0];

    act(() => {
      if (tagged) result.current.openDocPreview(tagged);
    });

    const preview = result.current.docsPreview;
    expect(preview?.id).toBe('doc:desktop-design-system');
    // Title without an extension gets a `.md` filename.
    expect(preview?.name).toBe('AgentHub Desktop 设计系统对齐清单.md');
    expect(preview?.type).toBe('md');
    expect(preview?.owner).toBe('demo-user');
    expect(preview?.sourceLabel).toBe('我的文档库');
    expect(preview?.content).toContain('# AgentHub Desktop 设计系统对齐清单');
    expect(preview?.content).toContain('- 标签：内部');
  });

  it('keeps an existing file extension in the preview filename and marks untagged docs', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({}));
    const withExtension = WORKBENCH_MOCK_DOC_ROWS.find((row) => row.id === 'session-handoff');

    act(() => {
      if (withExtension) result.current.openDocPreview(withExtension);
    });

    const preview = result.current.docsPreview;
    expect(preview?.name).toBe('SESSION-HANDOFF-2026-06-05.md');
    expect(preview?.type).toBe('md');
    expect(preview?.content).toContain('- 标签：未标记');
    expect(preview?.content).toContain('# SESSION-HANDOFF-2026-06-05.md');
  });

  it('closes the preview', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({}));
    const tagged = WORKBENCH_MOCK_DOC_ROWS[0];

    act(() => {
      if (tagged) result.current.openDocPreview(tagged);
    });
    expect(result.current.docsPreview).not.toBeNull();

    act(() => {
      result.current.closeDocPreview();
    });
    expect(result.current.docsPreview).toBeNull();
  });
});

describe('useWorkbenchDocsRoute — real data mode', () => {
  it('shows a loading skeleton when real mode has no documents yet', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({ realDataMode: true }));

    expect(result.current.documentsLoading).toBe(true);
    expect(result.current.rows).toEqual([]);
  });

  it('stops loading once real-mode documents arrive', () => {
    const supplied: DocRow[] = [docRow('d1', 'Real Doc')];
    const { result } = renderHook(() => useWorkbenchDocsRoute({
      realDataMode: true,
      documents: supplied,
    }));

    expect(result.current.documentsLoading).toBe(false);
    expect(result.current.rows).toEqual(supplied);
    // #2154 P2-2(b): real data mode never injects the mock library shortcuts.
    expect(result.current.shortcuts).toEqual([]);
  });

  it('never loads in demo mode, even when documents is undefined', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({ realDataMode: false }));

    expect(result.current.documentsLoading).toBe(false);
    expect(result.current.rows).toEqual(WORKBENCH_MOCK_DOC_ROWS);
  });
});

describe('useWorkbenchDocsRoute — library shortcuts (#2154 P2-2b)', () => {
  it('surfaces the mock shortcut list only in demo mode', () => {
    const { result } = renderHook(() => useWorkbenchDocsRoute({ realDataMode: false }));

    expect(result.current.shortcuts).toEqual(WORKBENCH_MOCK_DOC_SHORTCUTS);
  });

  it('stays empty while real mode is loading or errored', () => {
    const { result: loading } = renderHook(() => useWorkbenchDocsRoute({ realDataMode: true }));
    expect(loading.current.shortcuts).toEqual([]);

    const { result: errored } = renderHook(() => useWorkbenchDocsRoute({
      documentsError: 'GET /documents 500',
    }));
    expect(errored.current.shortcuts).toEqual([]);
  });
});
