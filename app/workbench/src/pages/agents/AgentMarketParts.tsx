import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import type { EmptyStateAction, EmptyStateCopyMatrix } from '@shared/ui';
import styles from '../AgentsPage.module.css';
import {
  MarketCard,
  MarketCompactEmpty,
  MarketFilterToolbar,
  MarketTemplateListRow,
  McpMarketItemRow,
  SkillMarketItemRow,
} from './AgentMarketItemParts';
import { resolveMarketEmptyKind } from './AgentMarketHelpers';
import type {
  MarketCategory,
  MarketTemplate,
  MCPMarketItem,
  SkillMarketItem,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Market-view presentational subpanels.

   Residual thin from AgentMarketViews (Phase 25 #649).
   Further residual thin: helpers + item parts (#671).
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export { MarketCard } from './AgentMarketItemParts';

/**
 * Builds an EmptyState copy matrix from the sharedWorkbench bundle.
 * `surface` selects the agents.market.emptyAgent | emptySkill | emptyMcp
 * key group; every kind resolves an explicit title/description key pair
 * (zh/en parity enforced by the resource test). #2007 i18n convergence.
 */
function buildMarketEmptyCopy(
  t: (key: string) => string,
  surface: 'emptyAgent' | 'emptySkill' | 'emptyMcp',
): EmptyStateCopyMatrix {
  const copy = (kind: 'blank' | 'search' | 'filter' | 'error' | 'noPermission') => ({
    title: t(`agents.market.${surface}.${kind}.title`),
    description: t(`agents.market.${surface}.${kind}.description`),
  });
  return {
    blank: copy('blank'),
    search: copy('search'),
    filter: copy('filter'),
    error: copy('error'),
    noPermission: copy('noPermission'),
  };
}

function clearSearchAction(
  label: string,
  onClear?: ((query: string) => void) | undefined,
): EmptyStateAction | undefined {
  if (!onClear) return undefined;
  return {
    label,
    onClick: () => onClear(''),
  };
}

export const AgentMarketToolbar: React.FC<{
  marketSearchQuery: string;
  activeMarketCategory: MarketCategory;
  categories: MarketCategory[];
  searchPlaceholder: string;
  onMarketSearchChange?: ((query: string) => void) | undefined;
  onMarketCategoryChange?: ((category: MarketCategory) => void) | undefined;
}> = ({
  marketSearchQuery,
  activeMarketCategory,
  categories,
  searchPlaceholder,
  onMarketSearchChange,
  onMarketCategoryChange,
}) => (
  <MarketFilterToolbar
    searchQuery={marketSearchQuery}
    searchPlaceholder={searchPlaceholder}
    filters={categories}
    activeFilter={activeMarketCategory}
    onSearchChange={onMarketSearchChange}
    onFilterChange={onMarketCategoryChange}
  />
);

export const MarketFeaturedSection: React.FC<{
  marketFeatured: MarketTemplate[];
  onMarketInstall?: ((name: string, description: string, category: string) => void) | undefined;
  onMarketPreview?: ((name: string) => void) | undefined;
}> = ({ marketFeatured, onMarketInstall, onMarketPreview }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={`${styles['agent-section']} ${styles['market-featured']}`}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.market.featuredTitle')}</h2>
      <span>{t('agents.market.featuredBadge')}</span>
    </div>
    <div className={`${styles['market-grid']} ${styles.featured}`}>
      {marketFeatured.map((tmpl) => (
        <MarketCard
          key={tmpl.name}
          template={tmpl}
          onInstall={onMarketInstall}
          onPreview={onMarketPreview}
        />
      ))}
    </div>
  </section>
  );
};

export const MarketTemplatesList: React.FC<{
  marketTemplates: MarketTemplate[];
  marketSearchQuery?: string | undefined;
  activeMarketCategory?: MarketCategory | undefined;
  marketError?: string | undefined;
  onMarketSearchChange?: ((query: string) => void) | undefined;
  onMarketInstall?: ((name: string, description: string, category: string) => void) | undefined;
}> = ({
  marketTemplates,
  marketSearchQuery = '',
  activeMarketCategory = '推荐',
  marketError,
  onMarketSearchChange,
  onMarketInstall,
}) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const emptyKind = resolveMarketEmptyKind({
    error: marketError,
    searchQuery: marketSearchQuery,
    activeFilter: activeMarketCategory,
    defaultFilter: '推荐',
  });

  return (
    <section className={`${styles['agent-section']} ${styles['market-list-section']}`}>
      <div className={styles['section-title-row']}>
        <h2>{t('agents.market.allTitle')}</h2>
        <span>{marketTemplates.length} templates</span>
      </div>
      {marketTemplates.length === 0 && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={buildMarketEmptyCopy(t, 'emptyAgent')}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction(t('agents.market.clearSearch'), onMarketSearchChange) }
            : {})}
        />
      )}
      <div className={styles['market-list']}>
        {marketTemplates.map((tmpl) => (
          <MarketTemplateListRow
            key={tmpl.name}
            template={tmpl}
            onInstall={onMarketInstall}
          />
        ))}
      </div>
    </section>
  );
};

