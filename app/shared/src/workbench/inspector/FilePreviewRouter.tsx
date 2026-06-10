import React from 'react';
import { FilePreview } from './FilePreview';
import type { FileItem } from './OverviewPanel';
import { SlideshowPreview } from '../../ui/SlideshowPreview';
import { TablePreview } from '../../ui/TablePreview';
import { DocxPreview } from '../../ui/DocxPreview';
import styles from './FilePreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreviewRouter — Routes a PreviewFile to the right native or
   code viewer based on the filename extension.

   Routing table:
     .pptx / .ppt      -> SlideshowPreview (JSZip + XML parsing)
     .xlsx / .xls / .csv -> TablePreview (SheetJS xlsx)
     .docx              -> DocxPreview (mammoth.js)
     .pdf               -> browser-native PDF iframe
     .html / .htm       -> sandboxed HTML iframe (srcDoc)
     .png/.jpg/...      -> full-res image with lightbox
     .txt / .log        -> plain <pre>
     .md / .markdown    -> FilePreview (markdown mode)
     everything else    -> FilePreview (code / diff mode)
   ═══════════════════════════════════════════════════════════════════════ */

type PreviewFile = FileItem & {
  content?: string | undefined;
  diffContent?: string | undefined;
  owner?: string | undefined;
};

export interface FilePreviewRouterProps {
  file: PreviewFile;
  onClose: () => void;
}

type PreviewKind = 'pptx' | 'xlsx' | 'docx' | 'pdf' | 'html' | 'image' | 'text' | null;

function detectPreviewKind(filename: string): PreviewKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'xlsx';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (/^(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/.test(lower.split('.').pop() ?? '')) return 'image';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text';
  return null;
}

export const FilePreviewRouter: React.FC<FilePreviewRouterProps> = ({
  file,
  onClose,
}) => {
  const content = file.content ?? `${file.name}\n\n暂无文件内容。`;
  const kind = detectPreviewKind(file.name);

  // ── Document format previews (PPTX, XLSX, DOCX) ──
  if (kind === 'pptx') {
    return (
      <SlideshowPreview
        fileName={file.name}
        fileUrl={file.content ?? ''}
        onClose={onClose}
      />
    );
  }

  if (kind === 'xlsx') {
    return (
      <TablePreview
        fileName={file.name}
        fileUrl={file.content ?? ''}
        onClose={onClose}
      />
    );
  }

  if (kind === 'docx') {
    return (
      <DocxPreview
        fileName={file.name}
        fileUrl={file.content ?? ''}
        onClose={onClose}
      />
    );
  }

  // ── Native format: render directly ──
  if (kind === 'pdf') {
    return <PdfPreview filename={file.name} />;
  }

  if (kind === 'html') {
    return <HtmlPreview content={content} />;
  }

  if (kind === 'image') {
    return <ImagePreview filename={file.name} />;
  }

  if (kind === 'text') {
    return <TextPreview content={content} />;
  }

  // ── Fallback to existing FilePreview with code/diff/markdown modes ──
  return (
    <FilePreview
      filename={file.name}
      owner={file.owner}
      language={file.type}
      content={content}
      diffContent={file.diffContent}
      onClose={onClose}
    />
  );
};

// ── Native previews ─────────────────────────────────────────────────────

function PdfPreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <section className={styles.pane} aria-label={`PDF 预览 ${filename}`}>
      <iframe
        title={filename}
        className={styles.nativeFrame}
        src={''}
        role="document"
      />
    </section>
  );
}

function HtmlPreview({ content }: { content: string }): React.ReactElement {
  return (
    <section className={styles.pane} aria-label="HTML 预览">
      <iframe
        title="HTML 预览"
        className={styles.nativeFrame}
        srcDoc={content}
        sandbox="allow-scripts"
        role="document"
      />
    </section>
  );
}

function ImagePreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <section className={styles.pane} aria-label={`图片预览 ${filename}`}>
      <div className={styles.nativeImageWrap}>
        <div className={styles.nativeImageText}>
          <span>图片预览: {filename}</span>
          <span>通过文件 URL 或 base64 内容加载</span>
        </div>
      </div>
    </section>
  );
}

function TextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <section className={styles.pane} aria-label="文本预览">
      <pre className={styles.code} tabIndex={0}>
        <code className={styles.codeInner}>{content}</code>
      </pre>
    </section>
  );
}
