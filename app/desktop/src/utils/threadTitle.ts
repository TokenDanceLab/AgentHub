export function cleanThreadTitle(title: string | undefined, fallback: string): string {
  const raw = title?.trim();
  if (!raw) return fallback;
  const withoutAttachments = raw.split(/\n\s*Attached files:/i)[0] ?? raw;
  const cleaned = withoutAttachments
    .replace(/\s+Attached files:\s*--.*$/i, '')
    .trim();
  return cleaned || fallback;
}

const MAX_AUTOMATIC_TITLE_LENGTH = 30;

const DEFAULT_AUTOMATIC_TITLES = [
  'new thread',
  'new chat',
  'untitled',
  'agenthub',
  'codex',
  'claude code',
  'claudecode',
];

export function isAutomaticThreadTitle(title: string | undefined, runtimeNames: string[] = []): boolean {
  const normalizedTitle = normalizeComparableTitle(title);
  if (!normalizedTitle) return true;

  const automaticTitles = new Set([
    ...DEFAULT_AUTOMATIC_TITLES,
    ...runtimeNames,
  ].map(normalizeComparableTitle).filter(Boolean));

  return automaticTitles.has(normalizedTitle);
}

export function buildAutomaticThreadTitle(prompt: string | undefined): string | null {
  const candidate = extractTitleCandidate(prompt);
  if (!candidate) return null;
  return truncateTitle(candidate, MAX_AUTOMATIC_TITLE_LENGTH);
}

export function getAutomaticThreadTitle({
  currentTitle,
  prompt,
  runtimeNames = [],
}: {
  currentTitle?: string;
  prompt?: string;
  runtimeNames?: string[];
}): string | null {
  if (!isAutomaticThreadTitle(currentTitle, runtimeNames)) return null;
  const nextTitle = buildAutomaticThreadTitle(prompt);
  if (!nextTitle) return null;
  if (normalizeComparableTitle(nextTitle) === normalizeComparableTitle(currentTitle)) return null;
  return nextTitle;
}

export function canAutoRenameThreadTitle({
  createdThreadForPrompt,
  currentThreadItemCount,
  manuallyNamedThread,
  locallyCreatedEmptyThread,
}: {
  createdThreadForPrompt?: boolean;
  currentThreadItemCount?: number;
  manuallyNamedThread?: boolean;
  locallyCreatedEmptyThread?: boolean;
}): boolean {
  if (manuallyNamedThread) return false;
  return Boolean(createdThreadForPrompt || locallyCreatedEmptyThread || currentThreadItemCount === 0);
}

function extractTitleCandidate(prompt: string | undefined): string | null {
  const source = prompt
    ?.replace(/\r\n/g, '\n')
    .split(/\n\s*Attached files:/i)[0]
    ?.trim();
  if (!source) return null;

  const lines = source.split('\n');
  let inFence = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    const cleaned = normalizeTitleLine(trimmed);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeTitleLine(line: string): string {
  return line
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/[`*_>#\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:,，。！？；：]+$/g, '')
    .trim();
}

function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;

  const words = title.split(/\s+/);
  if (words.length <= 1) return title.slice(0, maxLength).trim();

  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxLength) break;
    result = next;
  }
  return result || title.slice(0, maxLength).trim();
}

function normalizeComparableTitle(title: string | undefined): string {
  return title
    ?.trim()
    .toLowerCase()
    .replace(/\s+Attached files:\s*--.*$/i, '')
    .replace(/[\s_-]+/g, '')
    ?? '';
}
