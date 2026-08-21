import type { MarketTemplate, MCPMarketItem, SkillMarketItem } from './types';
import type { EmptyStateKind } from '@shared/ui';

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

export interface MarketEmptyContext {
  error?: string | undefined;
  searchQuery: string;
  activeFilter: string;
  defaultFilter?: string | undefined;
}

/** Error wins over user refinements; search wins over filter when both are active. */
export function resolveMarketEmptyKind({
  error,
  searchQuery,
  activeFilter,
  defaultFilter = '',
}: MarketEmptyContext): EmptyStateKind {
  if (error) return 'error';
  if (searchQuery.trim()) return 'search';
  if (activeFilter !== defaultFilter) return 'filter';
  return 'blank';
}

function matchesMarketQuery(query: string, values: string[]): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterAgentMarketItems(
  items: MarketTemplate[],
  query: string,
  category: string,
): MarketTemplate[] {
  return items.filter((item) => (
    (category === '推荐' || item.category === category)
    && matchesMarketQuery(query, [item.name, item.description, item.detail, item.category])
  ));
}

export function filterSkillMarketItems(
  items: SkillMarketItem[],
  query: string,
  skillType: string,
): SkillMarketItem[] {
  return items.filter((item) => (
    (!skillType || item.skill_type === skillType)
    && matchesMarketQuery(query, [item.name, item.description, item.skill_type])
  ));
}

export function filterMcpMarketItems(
  items: MCPMarketItem[],
  query: string,
  transport: string,
): MCPMarketItem[] {
  return items.filter((item) => (
    (!transport || item.transport === transport)
    && matchesMarketQuery(query, [item.name, item.description, item.transport])
  ));
}

export type CompactEmptyStateClassNames = {
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionClassName?: string;
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
  if (css['agent-empty-compact-action']) result.actionClassName = css['agent-empty-compact-action'];
  return result;
}
