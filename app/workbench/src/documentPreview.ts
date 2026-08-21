export interface WorkbenchDocumentPreview {
  id: string;
  name: string;
  type: string;
  owner?: string | undefined;
  sourceLabel: string;
  content: string;
  diffContent?: string | undefined;
}

export function fileTypeFromPreviewName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'js';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.sql') || lower.endsWith('.db')) return 'db';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
  if (lower.endsWith('.docx')) return 'docx';
  return 'txt';
}

export function previewFilenameFromTitle(title: string): string {
  if (/\.[a-z0-9]{1,8}$/i.test(title)) return title;
  return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'untitled'}.md`;
}
