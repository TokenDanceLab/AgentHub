import type {
  AuditEntry,
  CCSwitchProviderInfo,
  RiskLevel,
  ToolPermission,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   AgentOpsHelpers — pure residual slices from AgentOpsParts (#684).

   Policy/tool/cc-switch/model/audit labels and formatters only.
   No React / no intentional UX change. exactOptionalPropertyTypes-safe.
   ═══════════════════════════════════════════════════════════════════════ */

/** Policy matrix icon: high-risk rules use policy, others tools. */
export function policyRiskIconName(riskLevel: RiskLevel): 'policy' | 'tools' {
  return riskLevel === '高风险' ? 'policy' : 'tools';
}

/** CSS module key for the connection badge (active | inactive). */
export function ccSwitchConnectionTone(routingActive: boolean): 'active' | 'inactive' {
  return routingActive ? 'active' : 'inactive';
}

/**
 * Model alias entries for the current provider card.
 * Keys ending with `_name` are display-name metadata and stay hidden.
 */
export function listModelAliases(
  modelAliases: Record<string, string> | undefined,
): Array<[string, string]> {
  if (!modelAliases) return [];
  return Object.entries(modelAliases).filter(([key]) => !key.endsWith('_name'));
}

/** Whether a provider has any visible (non-_name) model aliases. */
export function hasVisibleModelAliases(
  modelAliases: Record<string, string> | undefined,
): boolean {
  return listModelAliases(modelAliases).length > 0;
}

/** Current providers only — keeps render filters pure. */
export function listCurrentCcSwitchProviders(
  providers: readonly CCSwitchProviderInfo[] | undefined,
): CCSwitchProviderInfo[] {
  return (providers ?? []).filter((provider) => provider.isCurrent);
}

/** Tool matrix cell value with the same demo fallback as before. */
export function resolveToolPermission(
  permissions: Record<string, ToolPermission | undefined> | undefined,
  tool: string,
  fallback: ToolPermission = '需确认',
): ToolPermission {
  return permissions?.[tool] ?? fallback;
}

/** Route row subtitle: "role · mode". */
export function formatModelRouteSubtitle(role: string, mode: string): string {
  return `${role} · ${mode}`;
}

/** Stable-ish audit row key matching prior inline composition. */
export function auditEntryKey(entry: Pick<AuditEntry, 'time' | 'agent' | 'tool'>, index: number): string {
  return `${entry.time}-${entry.agent}-${entry.tool}-${index}`;
}

/**
 * Pack optional className props without spreading undefined
 * (exactOptionalPropertyTypes-safe).
 */
export function compactClassNames(
  entries: Record<string, string | undefined | false | null>,
): { className?: string } {
  const parts = Object.values(entries).filter((value): value is string => Boolean(value));
  if (parts.length === 0) return {};
  return { className: parts.join(' ') };
}
