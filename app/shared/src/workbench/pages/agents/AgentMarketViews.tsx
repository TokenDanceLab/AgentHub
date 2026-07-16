import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import { EmptyState } from '../../../ui';
import styles from '../AgentsPage.module.css';
import { ConfigSummaryRow, formatList } from './shared';
import type { AgentsPageProps, MarketCategory, MarketTemplate } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Market cluster views — Agent 市场 / Skill 市场 / MCP 市场.

   Extracted from AgentsPage as Phase 16 strangler slice #552.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    marketTemplates = [],
    marketFeatured = [],
    activeMarketCategory = '推荐',
    onMarketCategoryChange,
    onMarketInstall,
    onMarketPreview,
    onMarketPublish,
    marketSearchQuery = '',
    onMarketSearchChange,
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const categories: MarketCategory[] = ['推荐', '研发', '文档', '测试', '安全', '发布'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.market.title')}</h1>
          <p className={styles['head-subcopy']}>
            从 TokenDance 模板库安装可复用 Agent，不影响已安装配置。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onMarketPublish}>
          发布模板
        </button>
      </div>

      {/* Toolbar */}
      <div className={styles['market-toolbar']}>
        <input
          className={styles['market-search']}
          type="search"
          placeholder={t('agents.market.search')}
          value={marketSearchQuery}
          onChange={(e) => onMarketSearchChange?.(e.target.value)}
        />
        <div className={styles['market-cats']}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`${activeMarketCategory === cat ? styles.active : ''}`}
              type="button"
              onClick={() => onMarketCategoryChange?.(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Featured grid */}
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

      {/* All templates list */}
      <section className={`${styles['agent-section']} ${styles['market-list-section']}`}>
        <div className={styles['section-title-row']}>
          <h2>全部模板</h2>
          <span>{marketTemplates.length} templates</span>
        </div>
        <div className={styles['market-list']}>
          {marketTemplates.map((tmpl) => (
            <button
              key={tmpl.name}
              className={styles['market-list-row']}
              type="button"
              onClick={() =>
                onMarketInstall?.(tmpl.name, tmpl.description, tmpl.category)
              }
            >
              <div className={styles['market-icon']}>
                <RuntimeBrandIcon kind="runtime" name={tmpl.runtimeId ?? tmpl.runtime ?? tmpl.name} size="compact" framed={false} decorative />
              </div>
              <div>
                <strong>{tmpl.name}</strong>
                <span>{tmpl.description}</span>
              </div>
              <em>{tmpl.category}</em>
              <small>
                {[
                  tmpl.runtime,
                  tmpl.provider,
                  tmpl.model,
                  formatList(tmpl.mcpServers, ''),
                  tmpl.memorySummary,
                ].filter(Boolean).join(' · ') || tmpl.detail}
              </small>
              <b>安装</b>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
};

/* ── MarketCard ── */

const MarketCard: React.FC<{
  template: MarketTemplate;
  onInstall?: ((name: string, description: string, category: string) => void) | undefined;
  onPreview?: ((name: string) => void) | undefined;
}> = ({ template, onInstall, onPreview }) => (
  <article className={`${styles['market-card']} agent-card`} data-card-surface>
    <div className={styles['market-card-head']}>
      <div className={styles['market-icon']}>
        <RuntimeBrandIcon kind="runtime" name={template.runtimeId ?? template.runtime ?? template.name} size="compact" framed={false} decorative />
      </div>
      <span>{template.category}</span>
    </div>
    <h3>{template.name}</h3>
    <p>{template.description}</p>
    <small>{template.detail}</small>
    <div className={styles['market-config-summary']}>
      <ConfigSummaryRow label="Runtime" value={[template.runtime, template.provider, template.model].filter(Boolean).join(' / ') || 'fixture'} />
      <ConfigSummaryRow label="Skills" value={formatList(template.skills, '未声明 skill')} />
      <ConfigSummaryRow label="MCP" value={formatList(template.mcpServers, '未绑定 MCP')} />
      <ConfigSummaryRow label="Memory" value={template.memorySummary || '未声明 memory'} />
      <ConfigSummaryRow label="Approval" value={template.approvalSummary || '未声明审批策略'} />
      <ConfigSummaryRow label="Target" value={formatList(template.targetPreferences, '未声明 target')} />
    </div>
    <div>
      <button
        type="button"
        onClick={() =>
          onInstall?.(template.name, template.description, template.category)
        }
      >
        安装
      </button>
      <button type="button" onClick={() => onPreview?.(template.name)}>
        预览
      </button>
    </div>
  </article>
);

/* ═══════════════════════════════════════════════════════════════════════
   Skill 市场 (SkillMarket)
   ═══════════════════════════════════════════════════════════════════════ */

export const SkillMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    skillMarketItems = [],
    skillMarketLoading = false,
    skillMarketSearchQuery = '',
    onSkillMarketSearchChange,
    activeSkillTypeFilter = '',
    onSkillTypeFilterChange,
    onSkillInstall,
    onSkillUninstall,
    installedSkillIds = [],
  } = props;

  const skillTypes = ['', 'prompt', 'tool', 'workflow', 'integration'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>Skill 市场</h1>
          <p className={styles['head-subcopy']}>
            浏览公共 Skill，一键安装到当前 Agent Profile。已安装的 Skill 可随时卸载。
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles['market-toolbar']}>
        <input
          className={styles['market-search']}
          type="search"
          placeholder="搜索 Skill 名称或描述"
          value={skillMarketSearchQuery}
          onChange={(e) => onSkillMarketSearchChange?.(e.target.value)}
        />
        <div className={styles['market-cats']}>
          {skillTypes.map((type) => (
            <button
              key={type}
              className={`${activeSkillTypeFilter === type ? styles.active : ''}`}
              type="button"
              onClick={() => onSkillTypeFilterChange?.(type)}
            >
              {type || '全部'}
            </button>
          ))}
        </div>
      </div>

      <section className={styles['agent-section']}>
        <div className={styles['section-title-row']}>
          <h2>公共 Skill</h2>
          <span>{skillMarketLoading ? '加载中' : `${skillMarketItems.length} skills`}</span>
        </div>
        {skillMarketItems.length === 0 && !skillMarketLoading && (
          <EmptyState
            title="暂无公共 Skill"
            description="Hub 上暂无已发布的 Skill，发布后在此浏览安装。"
            titleLevel={3}
            {...(styles['agent-empty-compact']
              ? { className: styles['agent-empty-compact'] }
              : {})}
            {...(styles['agent-empty-compact-content']
              ? { contentClassName: styles['agent-empty-compact-content'] }
              : {})}
            {...(styles['agent-empty-compact-title']
              ? { titleClassName: styles['agent-empty-compact-title'] }
              : {})}
            {...(styles['agent-empty-compact-description']
              ? { descriptionClassName: styles['agent-empty-compact-description'] }
              : {})}
          />
        )}
        <div className={styles['market-list']}>
          {skillMarketItems.map((skill) => {
            const isInstalled = installedSkillIds.includes(skill.id);
            return (
              <div
                key={skill.id}
                className={`${styles['market-list-row']} ${styles['market-item-card']}`}
              >
                <div className={styles['market-icon']}>
                  <DesignNavIcon name="library" size={16} />
                </div>
                <div>
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                </div>
                <em className={styles['skill-type-badge']}>{skill.skill_type}</em>
                <small>
                  {[
                    skill.version ? `v${skill.version}` : '',
                    skill.install_count ? `${skill.install_count} installs` : '',
                  ].filter(Boolean).join(' · ')}
                </small>
                {isInstalled ? (
                  <button
                    className={`${styles['market-action-btn']} ${styles.uninstall}`}
                    type="button"
                    onClick={() => onSkillUninstall?.(skill.id)}
                  >
                    卸载
                  </button>
                ) : (
                  <button
                    className={`${styles['market-action-btn']} ${styles.install}`}
                    type="button"
                    onClick={() => onSkillInstall?.(skill)}
                  >
                    安装
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
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
    mcpMarketSearchQuery = '',
    onMcpMarketSearchChange,
    activeTransportFilter = '',
    onTransportFilterChange,
    onMcpInstall,
    onMcpUninstall,
    installedMcpIds = [],
  } = props;

  const transports = ['', 'stdio', 'http', 'sse'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>MCP 市场</h1>
          <p className={styles['head-subcopy']}>
            浏览公共 MCP Server，安装到 Agent Profile 以扩展工具能力。支持 stdio、HTTP、SSE 传输。
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles['market-toolbar']}>
        <input
          className={styles['market-search']}
          type="search"
          placeholder="搜索 MCP Server 名称或描述"
          value={mcpMarketSearchQuery}
          onChange={(e) => onMcpMarketSearchChange?.(e.target.value)}
        />
        <div className={styles['market-cats']}>
          {transports.map((t) => (
            <button
              key={t}
              className={`${activeTransportFilter === t ? styles.active : ''}`}
              type="button"
              onClick={() => onTransportFilterChange?.(t)}
            >
              {t || '全部'}
            </button>
          ))}
        </div>
      </div>

      <section className={styles['agent-section']}>
        <div className={styles['section-title-row']}>
          <h2>公共 MCP Server</h2>
          <span>{mcpMarketLoading ? '加载中' : `${mcpMarketItems.length} servers`}</span>
        </div>
        {mcpMarketItems.length === 0 && !mcpMarketLoading && (
          <EmptyState
            title="暂无公共 MCP Server"
            description="Hub 上暂无已发布的 MCP Server，发布后在此浏览安装。"
            titleLevel={3}
            {...(styles['agent-empty-compact']
              ? { className: styles['agent-empty-compact'] }
              : {})}
            {...(styles['agent-empty-compact-content']
              ? { contentClassName: styles['agent-empty-compact-content'] }
              : {})}
            {...(styles['agent-empty-compact-title']
              ? { titleClassName: styles['agent-empty-compact-title'] }
              : {})}
            {...(styles['agent-empty-compact-description']
              ? { descriptionClassName: styles['agent-empty-compact-description'] }
              : {})}
          />
        )}
        <div className={styles['market-list']}>
          {mcpMarketItems.map((mcp) => {
            const isInstalled = installedMcpIds.includes(mcp.id);
            return (
              <div
                key={mcp.id}
                className={`${styles['market-list-row']} ${styles['market-item-card']}`}
              >
                <div className={styles['market-icon']}>
                  <DesignNavIcon name="service" size={16} />
                </div>
                <div>
                  <strong>{mcp.name}</strong>
                  <span>{mcp.description}</span>
                </div>
                <em className={styles['transport-badge']}>{mcp.transport}</em>
                <small>
                  {[
                    mcp.command || mcp.url || '',
                    mcp.install_count ? `${mcp.install_count} installs` : '',
                  ].filter(Boolean).join(' · ')}
                </small>
                {isInstalled ? (
                  <button
                    className={`${styles['market-action-btn']} ${styles.uninstall}`}
                    type="button"
                    onClick={() => onMcpUninstall?.(mcp.id)}
                  >
                    卸载
                  </button>
                ) : (
                  <button
                    className={`${styles['market-action-btn']} ${styles.install}`}
                    type="button"
                    onClick={() => onMcpInstall?.(mcp)}
                  >
                    安装
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};
