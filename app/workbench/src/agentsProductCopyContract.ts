/**
 * Chinese-first product chrome contract for Agents installed/detail (#1285).
 *
 * Forbids engineering EN microcopy that previously regressed into product UI.
 * Proper nouns / technical ids (Codex, Claude Code, openai, model/runtime ids)
 * remain allowed.
 */

/** Engineering EN meta that must not reappear in Agents product chrome. */
export const BANNED_PRODUCT_EN_META: readonly string[] = [
  'active templates',
  'running / ready',
  'tool gates',
  'AGENTS.md missing',
  'AGENTS.md enabled',
  'policy pending',
  'Memory disabled',
  'No tools allowed',
  'Generated initials only',
  'Allow / Confirm / Deny',
] as const;

/** Count suffix that Chinese UI expects as "X 个", not "X active". */
const BANNED_ACTIVE_COUNT_SUFFIX = /\b\d+\s+active\b/i;

/** Runtime/Model stuffing patterns that must not land in role/description. */
const BANNED_RUNTIME_MODEL_STUFFING = [
  /\bRuntime\s*:/i,
  /\bModel\s*:/i,
] as const;

export function findBannedProductEnMeta(text: string): string[] {
  const haystack = text ?? '';
  const hits: string[] = [];
  for (const phrase of BANNED_PRODUCT_EN_META) {
    if (haystack.includes(phrase)) hits.push(phrase);
  }
  const activeMatch = haystack.match(BANNED_ACTIVE_COUNT_SUFFIX);
  if (activeMatch) hits.push(activeMatch[0]);
  return hits;
}

export function assertNoBannedProductEnMeta(text: string, label = 'product copy'): void {
  const hits = findBannedProductEnMeta(text);
  if (hits.length > 0) {
    throw new Error(`${label} contains banned EN product meta: ${hits.join(', ')}`);
  }
}

export function findRuntimeModelStuffing(text: string): string[] {
  const haystack = text ?? '';
  return BANNED_RUNTIME_MODEL_STUFFING
    .filter((pattern) => pattern.test(haystack))
    .map((pattern) => pattern.source);
}

export function assertNoRuntimeModelStuffing(text: string, label = 'role/description'): void {
  const hits = findRuntimeModelStuffing(text);
  if (hits.length > 0) {
    throw new Error(`${label} contains Runtime/Model stuffing (${hits.join(', ')}): ${text}`);
  }
}

/** True when a value is only a proper noun / technical id (allowed EN). */
export function isAllowedTechnicalId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Model routes like "openai / gpt-5" or runtime ids like "claude-code".
  return /^[A-Za-z0-9][A-Za-z0-9 ._/+-]*$/.test(trimmed)
    && !findBannedProductEnMeta(trimmed).length
    && !findRuntimeModelStuffing(trimmed).length;
}
