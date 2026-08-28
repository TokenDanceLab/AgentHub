import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../AgentsPage.module.css';
import {
  AgentMarketToolbar,
  MarketFeaturedSection,
  MarketTemplatesList,
  McpMarketSection,
  McpMarketToolbar,
  SkillMarketSection,
  SkillMarketToolbar,
} from './AgentMarketParts';
import type { AgentsPageProps, MarketCategory } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Market cluster views — Agent 市场 / Skill 市场 / MCP 市场.

   Extracted from AgentsPage as Phase 16 strangler slice #552.
   Residual thin: presentational subpanels live in AgentMarketParts (#649).
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    marketTemplates = [],
    marketFeatured = [],
    // MarketCategory enum identifier: data-plane default, not UI copy (#2015).
    activeMarketCategory = '推荐',
    onMarketCategoryChange,
    onMarketInstall,
    onMarketPreview,
    onMarketPublish,
    marketSearchQuery = '',
    onMarketSearchChange,
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  // MarketCategory enum identifiers (data plane); chip labels render the
  // values verbatim until the cross-surface enum display decision (#2015).
  const categories: MarketCategory[] = ['推荐', '研发', '文档', '测试', '安全', '发布'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.market.title')}</h1>
          <p className={styles['head-subcopy']}>
            {t('agents.market.subcopy')}
          </p>
        </div>
        {onMarketPublish && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onMarketPublish}>
            {t('agents.market.publish')}
          </button>
        )}
      </div>

      <AgentMarketToolbar
        marketSearchQuery={marketSearchQuery}
        activeMarketCategory={activeMarketCategory}
        categories={categories}
        searchPlaceholder={t('agents.market.search')}
        onMarketSearchChange={onMarketSearchChange}
        onMarketCategoryChange={onMarketCategoryChange}
      />

      <MarketFeaturedSection
        marketFeatured={marketFeatured}
        onMarketInstall={onMarketInstall}
        onMarketPreview={onMarketPreview}
      />

      <MarketTemplatesList
        marketTemplates={marketTemplates}
        marketSearchQuery={marketSearchQuery}
        activeMarketCategory={activeMarketCategory}
        onMarketSearchChange={onMarketSearchChange}
        onMarketInstall={onMarketInstall}
      />
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   Skill 市场 (SkillMarket)
   ═══════════════════════════════════════════════════════════════════════ */

export const SkillMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    skillMarketItems = [],
    skillMarketLoading = false,
    skillMarketError,
    skillMarketSearchQuery = '',
    onSkillMarketSearchChange,
    activeSkillTypeFilter = '',
    onSkillTypeFilterChange,
    onSkillInstall,
    onSkillUninstall,
    installedSkillIds = [],
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const skillTypes = ['', 'prompt', 'tool', 'workflow', 'integration'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.nav.skillMarket')}</h1>
          <p className={styles['head-subcopy']}>
            {t('agents.market.skillSubcopy')}
          </p>
        </div>
      </div>

      <SkillMarketToolbar
        skillMarketSearchQuery={skillMarketSearchQuery}
        activeSkillTypeFilter={activeSkillTypeFilter}
        skillTypes={skillTypes}
        onSkillMarketSearchChange={onSkillMarketSearchChange}
        onSkillTypeFilterChange={onSkillTypeFilterChange}
      />

      <SkillMarketSection
        skillMarketItems={skillMarketItems}
        skillMarketLoading={skillMarketLoading}
        skillMarketSearchQuery={skillMarketSearchQuery}
        activeSkillTypeFilter={activeSkillTypeFilter}
        {...(skillMarketError !== undefined ? { skillMarketError } : {})}
        installedSkillIds={installedSkillIds}
        onSkillMarketSearchChange={onSkillMarketSearchChange}
        onSkillInstall={onSkillInstall}
        onSkillUninstall={onSkillUninstall}
      />
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   MCP 市场 (MCPMarket)
   ═══════════════════════════════════════════════════════════════════════ */

export const MCPMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    mcpMarketItems = [],
    mcpMarketLoading = false,
    mcpMarketError,
    mcpMarketSearchQuery = '',
    onMcpMarketSearchChange,
    activeTransportFilter = '',
    onTransportFilterChange,
    onMcpInstall,
    onMcpUninstall,
    installedMcpIds = [],
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const transports = ['', 'stdio', 'http', 'sse'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.nav.mcpMarket')}</h1>
          <p className={styles['head-subcopy']}>
            {t('agents.market.mcpSubcopy')}
          </p>
        </div>
      </div>

      <McpMarketToolbar
        mcpMarketSearchQuery={mcpMarketSearchQuery}
        activeTransportFilter={activeTransportFilter}
        transports={transports}
        onMcpMarketSearchChange={onMcpMarketSearchChange}
        onTransportFilterChange={onTransportFilterChange}
      />

      <McpMarketSection
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={mcpMarketLoading}
        mcpMarketSearchQuery={mcpMarketSearchQuery}
        activeTransportFilter={activeTransportFilter}
        {...(mcpMarketError !== undefined ? { mcpMarketError } : {})}
        installedMcpIds={installedMcpIds}
        onMcpMarketSearchChange={onMcpMarketSearchChange}
        onMcpInstall={onMcpInstall}
        onMcpUninstall={onMcpUninstall}
      />
    </main>
  );
};
