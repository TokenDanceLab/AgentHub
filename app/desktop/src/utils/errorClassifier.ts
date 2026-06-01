// Error classifier utilities ported from Cherry Studio's classifyError patterns.
// Categorizes error messages into actionable categories for rendering in ErrorBlock.

export type ErrorCategory = 'auth' | 'quota' | 'model' | 'network' | 'server' | 'context_length' | 'tool' | 'unknown';

export interface ErrorClassification {
  category: ErrorCategory;
  retryable: boolean;
}

/**
 * Classify an error message + optional HTTP status code into a category
 * and indicate whether the caller should offer a retry button.
 */
export function classifyError(message: string, statusCode?: number): ErrorClassification {
  const msg = (message ?? '').toLowerCase().trim();
  const sc = typeof statusCode === 'number' && Number.isFinite(statusCode) ? statusCode : undefined;

  // ── Auth errors ──────────────────────────
  if (sc === 401 || sc === 403) {
    return { category: 'auth', retryable: false };
  }
  if (
    msg.includes('invalid api key') ||
    msg.includes('incorrect api key') ||
    msg.includes('invalid_api_key') ||
    msg.includes('unauthorized') ||
    msg.includes('authentication failed') ||
    msg.includes('not authorized') ||
    msg.includes('auth_error') ||
    msg.includes('no api key') ||
    msg.includes('api key not') ||
    msg.includes('key not found') ||
    msg.includes('credential') ||
    msg.includes('login required') ||
    msg.includes('please sign in')
  ) {
    return { category: 'auth', retryable: false };
  }

  // ── Quota / rate-limit errors ────────────
  if (sc === 429) {
    return { category: 'quota', retryable: true };
  }
  if (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('insufficient_quota') ||
    msg.includes('billing') ||
    msg.includes('balance') ||
    msg.includes('credit') ||
    msg.includes('insufficient funds') ||
    msg.includes('payment required') ||
    msg.includes('free trial') ||
    msg.includes('usage limit') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('token quota')
  ) {
    return { category: 'quota', retryable: true };
  }

  // ── Model errors ─────────────────────────
  if (sc === 404) {
    if (
      msg.includes('model') ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('no such')
    ) {
      return { category: 'model', retryable: false };
    }
  }
  if (
    msg.includes('model_not_found') ||
    msg.includes('model not found') ||
    msg.includes('unknown model') ||
    msg.includes('invalid model') ||
    msg.includes('model is not') ||
    msg.includes('no such model') ||
    msg.includes('model does not exist') ||
    msg.includes('deployment not found') ||
    msg.includes('engine not found') ||
    msg.includes('model overloaded') ||
    msg.includes('overloaded') ||
    msg.includes('capacity')
  ) {
    return { category: 'model', retryable: true };
  }

  // ── Network errors ───────────────────────
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('dns') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('network_error') ||
    msg.includes('socket') ||
    msg.includes('abort') ||
    msg.includes('aborted') ||
    msg.includes('request was interrupted') ||
    msg.includes('cancelled') ||
    msg.includes('canceled') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection refused') ||
    msg.includes('connection reset') ||
    msg.includes('connection closed') ||
    msg.includes('connection lost') ||
    msg.includes('no response') ||
    msg.includes('unreachable') ||
    msg.includes('retry')
  ) {
    return { category: 'network', retryable: true };
  }

  // ── Server errors (5xx) ──────────────────
  if (sc != null && sc >= 500 && sc < 600) {
    return { category: 'server', retryable: true };
  }
  if (
    msg.includes('internal server error') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('server_error') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    return { category: 'server', retryable: true };
  }

  // ── Context length errors ────────────────
  if (
    msg.includes('context length') ||
    msg.includes('context_length') ||
    msg.includes('token limit') ||
    msg.includes('max tokens') ||
    msg.includes('maximum context') ||
    msg.includes('too long') ||
    msg.includes('too many tokens') ||
    msg.includes('reduce the length') ||
    msg.includes('context window') ||
    msg.includes('input length') ||
    msg.includes('maximum length') ||
    msg.includes('truncated') ||
    msg.includes('content filter') ||
    msg.includes('content_filter')
  ) {
    return { category: 'context_length', retryable: false };
  }

  // ── Tool execution errors ────────────────
  if (
    msg.includes('tool execution') ||
    msg.includes('tool call') ||
    msg.includes('tool_error') ||
    msg.includes('tool failed') ||
    msg.includes('tool not found') ||
    msg.includes('tool input') ||
    msg.includes('invalid tool') ||
    msg.includes('function call') ||
    msg.includes('execution error') ||
    msg.includes('permission denied') ||
    msg.includes('command not found') ||
    msg.includes('exit code') ||
    msg.includes('non-zero exit')
  ) {
    return { category: 'tool', retryable: true };
  }

  // ── Default ──────────────────────────────
  return { category: 'unknown', retryable: true };
}
