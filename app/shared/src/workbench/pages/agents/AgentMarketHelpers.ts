import type { MarketTemplate, MCPMarketItem, SkillMarketItem } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   AgentMarketHelpers — pure residual slices from AgentMarketParts (#671).

   Runtime/meta formatters, filter labels, count labels, and exactOptional-
   PropertyTypes-safe EmptyState className packing. No React / no UX change.
   ═══════════════════════════════════════════════════════════════════════ */

function joinMetaParts(parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join(' · ');
}

export type MarketTemplateIdentity = Pick<MarketTemplate, 'runtimeId' | 'runtime' | 'name'>;
export type MarketTemplateStack = Pick<MarketTemplate, 'runtime' | 'provider' | 'model'>;
export type SkillMarketMeta = Pick<SkillMarketItem, 'version' | 'install_count'>;
export type McpMarketMeta = Pick<MCPMarketItem, 'command' | 'url' | 'install_count'>;

/** Prefer runtimeId, then runtime label, then template name for brand icons. */
export function resolveMarketRuntimeName(template: MarketTemplateIdentity): string {
  return template.runtimeId ?? template.runtime ?? template.name;
}

/** Runtime / provider / model stack shown on market cards. */
export function formatMarketRuntimeStack(template: MarketTemplateStack): string {
  return [template.runtime, template.provider, template.model].filter(Boolean).join(' / ') || 'fixture';
}

/** Compact meta line for the full-template list rows. */
export function formatMarketTemplateListMeta(template: MarketTemplate): string {
  return (
    joinMetaParts([
      template.runtime,
      template.provider,
      template.model,
      (template.mcpServers ?? []).join(' · '),
      template.memorySummary,
    ]) || template.detail
  );
}

/** Skill row meta: version + install count. */
export function formatSkillMarketMeta(skill: SkillMarketMeta): string {
  return joinMetaParts([
    skill.version ? `v${skill.version}` : '',
    skill.install_count ? `${skill.install_count} installs` : '',
  ]);
}

/** MCP row meta: command/url + install count. */
export function formatMcpMarketMeta(mcp: McpMarketMeta): string {
  return joinMetaParts([
    mcp.command || mcp.url || '',
    mcp.install_count ? `${mcp.install_count} installs` : '',
  ]);
}

/** Empty filter value maps to the "全部" chip label. */
export function marketFilterLabel(value: string, allLabel = '全部'): string {
  return value || allLabel;
}

/** Section counter: loading vs. N units. */
export function marketCountLabel(loading: boolean, count: number, unit: string): string {
  return loading ? '加载中' : `${count} ${unit}`;
}

export type CompactEmptyStateClassNames = {
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

/**
 * Pack optional EmptyState className props without spreading undefined
 * (exactOptionalPropertyTypes-safe).
 */
export function compactEmptyStateClassNames(
  css: Record<string, string | undefined>,
): CompactEmptyStateClassNames {
  const result: CompactEmptyStateClassNames = {};
  if (css['agent-empty-compact']) result.className = css['agent-empty-compact'];
  if (css['agent-empty-compact-content']) result.contentClassName = css['agent-empty-compact-content'];
  if (css['agent-empty-compact-title']) result.titleClassName = css['agent-empty-compact-title'];
  if (css['agent-empty-compact-description']) {
    result.descriptionClassName = css['agent-empty-compact-description'];
  }
  return result;
}
