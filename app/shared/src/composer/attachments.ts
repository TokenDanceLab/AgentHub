import type { ComposerAttachment } from './types';

const MAX_BROWSER_ATTACHMENT_PREVIEW = 12_000;

export function formatComposerAttachmentSize(value: number | undefined): string | undefined {
  if (value == null) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatComposerAttachmentContext(attachments: ComposerAttachment[]): string {
  if (attachments.length === 0) return '';

  const lines = ['Attached files:'];
  attachments.forEach((attachment, index) => {
    lines.push(`${index + 1}. ${attachment.name}`);
    if (attachment.path) lines.push(`   Path: ${attachment.path}`);
    lines.push(`   Source: ${attachment.source === 'desktop' ? 'Desktop file picker' : 'Browser file picker'}`);
    const size = formatComposerAttachmentSize(attachment.size);
    if (size) lines.push(`   Size: ${size}`);
    if (attachment.mime) lines.push(`   MIME: ${attachment.mime}`);
    if (attachment.contentPreview) {
      lines.push(`   Content preview${attachment.truncated ? ' (truncated)' : ''}:`);
      lines.push(attachment.contentPreview.split(/\r?\n/).map((line) => `   ${line}`).join('\n'));
    }
  });

  return lines.join('\n');
}

export function formatComposerPromptWithAttachments(
  text: string,
  attachments: ComposerAttachment[],
): string {
  const trimmed = text.trim();
  const attachmentContext = formatComposerAttachmentContext(attachments);
  if (!attachmentContext) return trimmed;
  return trimmed ? `${trimmed}\n\n${attachmentContext}` : attachmentContext;
}

export function shouldPreviewComposerFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown|json|jsonl|csv|tsv|yaml|yml|toml|xml|html|css|scss|js|jsx|ts|tsx|go|rs|py|java|c|cpp|h|hpp|log)$/i.test(file.name);
}

export async function browserFilesToComposerAttachments(files: File[]): Promise<ComposerAttachment[]> {
  return Promise.all(files.map(async (file, index) => {
    let contentPreview: string | undefined;
    let truncated = false;
    if (shouldPreviewComposerFile(file) && typeof file.text === 'function') {
      try {
        const text = await file.text();
        contentPreview = text.slice(0, MAX_BROWSER_ATTACHMENT_PREVIEW);
        truncated = text.length > MAX_BROWSER_ATTACHMENT_PREVIEW;
      } catch {
        contentPreview = undefined;
      }
    }

    return {
      id: `browser-${Date.now()}-${index}-${file.name}`,
      name: file.name,
      source: 'browser',
      size: file.size,
      ...(file.type ? { mime: file.type } : {}),
      ...(contentPreview ? { contentPreview, truncated } : {}),
    };
  }));
}
