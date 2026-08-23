import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PreviewPort, RuntimeEvidenceContentRef } from '@shared/platform';
import type { FileDiff } from '@shared/types/chat';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import {
  DiffReviewPanel,
  type DiffHunkDecision,
  type DiffReviewFile,
} from '@shared/ui/DiffReviewPanel';
import { DocxPreview } from '@shared/ui/DocxPreview';
import { SlideshowPreview } from '@shared/ui/SlideshowPreview';
import { TablePreview } from '@shared/ui/TablePreview';
import { PREVIEW_SANDBOX_SRCDOC } from '@shared/ui/previewSandbox';
import { useToastStore } from '@shared/ui/toast/toastStore';
import { DesignFileIcon } from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import { FilePreview } from './FilePreview';
import { resolvePreviewContentUrl } from './FilePreviewHelpers';
import type { FileItem } from './OverviewPanel';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreviewRouter — Routes a PreviewFile to the right native or
   code viewer based on the filename extension.

   Routing table:
     interactiveDiff       -> InteractiveDiffPreview (accept/reject write-back
                              via PreviewPort; read-only notice on surfaces
                              without a Local Edge)
     .pptx                 -> SlideshowPreview
     .ppt                  -> SlideshowPreview (legacy kind)
     .xlsx / .xls / .csv   -> TablePreview
     .docx                 -> DocxPreview
     .pdf                  -> browser-native PDF iframe (needs a resolvable
                              content URL; honest notice otherwise)
     .html / .htm          -> sandboxed HTML iframe (srcDoc)
     .png/.jpg/...         -> image via evidence content URL (honest notice
                              when no resolvable URL exists)
     .txt / .log           -> plain <pre>
     everything else       -> FilePreview (code / diff / markdown)

   Interactive diff apply and content-URL resolution go through the platform
   `PreviewPort` (#1817): the shared package owns no Local Edge, so the
   renderer never hardcodes an Edge base URL. Desktop implements the port
   against Edge REST; Web omits apply (Hub-only boundary) and the router
   degrades to explicit read-only feedback instead of silent console errors.
   ═══════════════════════════════════════════════════════════════════════ */

export type PreviewFile = FileItem & {
  content?: string | undefined;
  diffContent?: string | undefined;
  owner?: string | undefined;
  /**
   * Structured ref to host-owned runtime-evidence content (artifact file or
   * preview). Resolved via `PreviewPort.resolveRuntimeEvidenceContent`;
   * shared code never constructs host REST paths itself (#1817).
   */
  contentRef?: RuntimeEvidenceContentRef | undefined;
  /** When present, this is an interactive diff from a run — enables accept/reject with Edge apply. */
  interactiveDiff?:
    | {
        runId: string;
        fileDiff: FileDiff;
        workDir: string;
      }
    | undefined;
};

export interface FilePreviewRouterProps {
  file: PreviewFile;
  onClose: () => void;
  /**
   * Platform preview port for capabilities the shared package cannot own:
   * diff hunk write-back (Edge apply) and evidence content-URL resolution.
   * Optional so fixture/demo shells keep rendering; absent capabilities
   * degrade to explicit user-facing notices.
   */
  previewPort?: PreviewPort | undefined;
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
 *  Overview mappers put full preview URLs into `content`; structured
 *  runtime-evidence refs are carried by `contentRef` instead (#1817). */
function extractFileUrl(content: string | undefined): string {
  if (!content) return '';
  // Real URLs start with '/' (relative API path) or 'http'
  if (content.startsWith('/') || content.startsWith('http://') || content.startsWith('https://')) {
    return content;
  }
  return '';
}

/** Interactive diff preview with hunk accept/reject that writes back to the workdir via the platform PreviewPort. */
function InteractiveDiffPreview({
  file,
  onClose,
  previewPort,
}: {
  file: PreviewFile;
  onClose: () => void;
  previewPort?: PreviewPort | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const interactiveDiff = file.interactiveDiff;
  const showToast = useToastStore((state) => state.showToast);
  const applySupported = Boolean(previewPort?.applyRunDiff && previewPort?.applyAllRunDiffs);

  // Hooks run unconditionally so the hook order is stable if a file toggles
  // between interactive and non-interactive diff states across renders.
  const reviewFiles: DiffReviewFile[] = useMemo(() => {
    if (!interactiveDiff) return [];
    const { fileDiff } = interactiveDiff;
    return [
      {
        filePath: fileDiff.filePath,
        status: fileDiff.status === 'untracked' ? 'added' : fileDiff.status,
        additions: fileDiff.additions,
        deletions: fileDiff.deletions,
        hunks: fileDiff.hunks as unknown as DiffReviewFile['hunks'],
      },
    ];
  }, [interactiveDiff]);

  const handleApplyHunk = useCallback(
    async (decision: DiffHunkDecision) => {
      if (!interactiveDiff) return;
      if (!previewPort?.applyRunDiff) {
        showToast('warning', t('diffReview.applyUnsupported'));
        return;
      }
      try {
        await previewPort.applyRunDiff({
          runId: interactiveDiff.runId,
          workDir: interactiveDiff.workDir,
          decision: {
            filePath: decision.filePath,
            hunkIndex: decision.hunkIndex,
            accepted: decision.accepted,
          },
        });
        showToast(
          'success',
          t(decision.accepted ? 'diffReview.hunkApplied' : 'diffReview.hunkRejected', {
            file: decision.filePath,
            index: decision.hunkIndex + 1,
          })
        );
      } catch (err) {
        console.error('[FilePreviewRouter] apply hunk failed:', err);
        showToast('error', t('diffReview.applyFailed'));
      }
    },
    [interactiveDiff, previewPort, showToast, t]
  );

  const handleApplyAllHunks = useCallback(
    async (decisions: DiffHunkDecision[]) => {
      if (!interactiveDiff) return;
      if (!previewPort?.applyAllRunDiffs) {
        showToast('warning', t('diffReview.applyUnsupported'));
        return;
      }
      try {
        await previewPort.applyAllRunDiffs({
          runId: interactiveDiff.runId,
          workDir: interactiveDiff.workDir,
          decisions: decisions.map((item) => ({
            filePath: item.filePath,
            hunkIndex: item.hunkIndex,
            accepted: item.accepted,
          })),
        });
        const acceptedCount = decisions.filter((item) => item.accepted).length;
        showToast(
          'success',
          t('diffReview.applyAllSuccess', {
            total: decisions.length,
            applied: acceptedCount,
            rejected: decisions.length - acceptedCount,
          })
        );
      } catch (err) {
        console.error('[FilePreviewRouter] bulk apply diff failed:', err);
        showToast('error', t('diffReview.applyAllFailed'));
      }
    },
    [interactiveDiff, previewPort, showToast, t]
  );

  if (!interactiveDiff) return <></>;
  const { runId, fileDiff } = interactiveDiff;

  return (
    <div className={styles.filePreview}>
      <div className={styles.filePreviewHeader}>
        <button className={styles.filePreviewClose} onClick={onClose} type="button">
          {'<'} {t('diffReview.back')}
        </button>
        <span className={styles.filePreviewTitle}>{fileDiff.filePath}</span>
      </div>
      {!applySupported && (
        <div
          role="note"
          style={{
            padding: '8px 12px',
            font: '400 0.75rem/1.5 var(--td-font)',
            color: 'var(--td-ink-muted)',
            background: 'var(--td-surface)',
            borderBottom: '1px solid var(--td-border-hairline)',
          }}
        >
          {t('diffReview.applyUnsupported')}
        </div>
      )}
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
  previewPort,
}: FilePreviewRouterProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // Interactive diff review with accept/reject write-back
  if (file.interactiveDiff) {
    return <InteractiveDiffPreview file={file} onClose={onClose} previewPort={previewPort} />;
  }

  const kind = detectFilePreviewKind(file.name);
  const content = file.content ?? `${file.name}\n\n${t('filePreview.noContent')}`;
  // Structured runtime-evidence refs resolve through the host port; plain
  // content refs keep the generic string resolution path (#1817).
  const contentUrl = file.contentRef
    ? previewPort?.resolveRuntimeEvidenceContent?.(file.contentRef)
    : resolvePreviewContentUrl(file.content, previewPort);
  // Office viewers accept any direct URL in `content`, and fall back to the
  // port-resolved URL (Desktop) instead of a broken host-relative fetch.
  const fileUrl = extractFileUrl(file.content) || contentUrl || '';

  switch (kind) {
    case 'pptx':
    case 'pptx-legacy':
      return <SlideshowPreview fileName={file.name} fileUrl={fileUrl} onClose={onClose} />;

    case 'xlsx':
    case 'xls':
    case 'csv':
      return <TablePreview fileName={file.name} fileUrl={fileUrl} onClose={onClose} />;

    case 'docx':
      return <DocxPreview fileName={file.name} fileUrl={fileUrl} onClose={onClose} />;

    case 'pdf':
      return <NativePdfPreview contentUrl={contentUrl} filename={file.name} />;

    case 'html':
      return <NativeHtmlPreview content={content} />;

    case 'image':
      return <NativeImagePreview contentUrl={contentUrl} filename={file.name} />;

    case 'text':
      return <NativeTextPreview content={content} />;

    default:
      return (
        <FilePreview
          filename={file.name}
          owner={file.owner}
          language={file.type}
          content={file.content ?? `${file.name}\n\n${t('filePreview.noContent')}`}
          diffContent={file.diffContent}
          onClose={onClose}
        />
      );
  }
}

/* ═══ Native File Previews (zero extra libraries) ═══ */

function NativePreviewFallback({
  detail,
  filename,
  title,
}: {
  detail: string;
  filename: string;
  title: string;
}): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflow: 'auto',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          color: 'var(--td-ink-subtle)',
          font: '400 0.75rem var(--td-font)',
          textAlign: 'center',
        }}
      >
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span>{title}</span>
        <span style={{ fontSize: '0.6875rem' }}>{detail}</span>
      </div>
    </div>
  );
}

