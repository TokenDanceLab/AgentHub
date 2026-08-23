/**
 * Intl locale tag helpers for shared UI date/time formatting (#1826).
 *
 * AgentHub app language codes ('zh' | 'en') are base language tags, but
 * `Intl` date/time formatting needs a concrete region tag ('zh-CN' vs
 * 'en-US') so calendar conventions match what the user sees.
 */

/** Map an AgentHub app language to the Intl locale tag used by Date/Time formatting. */
export function appDateLocaleTag(language: string | null | undefined): string {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}
