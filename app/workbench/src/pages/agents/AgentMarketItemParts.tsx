import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignNavIcon } from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import {
  EmptyState,
  resolveEmptyStateCopy,
  type EmptyStateAction,
  type EmptyStateCopyMatrix,
  type EmptyStateKind,
} from '@shared/ui';
import styles from '../AgentsPage.module.css';
import { ConfigSummaryRow, formatList } from './shared';
import {
  compactEmptyStateClassNames,
  formatMarketRuntimeStack,
  formatMarketTemplateListMeta,
  formatMcpMarketMeta,
  formatSkillMarketMeta,
  marketFilterLabel,
  resolveMarketRuntimeName,
} from './AgentMarketHelpers';
import type { MarketTemplate, MCPMarketItem, SkillMarketItem } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   AgentMarketItemParts — presentational residual slices from
   AgentMarketParts (#671).

   Cards, list rows, filter chrome, and compact empty states. CSS stays on
   AgentsPage.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type MarketFilterToolbarProps<T extends string = string> = {
  searchQuery: string;
  searchPlaceholder: string;
  filters: readonly T[];
  activeFilter: T;
  onSearchChange?: ((query: string) => void) | undefined;
  onFilterChange?: ((filter: T) => void) | undefined;
  /** Translated label for the empty ("all") chip; defaults to zh 全部. */
  allLabel?: string | undefined;
};

export function MarketFilterToolbar<T extends string>({
  searchQuery,
  searchPlaceholder,
  filters,
  activeFilter,
  onSearchChange,
  onFilterChange,
  allLabel,
}: MarketFilterToolbarProps<T>): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={styles['market-toolbar']}>
      <input
        className={styles['market-search']}
        type="search"
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
      />
      <div className={styles['market-cats']}>
        {filters.map((filter) => (
          <button
            key={filter}
            className={`${activeFilter === filter ? styles.active : ''}`}
            type="button"
            onClick={() => onFilterChange?.(filter)}
          >
            {marketFilterLabel(filter, allLabel ?? t('agents.market.filters.all'))}
          </button>
        ))}
      </div>
    </div>
  );
}

export const MarketCard: React.FC<{
  template: MarketTemplate;
  onInstall?: ((name: string, description: string, category: string) => void) | undefined;
  onPreview?: ((name: string) => void) | undefined;
}> = ({ template, onInstall, onPreview }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <article className={`${styles['market-card']} agent-card`} data-card-surface>
    <div className={styles['market-card-head']}>
      <div className={styles['market-icon']}>
        <RuntimeBrandIcon
          kind="runtime"
          name={resolveMarketRuntimeName(template)}
          size="compact"
          framed={false}
          decorative
        />
      </div>
      <span>{template.category}</span>
    </div>
    <h3>{template.name}</h3>
    <p>{template.description}</p>
    <small>{template.detail}</small>
    <div className={styles['market-config-summary']}>
      <ConfigSummaryRow label="Runtime" value={formatMarketRuntimeStack(template)} />
      <ConfigSummaryRow label="Skills" value={formatList(template.skills, t('agents.market.summary.noSkills'))} />
      <ConfigSummaryRow label="MCP" value={formatList(template.mcpServers, t('agents.market.summary.noMcp'))} />
      <ConfigSummaryRow label="Memory" value={template.memorySummary || t('agents.market.summary.noMemory')} />
      <ConfigSummaryRow label="Approval" value={template.approvalSummary || t('agents.market.summary.noApproval')} />
      <ConfigSummaryRow label="Target" value={formatList(template.targetPreferences, t('agents.market.summary.noTarget'))} />
    </div>
    <div>
      <button
        type="button"
        disabled={!onInstall}
        title={!onInstall ? t('agents.market.installUnavailable') : undefined}
        onClick={() => onInstall?.(template.name, template.description, template.category)}
      >
        {t('agents.market.install')}
      </button>
      <button
        type="button"
        disabled={!onPreview}
        title={!onPreview ? t('agents.market.previewUnavailable') : undefined}
        onClick={() => onPreview?.(template.name)}
      >
        {t('agents.market.preview')}
      </button>
    </div>
  </article>
  );
};

