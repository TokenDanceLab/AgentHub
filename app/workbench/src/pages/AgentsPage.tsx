import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../designIcons';
import styles from './AgentsPage.module.css';
import {
  AgentInstalledView,
  AgentMarketView,
  SkillMarketView,
  MCPMarketView,
  AgentPolicyView,
  AgentToolsView,
  AgentModelsView,
  AgentAuditView,
  DataSourceBadge,
} from './agents';
import type {
  AgentsPaneId,
  AgentsPageProps,
} from './agents';

/* ═══════════════════════════════════════════════════════════════════════
   AgentsPage — AgentHub v4
   8 sub-views: 已安装 / Agent 市场 / Skill 市场 / MCP 市场 /
                运行策略 / 工具权限 / 模型配置 / 审计日志
   Pure presentational — no data fetching, render from props.

   Market cluster extracted under ./agents for Phase 16 #552.
   Installed + ops clusters extracted under ./agents for Phase 17 #560.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  AgentsPaneId,
  PaneDataSource,
  AgentState,
  ToolPermission,
  RiskLevel,
  ModelState,
  AuditResult,
  MarketCategory,
  AgentConfig,
  MarketTemplate,
  PolicyRule,
  ToolMatrixAgent,
  ModelInfo,
  ModelRoute,
  ModelHealth,
  AuditEntry,
  AgentRecentEvent,
  SkillType,
  SkillMarketItem,
  MCPTransportType,
  MCPMarketItem,
  CCSwitchStatusInfo,
  CCSwitchProviderInfo,
  AgentsPageProps,
} from './agents';

/* ═══════════════════════════════════════════════════════════════════════
   AgentsPage
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentsPage: React.FC<AgentsPageProps> = (props) => {
  const {
    activePane,
    onPaneChange,
    dataSource = 'real',
    searchQuery = '',
    onSearchChange,
    recentShortcuts = [],
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  const navItems: { id: AgentsPaneId; label: string; icon: DesignNavIconName }[] = [
    { id: 'installed', label: t('agents.nav.installed'), icon: 'package' },
    { id: 'market', label: t('agents.nav.market'), icon: 'store' },
    { id: 'skillMarket', label: 'Skill 市场', icon: 'library' },
    { id: 'mcpMarket', label: 'MCP 市场', icon: 'service' },
    { id: 'policy', label: '运行策略', icon: 'policy' },
    { id: 'tools', label: t('agents.detail.tools'), icon: 'tools' },
    { id: 'models', label: '模型配置', icon: 'model' },
    { id: 'audit', label: '审计日志', icon: 'audit' },
  ];

  const renderPane = () => {
    switch (activePane) {
      case 'installed':
        return <AgentInstalledView {...props} />;
      case 'market':
        return <AgentMarketView {...props} />;
      case 'skillMarket':
        return <SkillMarketView {...props} />;
      case 'mcpMarket':
        return <MCPMarketView {...props} />;
      case 'policy':
        return <AgentPolicyView {...props} />;
      case 'tools':
        return <AgentToolsView {...props} />;
      case 'models':
        return <AgentModelsView {...props} />;
      case 'audit':
        return <AgentAuditView {...props} />;
      default:
        return <AgentInstalledView {...props} />;
    }
  };

  return (
    <section className={`${styles['agents-page']} workbench agents-page`}>
      <aside className={`${styles['workbench-nav']} workbench-nav`}>
        <div className={`${styles['workbench-title']} workbench-title`}>{t('nav.agents')}</div>
        <DataSourceBadge source={dataSource} />
        <input
          className={`${styles['workbench-search']} workbench-search`}
          placeholder={t('agents.installed.search')}
          value={searchQuery}
          disabled={!onSearchChange}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <div className={styles['nav-caption']}>配置中心</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles['nav-row']} ${activePane === item.id ? styles.active : ''}`}
            type="button"
            onClick={() => onPaneChange(item.id)}
          >
            <span className={styles['nav-glyph']}>
              <DesignNavIcon
                name={item.icon}
                size={DESIGN_NAV_GLYPH_SIZE}
                strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
              />
            </span>
            <span className={styles['nav-label']}>{item.label}</span>
          </button>
        ))}
        <div className={styles['nav-caption']}>最近变更</div>
        {recentShortcuts.map((item, i) => (
          <div key={i} className={styles['doc-shortcut']}>
            {item}
          </div>
        ))}
      </aside>

      {renderPane()}
    </section>
  );
};
