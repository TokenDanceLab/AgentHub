import React, { useCallback, useMemo } from 'react';
import { parseError } from '../../errors';
import type { FileDiff } from '../../types/chat';
import { DiffReviewPanel, type DiffHunkDecision, type DiffReviewFile } from '../../ui/DiffReviewPanel';
import { DocxPreview } from '../../ui/DocxPreview';
import { SlideshowPreview } from '../../ui/SlideshowPreview';
import { TablePreview } from '../../ui/TablePreview';
import { PREVIEW_SANDBOX_SRCDOC } from '../../ui/previewSandbox';
import { DesignFileIcon } from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import { FilePreview } from './FilePreview';
import type { FileItem } from './OverviewPanel';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreviewRouter — Routes a PreviewFile to the right native or
   code viewer based on the filename extension.

   Routing table:
     interactiveDiff       -> InteractiveDiffPreview (accept/reject write-back)
     .pptx                 -> SlideshowPreview
     .ppt                  -> SlideshowPreview (legacy kind)
     .xlsx / .xls / .csv   -> TablePreview
     .docx                 -> DocxPreview
     .pdf                  -> browser-native PDF iframe
     .html / .htm          -> sandboxed HTML iframe (srcDoc)
     .png/.jpg/...         -> image placeholder (URL-loaded later)
     .txt / .log           -> plain <pre>
     everything else       -> FilePreview (code / diff / markdown)
   ═══════════════════════════════════════════════════════════════════════ */

export type PreviewFile = FileItem & {
  content?: string | undefined;
  diffContent?: string | undefined;
  owner?: string | undefined;
  /** When present, this is an interactive diff from a run — enables accept/reject with Edge apply. */
  interactiveDiff?: {
    runId: string;
    fileDiff: FileDiff;
    workDir: string;
  } | undefined;
};

export interface FilePreviewRouterProps {
  file: PreviewFile;
  onClose: () => void;
}

type FilePreviewKind =
  | 'code'
  | 'pptx'
  | 'pptx-legacy'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'docx'
  | 'pdf'
  | 'html'
  | 'image'
  | 'text';

function detectFilePreviewKind(fileName: string): FilePreviewKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.ppt')) return 'pptx-legacy';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/.test(lower)) return 'image';
  if (/\.(txt|log)$/.test(lower)) return 'text';
  return 'code';
}

/** Extract a fetchable URL from a PreviewFile's content field.
 *  runtimeEvidenceOverviewFiles puts real Edge API paths (e.g. /v1/runs/…/content)
 *  or full preview URLs into `content`; fallback text starts with `#` or prose. */
function extractFileUrl(content: string | undefined): string {
  if (!content) return '';
  // Real URLs start with '/' (relative API path) or 'http'
  if (content.startsWith('/') || content.startsWith('http://') || content.startsWith('https://')) {
    return content;
  }
  return '';
}

/** Replaces the now-deleted shared Edge REST client apply fns (RFC A-V3 §4.1 —
 *  zero external consumers, stored in shared/src as dead surface).  edgeBaseUrl is unconfigured here
 *  because the shared package has no Local Edge; Desktop drives the Edge
 *  connection through its own wrappers.  InteractiveDiffPreview was already
 *  a known defect per verify-shared-boundary.py (audit-A P → PreviewPort). */