export const MarketTemplateListRow: React.FC<{
  template: MarketTemplate;
  onInstall?: ((name: string, description: string, category: string) => void) | undefined;
}> = ({ template, onInstall }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <button
    className={styles['market-list-row']}
    type="button"
    disabled={!onInstall}
    title={!onInstall ? t('agents.market.installUnavailable') : undefined}
    onClick={() => onInstall?.(template.name, template.description, template.category)}
  >
    <div className={styles['market-icon']}>
      <RuntimeBrandIcon
        kind="runtime"
        name={resolveMarketRuntimeName(template)}
        size="compact"
        framed={false}
        decorative
      />
    </div>
    <div>
      <strong>{template.name}</strong>
      <span>{template.description}</span>
    </div>
    <em>{template.category}</em>
    <small>{formatMarketTemplateListMeta(template)}</small>
    <b>{t('agents.market.install')}</b>
  </button>
  );
};

export const MarketCompactEmpty: React.FC<{
  kind: EmptyStateKind;
  copy: EmptyStateCopyMatrix;
  action?: EmptyStateAction | undefined;
}> = ({ kind, copy, action }) => {
  const resolvedCopy = resolveEmptyStateCopy(copy, kind);
  return (
    <EmptyState
      kind={kind}
      title={resolvedCopy.title}
      description={resolvedCopy.description}
      titleLevel={3}
      {...(action ? { action } : {})}
      {...compactEmptyStateClassNames(styles)}
    />
  );
};

export const SkillMarketItemRow: React.FC<{
  skill: SkillMarketItem;
  isInstalled: boolean;
  onSkillInstall?: ((skill: SkillMarketItem) => void) | undefined;
  onSkillUninstall?: ((skillId: string) => void) | undefined;
}> = ({ skill, isInstalled, onSkillInstall, onSkillUninstall }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <div className={`${styles['market-list-row']} ${styles['market-item-card']}`}>
    <div className={styles['market-icon']}>
      <DesignNavIcon name="library" size={16} />
    </div>
    <div>
      <strong>{skill.name}</strong>
      <span>{skill.description}</span>
    </div>
    <em className={styles['skill-type-badge']}>{skill.skill_type}</em>
    <small>{formatSkillMarketMeta(skill)}</small>
    {isInstalled ? (
      <button
        className={`${styles['market-action-btn']} ${styles.uninstall}`}
        type="button"
        disabled={!onSkillUninstall}
        title={!onSkillUninstall ? t('agents.market.skillUninstallUnavailable') : undefined}
        onClick={() => onSkillUninstall?.(skill.id)}
      >
        {t('agents.market.uninstall')}
      </button>
    ) : (
      <button
        className={`${styles['market-action-btn']} ${styles.install}`}
        type="button"
        disabled={!onSkillInstall}
        title={!onSkillInstall ? t('agents.market.skillInstallUnavailable') : undefined}
        onClick={() => onSkillInstall?.(skill)}
      >
        {t('agents.market.install')}
      </button>
    )}
  </div>
  );
};

export const McpMarketItemRow: React.FC<{
  mcp: MCPMarketItem;
  isInstalled: boolean;
  onMcpInstall?: ((mcp: MCPMarketItem) => void) | undefined;
  onMcpUninstall?: ((mcpId: string) => void) | undefined;
}> = ({ mcp, isInstalled, onMcpInstall, onMcpUninstall }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <div className={`${styles['market-list-row']} ${styles['market-item-card']}`}>
    <div className={styles['market-icon']}>
      <DesignNavIcon name="service" size={16} />
    </div>
    <div>
      <strong>{mcp.name}</strong>
      <span>{mcp.description}</span>
    </div>
    <em className={styles['transport-badge']}>{mcp.transport}</em>
    <small>{formatMcpMarketMeta(mcp)}</small>
    {isInstalled ? (
      <button
        className={`${styles['market-action-btn']} ${styles.uninstall}`}
        type="button"
        disabled={!onMcpUninstall}
        title={!onMcpUninstall ? t('agents.market.mcpUninstallUnavailable') : undefined}
        onClick={() => onMcpUninstall?.(mcp.id)}
      >
        {t('agents.market.uninstall')}
      </button>
    ) : (
      <button
        className={`${styles['market-action-btn']} ${styles.install}`}
        type="button"
        disabled={!onMcpInstall}
        title={!onMcpInstall ? t('agents.market.mcpInstallUnavailable') : undefined}
        onClick={() => onMcpInstall?.(mcp)}
      >
        {t('agents.market.install')}
      </button>
    )}
  </div>
  );
};