export const SkillMarketToolbar: React.FC<{
  skillMarketSearchQuery: string;
  activeSkillTypeFilter: string;
  skillTypes: string[];
  onSkillMarketSearchChange?: ((query: string) => void) | undefined;
  onSkillTypeFilterChange?: ((skillType: string) => void) | undefined;
}> = ({
  skillMarketSearchQuery,
  activeSkillTypeFilter,
  skillTypes,
  onSkillMarketSearchChange,
  onSkillTypeFilterChange,
}) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <MarketFilterToolbar
    searchQuery={skillMarketSearchQuery}
    searchPlaceholder={t('agents.market.searchSkill')}
    filters={skillTypes}
    activeFilter={activeSkillTypeFilter}
    onSearchChange={onSkillMarketSearchChange}
    onFilterChange={onSkillTypeFilterChange}
  />
  );
};

export const SkillMarketSection: React.FC<{
  skillMarketItems: SkillMarketItem[];
  skillMarketLoading: boolean;
  skillMarketSearchQuery?: string | undefined;
  activeSkillTypeFilter?: string | undefined;
  skillMarketError?: string | undefined;
  installedSkillIds: string[];
  onSkillMarketSearchChange?: ((query: string) => void) | undefined;
  onSkillInstall?: ((skill: SkillMarketItem) => void) | undefined;
  onSkillUninstall?: ((skillId: string) => void) | undefined;
}> = ({
  skillMarketItems,
  skillMarketLoading,
  skillMarketSearchQuery = '',
  activeSkillTypeFilter = '',
  skillMarketError,
  installedSkillIds,
  onSkillMarketSearchChange,
  onSkillInstall,
  onSkillUninstall,
}) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const emptyKind = resolveMarketEmptyKind({
    error: skillMarketError,
    searchQuery: skillMarketSearchQuery,
    activeFilter: activeSkillTypeFilter,
    defaultFilter: '',
  });

  return (
    <section className={styles['agent-section']}>
      <div className={styles['section-title-row']}>
        <h2>{t('agents.market.skillTitle')}</h2>
        <span>
          {skillMarketLoading
            ? t('agents.market.loading')
            : `${skillMarketItems.length} skills`}
        </span>
      </div>
      {skillMarketItems.length === 0 && !skillMarketLoading && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={buildMarketEmptyCopy(t, 'emptySkill')}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction(t('agents.market.clearSearch'), onSkillMarketSearchChange) }
            : {})}
        />
      )}
      <div className={styles['market-list']}>
        {skillMarketItems.map((skill) => (
          <SkillMarketItemRow
            key={skill.id}
            skill={skill}
            isInstalled={installedSkillIds.includes(skill.id)}
            onSkillInstall={onSkillInstall}
            onSkillUninstall={onSkillUninstall}
          />
        ))}
      </div>
    </section>
  );
};

export const McpMarketToolbar: React.FC<{
  mcpMarketSearchQuery: string;
  activeTransportFilter: string;
  transports: string[];
  onMcpMarketSearchChange?: ((query: string) => void) | undefined;
  onTransportFilterChange?: ((transport: string) => void) | undefined;
}> = ({
  mcpMarketSearchQuery,
  activeTransportFilter,
  transports,
  onMcpMarketSearchChange,
  onTransportFilterChange,
}) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <MarketFilterToolbar
    searchQuery={mcpMarketSearchQuery}
    searchPlaceholder={t('agents.market.searchMcp')}
    filters={transports}
    activeFilter={activeTransportFilter}
    onSearchChange={onMcpMarketSearchChange}
    onFilterChange={onTransportFilterChange}
  />
  );
};

export const McpMarketSection: React.FC<{
  mcpMarketItems: MCPMarketItem[];
  mcpMarketLoading: boolean;
  mcpMarketSearchQuery?: string | undefined;
  activeTransportFilter?: string | undefined;
  mcpMarketError?: string | undefined;
  installedMcpIds: string[];
  onMcpMarketSearchChange?: ((query: string) => void) | undefined;
  onMcpInstall?: ((mcp: MCPMarketItem) => void) | undefined;
  onMcpUninstall?: ((mcpId: string) => void) | undefined;
}> = ({
  mcpMarketItems,
  mcpMarketLoading,
  mcpMarketSearchQuery = '',
  activeTransportFilter = '',
  mcpMarketError,
  installedMcpIds,
  onMcpMarketSearchChange,
  onMcpInstall,
  onMcpUninstall,
}) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const emptyKind = resolveMarketEmptyKind({
    error: mcpMarketError,
    searchQuery: mcpMarketSearchQuery,
    activeFilter: activeTransportFilter,
    defaultFilter: '',
  });

  return (
    <section className={styles['agent-section']}>
      <div className={styles['section-title-row']}>
        <h2>{t('agents.market.mcpTitle')}</h2>
        <span>
          {mcpMarketLoading
            ? t('agents.market.loading')
            : `${mcpMarketItems.length} servers`}
        </span>
      </div>
      {mcpMarketItems.length === 0 && !mcpMarketLoading && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={buildMarketEmptyCopy(t, 'emptyMcp')}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction(t('agents.market.clearSearch'), onMcpMarketSearchChange) }
            : {})}
        />
      )}
      <div className={styles['market-list']}>
        {mcpMarketItems.map((mcp) => (
          <McpMarketItemRow
            key={mcp.id}
            mcp={mcp}
            isInstalled={installedMcpIds.includes(mcp.id)}
            onMcpInstall={onMcpInstall}
            onMcpUninstall={onMcpUninstall}
          />
        ))}
      </div>
    </section>
  );
};
