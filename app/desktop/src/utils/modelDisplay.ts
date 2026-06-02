export type ModelDisplayNameMap = Record<string, string>;

const MODEL_PREFIX_RE = /^(newapi|tokendance|tokendance-gateway|api\.vectorcontrol\.tech\/v1)\//i;
const CONTEXT_SUFFIX_RE = /\s*\[1m\]$/i;

const FALLBACK_MODEL_NAMES: Record<string, string> = {
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

export function normalizeModelIdForLookup(value: string | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  const withoutContext = raw.replace(CONTEXT_SUFFIX_RE, '');
  const withoutKnownPrefix = withoutContext.replace(MODEL_PREFIX_RE, '');
  const parts = withoutKnownPrefix.split('/').filter(Boolean);
  return (parts[parts.length - 1] ?? withoutKnownPrefix).toLowerCase();
}

export function cleanModelId(value: string | undefined): { id: string; hasOneMillionContext: boolean } {
  const raw = value?.trim() ?? '';
  if (!raw) return { id: '', hasOneMillionContext: false };
  const hasOneMillionContext = CONTEXT_SUFFIX_RE.test(raw);
  const id = raw
    .replace(CONTEXT_SUFFIX_RE, '')
    .replace(MODEL_PREFIX_RE, '');
  return { id, hasOneMillionContext };
}

export function resolveModelDisplayName(
  value: string | undefined,
  externalNames?: ModelDisplayNameMap,
): string {
  const { id, hasOneMillionContext } = cleanModelId(value);
  if (!id) return '';
  const key = normalizeModelIdForLookup(id);
  const resolved = externalNames?.[key] ?? FALLBACK_MODEL_NAMES[key] ?? id;
  return `${resolved}${hasOneMillionContext ? ' 1M' : ''}`;
}
