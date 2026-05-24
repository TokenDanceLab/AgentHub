// ── Token Estimation ──────────────────────────

/**
 * Estimate tokens from character count using OpenCode's chars/4 formula.
 * This is a rough heuristic; actual token counts vary by model/tokenizer.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

// ── Types ─────────────────────────────────────

export interface ContextBreakdown {
  system: number;
  user: number;
  assistant: number;
  tool: number;
  other: number;
  total: number;
}

export interface BreakdownSegment {
  key: 'system' | 'user' | 'assistant' | 'tool' | 'other';
  tokens: number;
  width: number;
  percent: number;
}

export interface SessionMetrics {
  model?: string;
  provider?: string;
  /** Context window limit in tokens. Falls back to 200K if missing. */
  contextLimit?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost?: number;
  messages: Array<{ role: string; content: string }>;
}

// ── Breakdown Algorithm ──────────────────────

/**
 * Estimate the context breakdown by role from messages and total input tokens.
 *
 * Uses the same chars/4 estimation formula as OpenCode. If the estimated total
 * exceeds the actual input token count, scales all buckets proportionally so
 * they sum to the known total.
 */
export function breakdownContext(
  messages: Array<{ role: string; content: string }>,
  totalInputTokens: number,
): ContextBreakdown {
  if (!totalInputTokens || messages.length === 0) {
    return { system: 0, user: 0, assistant: 0, tool: 0, other: 0, total: 0 };
  }

  const chars = { system: 0, user: 0, assistant: 0, tool: 0 };

  for (const msg of messages) {
    const len = msg.content?.length ?? 0;
    switch (msg.role) {
      case 'system':
        chars.system += len;
        break;
      case 'user':
        chars.user += len;
        break;
      case 'assistant':
        chars.assistant += len;
        break;
      case 'tool':
        chars.tool += len;
        break;
      default:
        break;
    }
  }

  const tokens = {
    system: estimateTokens(chars.system),
    user: estimateTokens(chars.user),
    assistant: estimateTokens(chars.assistant),
    tool: estimateTokens(chars.tool),
  };
  const estimated = tokens.system + tokens.user + tokens.assistant + tokens.tool;

  if (estimated <= totalInputTokens) {
    return {
      ...tokens,
      other: totalInputTokens - estimated,
      total: totalInputTokens,
    };
  }

  // Scale proportionally when estimate exceeds actual
  const scale = totalInputTokens / estimated;
  const scaled = {
    system: Math.floor(tokens.system * scale),
    user: Math.floor(tokens.user * scale),
    assistant: Math.floor(tokens.assistant * scale),
    tool: Math.floor(tokens.tool * scale),
  };
  const scaledTotal = scaled.system + scaled.user + scaled.assistant + scaled.tool;

  return {
    ...scaled,
    other: Math.max(0, totalInputTokens - scaledTotal),
    total: totalInputTokens,
  };
}

/**
 * Convert a ContextBreakdown to display-ready segments, filtering out
 * zero-token entries and computing width/percent values.
 */
export function toSegments(breakdown: ContextBreakdown): BreakdownSegment[] {
  const { total, ...counts } = breakdown;
  if (total === 0) return [];

  const keys: Array<keyof typeof counts> = ['system', 'user', 'assistant', 'tool', 'other'];
  return keys
    .filter((k) => counts[k] > 0)
    .map((k) => ({
      key: k,
      tokens: counts[k],
      width: (counts[k] / total) * 100,
      percent: Math.round((counts[k] / total) * 1000) / 10,
    }));
}

// ── Formatting ────────────────────────────────

const UNITS = ['', 'K', 'M', 'B', 'T'];

/**
 * Format large numbers with SI suffixes.
 *   1234     -> "1.2K"
 *   1234567  -> "1.2M"
 */
export function formatTokens(n: number): string {
  if (n < 0) return '0';
  if (n < 1000) return n.toString();

  const tier = Math.min(
    Math.floor(Math.log10(Math.abs(n)) / 3),
    UNITS.length - 1,
  );
  const suffix = UNITS[tier];
  const scale = Math.pow(10, tier * 3);
  const value = n / scale;

  const decimals = tier <= 2 ? 1 : 0;
  return value.toFixed(decimals) + suffix;
}

/**
 * Format USD cost with 2 decimal places.
 *   0.0423 -> "$0.04"
 */
export function formatCost(usd: number): string {
  if (usd < 0) return '$0.00';
  return '$' + usd.toFixed(2);
}