function NativePdfPreview({
  contentUrl,
  filename,
}: {
  contentUrl?: string | undefined;
  filename: string;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (!contentUrl) {
    return (
      <NativePreviewFallback
        detail={t('filePreview.pdfNoUrl')}
        filename={filename}
        title={t('filePreview.pdfTitle', { filename })}
      />
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <iframe
        title={t('filePreview.pdfTitle', { filename })}
        src={contentUrl}
        style={{ flex: 1, border: 0, minHeight: 0 }}
        role="document"
      />
    </div>
  );
}

function NativeHtmlPreview({ content }: { content: string }): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <iframe
      title={t('filePreview.htmlTitle')}
      style={{ flex: 1, border: 0, minHeight: 0, width: '100%' }}
      srcDoc={content}
      sandbox={PREVIEW_SANDBOX_SRCDOC}
      role="document"
    />
  );
}

function NativeImagePreview({
  contentUrl,
  filename,
}: {
  contentUrl?: string | undefined;
  filename: string;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [loadFailed, setLoadFailed] = useState(false);

  if (!contentUrl) {
    return (
      <NativePreviewFallback
        detail={t('filePreview.imageNoUrl')}
        filename={filename}
        title={t('filePreview.imageTitle', { filename })}
      />
    );
  }

  if (loadFailed) {
    return (
      <NativePreviewFallback
        detail={t('filePreview.imageLoadFailed')}
        filename={filename}
        title={t('filePreview.imageTitle', { filename })}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflow: 'auto',
        minHeight: 0,
      }}
    >
      <img
        src={contentUrl}
        alt={filename}
        onError={() => setLoadFailed(true)}
        style={{ maxWidth: '100%', height: 'auto', objectFit: 'contain' }}
      />
    </div>
  );
}

function NativeTextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <pre
      style={{
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
      }}
    >
      {content}
    </pre>
  );
}
