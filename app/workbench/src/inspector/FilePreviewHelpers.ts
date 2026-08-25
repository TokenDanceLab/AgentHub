import type { PreviewPort } from '@shared/platform';
import { isAudioFileName, isVideoFileName } from '@shared/ui/mediaPreview';
import { highlightLine } from '@shared/ui/syntaxHighlight';
import type { DesignOpenWithIconName } from '../designIcons';
import styles from './FilePreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreviewHelpers — pure residual slices from FilePreview (#663).

   Mime/type detectors, default mode planner, synthetic diff, and highlight
   helpers. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type FilePreviewMode = 'code' | 'markdown' | 'diff' | 'pdf' | 'html' | 'image' | 'text';

export type NativePreviewMode = 'pdf' | 'html' | 'image' | 'text';

export interface OpenWithItem {
  label: string;
  icon: DesignOpenWithIconName;
}

export const openWithItems: OpenWithItem[] = [
  { label: 'VS Code', icon: 'vscode' },
  { label: 'Visual Studio', icon: 'visualStudio' },
  { label: 'Cursor', icon: 'cursor' },
  { label: 'Antigravity', icon: 'antigravity' },
  { label: 'Default app', icon: 'defaultApp' },
  { label: 'Terminal', icon: 'terminal' },
  { label: 'Git Bash', icon: 'gitBash' },
  { label: 'WSL', icon: 'wsl' },
  { label: 'Android Studio', icon: 'androidStudio' },
  { label: '打开所在文件夹', icon: 'folder' },
];

/** Derive a display label for the file type from filename extension. */
export function fileTypeLabel(filename: string, language?: string): string {
  if (language) return language.toUpperCase();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!ext || ext === filename.toLowerCase()) return 'file';
  return ext.toUpperCase();
}

export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

export function isHtmlFile(filename: string): boolean {
  return /\.(html?|htm)$/i.test(filename);
}

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(filename);
}

/** Audio media detection delegates to the shared media SSOT (#1939). */
export function isAudioFile(filename: string): boolean {
  return isAudioFileName(filename);
}

/** Video media detection delegates to the shared media SSOT (#1939). */
export function isVideoFile(filename: string): boolean {
  return isVideoFileName(filename);
}

export function isTextFile(filename: string): boolean {
  return /\.(txt|log|csv)$/i.test(filename);
}

export function isMarkdownFile(filename: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(filename);
}

export function defaultPreviewMode(filename: string): FilePreviewMode {
  if (isPdfFile(filename)) return 'pdf';
  if (isHtmlFile(filename)) return 'html';
  if (isImageFile(filename)) return 'image';
  if (isTextFile(filename)) return 'text';
  if (isMarkdownFile(filename)) return 'markdown';
  return 'code';
}

/** Prefer native preview modes when the extension has a dedicated renderer. */
export function resolveNativeMode(filename: string): NativePreviewMode | null {
  if (isPdfFile(filename)) return 'pdf';
  if (isHtmlFile(filename)) return 'html';
  if (isImageFile(filename)) return 'image';
  if (isTextFile(filename)) return 'text';
  return null;
}

export function nativeModeLabel(mode: NativePreviewMode): string {
  if (mode === 'pdf') return 'PDF';
  if (mode === 'html') return 'HTML';
  if (mode === 'image') return '图片';
  return '文本';
}

export function syntheticDiff(filename: string, content: string): string {
  const lines = content.split('\n');
  return [
    `diff --git a/${filename} b/${filename}`,
    `--- a/${filename}`,
    `+++ b/${filename}`,
    '@@ readonly preview @@',
    ...lines.map((line, index) => (index < 3 ? `+${line}` : ` ${line}`)),
  ].join('\n');
}

export function diffLineClass(line: string, css: typeof styles): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return css.diffAdd ?? '';
  if (line.startsWith('-') && !line.startsWith('---')) return css.diffDel ?? '';
  return '';
}

export function highlightDiffLine(line: string, language: string): string {
  if (
    !line ||
    line.startsWith('diff ') ||
    line.startsWith('@@') ||
    line.startsWith('---') ||
    line.startsWith('+++')
  ) {
    return highlightLine(line, '');
  }
  const marker = line[0] === '+' || line[0] === '-' || line[0] === ' ' ? line[0] : '';
  const body = marker ? line.slice(1) : line;
  return `${highlightLine(marker, '')}${highlightLine(body, language)}`;
}

export function openWithIconClass(name: DesignOpenWithIconName): string {
  switch (name) {
    case 'defaultApp':
      return `${styles.brandIconSvg} ${styles.vendorDefault}`;
    case 'terminal':
      return `${styles.brandIconSvg} ${styles.vendorTerminal}`;
    case 'folder':
      return `${styles.brandIconSvg} ${styles.vendorFolder}`;
    default:
      return styles.brandIconSvg ?? '';
  }
}

/**
 * Resolve an evidence content reference (from `PreviewFile.content`) into a
 * displayable URL for native previews (PDF iframe / image).
 *
 * - Empty/non-URL references (fallback prose such as `# path` metadata) yield
 *   `undefined` so the renderer shows an honest capability notice instead of
 *   an empty frame.
 * - Absolute http(s) URLs are used unchanged on every surface.
 * - Host-relative API paths require a `PreviewPort` that owns the host:
 *   Desktop resolves them against the Local Edge base URL, Web returns
 *   `undefined` (no Local Edge access, Hub-only boundary).
 * - Structured runtime-evidence refs (`PreviewFile.contentRef`) are resolved
 *   separately via `PreviewPort.resolveRuntimeEvidenceContent` (#1817).
 */
export function resolvePreviewContentUrl(
  contentRef: string | undefined,
  previewPort: PreviewPort | undefined
): string | undefined {
  const trimmed = contentRef?.trim() ?? '';
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    return previewPort?.resolveContentUrl?.(trimmed);
  }
  return undefined;
}
