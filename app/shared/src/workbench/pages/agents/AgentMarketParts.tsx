import React from 'react';
import styles from '../AgentsPage.module.css';
import {
  MarketCard,
  MarketCompactEmpty,
  MarketFilterToolbar,
  MarketTemplateListRow,
  McpMarketItemRow,
  SkillMarketItemRow,
} from './AgentMarketItemParts';
import { marketCountLabel } from './AgentMarketHelpers';
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
}> = ({ marketFeatured, onMarketInstall, onMarketPreview }) => (
  <section className={`${styles['agent-section']} ${styles['market-featured']}`}>
    <div className={styles['section-title-row']}>
      <h2>推荐模板</h2>
      <span>精选</span>
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

export const MarketTemplatesList: React.FC<{
  marketTemplates: MarketTemplate[];
  onMarketInstall?: ((name: string, description: string, category: string) => void) | undefined;
}> = ({ marketTemplates, onMarketInstall }) => (
  <section className={`${styles['agent-section']} ${styles['market-list-section']}`}>
    <div className={styles['section-title-row']}>
      <h2>全部模板</h2>
      <span>{marketTemplates.length} templates</span>
    </div>
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
}) => (
  <MarketFilterToolbar
    searchQuery={skillMarketSearchQuery}
    searchPlaceholder="搜索 Skill 名称或描述"
    filters={skillTypes}
    activeFilter={activeSkillTypeFilter}
    onSearchChange={onSkillMarketSearchChange}
    onFilterChange={onSkillTypeFilterChange}
  />
);

export const SkillMarketSection: React.FC<{
  skillMarketItems: SkillMarketItem[];
  skillMarketLoading: boolean;
  installedSkillIds: string[];
  onSkillInstall?: ((skill: SkillMarketItem) => void) | undefined;
  onSkillUninstall?: ((skillId: string) => void) | undefined;
}> = ({
  skillMarketItems,
  skillMarketLoading,
  installedSkillIds,
  onSkillInstall,
  onSkillUninstall,
}) => (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>公共 Skill</h2>
      <span>{marketCountLabel(skillMarketLoading, skillMarketItems.length, 'skills')}</span>
    </div>
    {skillMarketItems.length === 0 && !skillMarketLoading && (
      <MarketCompactEmpty
        title="暂无公共 Skill"
        description="Hub 上暂无已发布的 Skill，发布后在此浏览安装。"
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
}) => (
  <MarketFilterToolbar
    searchQuery={mcpMarketSearchQuery}
    searchPlaceholder="搜索 MCP Server 名称或描述"
    filters={transports}
    activeFilter={activeTransportFilter}
    onSearchChange={onMcpMarketSearchChange}
    onFilterChange={onTransportFilterChange}
  />
);

export const McpMarketSection: React.FC<{
  mcpMarketItems: MCPMarketItem[];
  mcpMarketLoading: boolean;
  installedMcpIds: string[];
  onMcpInstall?: ((mcp: MCPMarketItem) => void) | undefined;
  onMcpUninstall?: ((mcpId: string) => void) | undefined;
}> = ({
  mcpMarketItems,
  mcpMarketLoading,
  installedMcpIds,
  onMcpInstall,
  onMcpUninstall,
}) => (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>公共 MCP Server</h2>
      <span>{marketCountLabel(mcpMarketLoading, mcpMarketItems.length, 'servers')}</span>
    </div>
    {mcpMarketItems.length === 0 && !mcpMarketLoading && (
      <MarketCompactEmpty
        title="暂无公共 MCP Server"
        description="Hub 上暂无已发布的 MCP Server，发布后在此浏览安装。"
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
