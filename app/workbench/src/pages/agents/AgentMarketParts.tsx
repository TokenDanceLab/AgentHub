import React from 'react';
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
import { marketCountLabel, resolveMarketEmptyKind } from './AgentMarketHelpers';
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

const AGENT_MARKET_EMPTY_COPY: EmptyStateCopyMatrix = {
  blank: {
    title: '暂无 Agent 模板',
    description: '模板库为空时在此展示；发布或同步后可在这里安装。',
  },
  search: {
    title: '没有匹配的 Agent 模板',
    description: '换个关键词，或清空搜索后再看推荐与分类。',
  },
  filter: {
    title: '当前分类下没有模板',
    description: '切换到”推荐”或其他分类，或清空筛选后再试。',
  },
  error: {
    title: 'Agent 模板暂时不可用',
    description: '市场数据加载失败。恢复后可重试浏览与安装。',
  },
  noPermission: {
    title: '无权限访问 Agent 市场',
    description: '你没有访问此市场的权限，请联系管理员开通。',
  },
};

const SKILL_MARKET_EMPTY_COPY: EmptyStateCopyMatrix = {
  blank: {
    title: '暂无公共 Skill',
    description: 'Hub 上暂无已发布的 Skill，发布后在此浏览安装。',
  },
  search: {
    title: '没有匹配的 Skill',
    description: '换个关键词，或清空搜索后浏览全部公共 Skill。',
  },
  filter: {
    title: '当前类型下没有 Skill',
    description: '切换到”全部”或其他 Skill 类型后再试。',
  },
  error: {
    title: 'Skill 市场暂时不可用',
    description: '公共 Skill 列表加载失败。恢复后可重试浏览与安装。',
  },
  noPermission: {
    title: '无权限访问 Skill 市场',
    description: '你没有访问此市场的权限，请联系管理员开通。',
  },
};

const MCP_MARKET_EMPTY_COPY: EmptyStateCopyMatrix = {
  blank: {
    title: '暂无公共 MCP Server',
    description: 'Hub 上暂无已发布的 MCP Server，发布后在此浏览安装。',
  },
  search: {
    title: '没有匹配的 MCP Server',
    description: '换个关键词，或清空搜索后浏览全部公共 MCP。',
  },
  filter: {
    title: '当前传输方式下没有 MCP',
    description: '切换到”全部”或其他 transport 后再试。',
  },
  error: {
    title: 'MCP 市场暂时不可用',
    description: '公共 MCP 列表加载失败。恢复后可重试浏览与安装。',
  },
  noPermission: {
    title: '无权限访问 MCP 市场',
    description: '你没有访问此市场的权限，请联系管理员开通。',
  },
};

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
  const emptyKind = resolveMarketEmptyKind({
    error: marketError,
    searchQuery: marketSearchQuery,
    activeFilter: activeMarketCategory,
    defaultFilter: '推荐',
  });

  return (
    <section className={`${styles['agent-section']} ${styles['market-list-section']}`}>
      <div className={styles['section-title-row']}>
        <h2>全部模板</h2>
        <span>{marketTemplates.length} templates</span>
      </div>
      {marketTemplates.length === 0 && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={AGENT_MARKET_EMPTY_COPY}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction('清空搜索', onMarketSearchChange) }
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
  const emptyKind = resolveMarketEmptyKind({
    error: skillMarketError,
    searchQuery: skillMarketSearchQuery,
    activeFilter: activeSkillTypeFilter,
    defaultFilter: '',
  });

  return (
    <section className={styles['agent-section']}>
      <div className={styles['section-title-row']}>
        <h2>公共 Skill</h2>
        <span>{marketCountLabel(skillMarketLoading, skillMarketItems.length, 'skills')}</span>
      </div>
      {skillMarketItems.length === 0 && !skillMarketLoading && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={SKILL_MARKET_EMPTY_COPY}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction('清空搜索', onSkillMarketSearchChange) }
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
  const emptyKind = resolveMarketEmptyKind({
    error: mcpMarketError,
    searchQuery: mcpMarketSearchQuery,
    activeFilter: activeTransportFilter,
    defaultFilter: '',
  });

  return (
    <section className={styles['agent-section']}>
      <div className={styles['section-title-row']}>
        <h2>公共 MCP Server</h2>
        <span>{marketCountLabel(mcpMarketLoading, mcpMarketItems.length, 'servers')}</span>
      </div>
      {mcpMarketItems.length === 0 && !mcpMarketLoading && (
        <MarketCompactEmpty
          kind={emptyKind}
          copy={MCP_MARKET_EMPTY_COPY}
          {...(emptyKind === 'search'
            ? { action: clearSearchAction('清空搜索', onMcpMarketSearchChange) }
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