const edgeBaseUrl = '';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!edgeBaseUrl) {
    throw new Error('Edge base URL not configured — route through PreviewPort instead');
  }
  const res = await fetch(`${edgeBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return res.json() as Promise<T>;
}

async function applyRunDiff(
  runId: string,
  body: { file_path: string; hunk_index: number; accepted: boolean; workDir: string },
): Promise<{ code: string; data: unknown }> {
  return postJson(`/v1/runs/${encodeURIComponent(runId)}/apply`, body);
}

async function applyAllRunDiffs(
  runId: string,
  body: { decisions: Array<{ file_path: string; hunk_index: number; accepted: boolean }>; workDir: string },
): Promise<{ code: string; data: unknown }> {
  return postJson(`/v1/runs/${encodeURIComponent(runId)}/apply-all`, body);
}

/** Interactive diff preview with hunk accept/reject that writes back to the workdir via Edge API. */
function InteractiveDiffPreview({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}): React.ReactElement {
  const interactiveDiff = file.interactiveDiff;

  // Hooks run unconditionally so the hook order is stable if a file toggles
  // between interactive and non-interactive diff states across renders.
  const reviewFiles: DiffReviewFile[] = useMemo(() => {
    if (!interactiveDiff) return [];
    const { fileDiff } = interactiveDiff;
    return [{
      filePath: fileDiff.filePath,
      status: fileDiff.status === 'untracked' ? 'added' : fileDiff.status,
      additions: fileDiff.additions,
      deletions: fileDiff.deletions,
      hunks: fileDiff.hunks as unknown as DiffReviewFile['hunks'],
    }];
  }, [interactiveDiff]);

  const handleApplyHunk = useCallback(
    async (decision: DiffHunkDecision) => {
      if (!interactiveDiff) return;
      try {
        await applyRunDiff(interactiveDiff.runId, {
          file_path: decision.filePath,
          hunk_index: decision.hunkIndex,
          accepted: decision.accepted,
          workDir: interactiveDiff.workDir,
        });
      } catch (err) {
        console.error('RightInspector: applyRunDiff failed for hunk:', decision.filePath, decision.hunkIndex, err);
      }
    },
    [interactiveDiff],
  );

  const handleApplyAllHunks = useCallback(
    async (decisions: DiffHunkDecision[]) => {
      if (!interactiveDiff) return;
      try {
        await applyAllRunDiffs(interactiveDiff.runId, {
          decisions: decisions.map((d) => ({
            file_path: d.filePath,
            hunk_index: d.hunkIndex,
            accepted: d.accepted,
          })),
          workDir: interactiveDiff.workDir,
        });
      } catch (err) {
        console.error('RightInspector: applyAllRunDiffs failed:', decisions.length, 'hunks,', err);
      }
    },
    [interactiveDiff],
  );

  if (!interactiveDiff) return (<></>);
  const { runId, fileDiff } = interactiveDiff;

  return (
    <div className={styles.filePreview}>
      <div className={styles.filePreviewHeader}>
        <button className={styles.filePreviewClose} onClick={onClose} type="button">
          {'<'} 返回
        </button>
        <span className={styles.filePreviewTitle}>{fileDiff.filePath}</span>
      </div>
      <DiffReviewPanel
        files={reviewFiles}
        runId={runId}
        onApplyHunk={handleApplyHunk}
        onApplyAllHunks={handleApplyAllHunks}
      />
    </div>
  );
}

export function FilePreviewRouter({
  file,
  onClose,
}: FilePreviewRouterProps): React.ReactElement {
  // Interactive diff review with accept/reject write-back
  if (file.interactiveDiff) {
    return (
      <InteractiveDiffPreview
        file={file}
        onClose={onClose}
      />
    );
  }

  const kind = detectFilePreviewKind(file.name);
  const content = file.content ?? `${file.name}\n\n暂无文件内容。`;
  const fileUrl = extractFileUrl(file.content);

  switch (kind) {
    case 'pptx':
    case 'pptx-legacy':
      return (
        <SlideshowPreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'xlsx':
    case 'xls':
    case 'csv':
      return (
        <TablePreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'docx':
      return (
        <DocxPreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'pdf':
      return <NativePdfPreview filename={file.name} />;

    case 'html':
      return <NativeHtmlPreview content={content} />;

    case 'image':
      return <NativeImagePreview filename={file.name} />;

    case 'text':
      return <NativeTextPreview content={content} />;

    default:
      return (
        <FilePreview
          filename={file.name}
          owner={file.owner}
          language={file.type}
          content={file.content ?? `${file.name}\n\n暂无文件内容。`}
          diffContent={file.diffContent}
          onClose={onClose}
        />
      );
  }
}

/* ═══ Native File Previews (zero extra libraries) ═══ */

function NativePdfPreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <iframe
        title={`PDF 预览 ${filename}`}
        style={{ flex: 1, border: 0, minHeight: 0 }}
        role="document"
      />
    </div>
  );
}

function NativeHtmlPreview({ content }: { content: string }): React.ReactElement {
  return (
    <iframe
      title="HTML 预览"
      style={{ flex: 1, border: 0, minHeight: 0, width: '100%' }}
      srcDoc={content}
      sandbox={PREVIEW_SANDBOX_SRCDOC}
      role="document"
    />
  );
}

function NativeImagePreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
      minHeight: 0,
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        color: 'var(--td-ink-subtle)',
        font: '400 0.75rem var(--td-font)',
      }}>
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span>图片预览: {filename}</span>
        <span style={{ fontSize: '0.6875rem' }}>图片内容将通过文件 URL 加载</span>
      </div>
    </div>
  );
}

function NativeTextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <pre style={{
      flex: 1,
      margin: 0,
      padding: 16,
      overflow: 'auto',
      font: '400 0.8125rem/1.6 var(--td-mono)',
      color: 'var(--td-ink-muted)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: 'var(--td-surface)',
      minHeight: 0,
    }}>
      {content}
    </pre>
  );
}
