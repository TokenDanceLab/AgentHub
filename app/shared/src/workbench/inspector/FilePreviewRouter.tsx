import React, { useCallback, useMemo, useState } from 'react';
import type { PreviewPort } from '../../platform';
import type { FileDiff } from '../../types/chat';
import { DiffReviewPanel, type DiffHunkDecision, type DiffReviewFile } from '../../ui/DiffReviewPanel';
import { DocxPreview } from '../../ui/DocxPreview';
import { SlideshowPreview } from '../../ui/SlideshowPreview';
import { TablePreview } from '../../ui/TablePreview';
import { PREVIEW_SANDBOX_SRCDOC } from '../../ui/previewSandbox';
import { useToastStore } from '../../ui/toast/toastStore';
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

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const APPLY_UNSUPPORTED_NOTE = '当前端不支持将 diff 写回工作区（仅桌面本地 Edge 支持），当前为只读评审。';

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
  const interactiveDiff = file.interactiveDiff;
  const showToast = useToastStore((state) => state.showToast);
  const applySupported = Boolean(previewPort?.applyRunDiff && previewPort?.applyAllRunDiffs);

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
      if (!previewPort?.applyRunDiff) {
        showToast('warning', APPLY_UNSUPPORTED_NOTE);
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
          decision.accepted
            ? `已应用 hunk：${decision.filePath} #${decision.hunkIndex + 1}`
            : `已拒绝 hunk：${decision.filePath} #${decision.hunkIndex + 1}`,
        );
      } catch (err) {
        showToast('error', `Diff 应用失败：${describeError(err)}`);
      }
    },
    [interactiveDiff, previewPort, showToast],
  );

  const handleApplyAllHunks = useCallback(
    async (decisions: DiffHunkDecision[]) => {
      if (!interactiveDiff) return;
      if (!previewPort?.applyAllRunDiffs) {
        showToast('warning', APPLY_UNSUPPORTED_NOTE);
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
          `已批量处理 ${decisions.length} 个 hunk（应用 ${acceptedCount}，拒绝 ${decisions.length - acceptedCount}）`,
        );
      } catch (err) {
        showToast('error', `Diff 批量应用失败：${describeError(err)}`);
      }
    },
    [interactiveDiff, previewPort, showToast],
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
          {APPLY_UNSUPPORTED_NOTE}
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
  // Interactive diff review with accept/reject write-back
  if (file.interactiveDiff) {
    return (
      <InteractiveDiffPreview
        file={file}
        onClose={onClose}
        previewPort={previewPort}
      />
    );
  }

  const kind = detectFilePreviewKind(file.name);
  const content = file.content ?? `${file.name}\n\n暂无文件内容。`;
  const fileUrl = extractFileUrl(file.content);
  const contentUrl = resolvePreviewContentUrl(file.content, previewPort);

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
          content={file.content ?? `${file.name}\n\n暂无文件内容。`}
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
        textAlign: 'center',
      }}>
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
  if (!contentUrl) {
    return (
      <NativePreviewFallback
        detail="未提供可访问的 PDF 内容地址（当前端无可用内容端点），无法渲染预览。"
        filename={filename}
        title={`PDF 预览: ${filename}`}
      />
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <iframe
        title={`PDF 预览 ${filename}`}
        src={contentUrl}
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

function NativeImagePreview({
  contentUrl,
  filename,
}: {
  contentUrl?: string | undefined;
  filename: string;
}): React.ReactElement {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!contentUrl) {
    return (
      <NativePreviewFallback
        detail="未提供可访问的图片内容地址（当前端无可用内容端点），无法渲染预览。"
        filename={filename}
        title={`图片预览: ${filename}`}
      />
    );
  }

  if (loadFailed) {
    return (
      <NativePreviewFallback
        detail="图片内容地址存在，但加载失败（可能已失效或当前端无访问权限）。"
        filename={filename}
        title={`图片预览: ${filename}`}
      />
    );
  }

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
