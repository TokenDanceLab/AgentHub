import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Button, Pill, SearchInput, ProgressBar } from '@shared/ui';
import { ParticleCanvas } from '@/components/ParticleCanvas';
import { WebLayout } from '@/components/WebLayout';
import styles from './AgentSquarePage.module.css';

/* ---- inline mock data (static prototype) ---- */
const mockRunners: Array<{ id: string; name: string; status: string; capabilities?: string }> = [
  { id: 'runner-001', name: 'TS Builder', status: 'online', capabilities: 'TypeScript,React,Frontend' },
  { id: 'runner-002', name: 'Go Ops Agent', status: 'offline', capabilities: 'Go,Infrastructure,Deploy' },
  { id: 'runner-003', name: 'Python ML Runner', status: 'online', capabilities: 'Python,ML,Data' },
];

type AgentCategory = 'Engineering' | 'Design' | 'Operations' | 'Research';
type SortMode = 'popular' | 'rating' | 'recent';
type ViewMode = 'all' | 'favorites' | 'installed';

type Agent = {
  id: string;
  name: string;
  category: AgentCategory;
  icon: string;
  tone: 'blue' | 'cyan' | 'purple' | 'green';
  summary: string;
  description: string;
  tags: string[];
  installs: number;
  favoriteCount: number;
  rating: number;
  updatedDaysAgo: number;
  outputs: string[];
};

type Confirmation = {
  actionAgentId?: string;
  id: string;
  message: string;
  title: string;
};

const agents: Agent[] = [
  { id: 'refactor', name: 'Code Refactor Pro', category: 'Engineering', icon: 'code_blocks', tone: 'blue', summary: 'Modernizes front-end and Go service modules while keeping reviewable diffs visible.', description: 'Best for code cleanup passes where the workspace needs scoped patches, local conventions, and clear validation notes before review.', tags: ['TypeScript', 'Go', 'Review'], installs: 14820, favoriteCount: 1824, rating: 4.9, updatedDaysAgo: 6, outputs: ['Scoped patch plan', 'Validation checklist', 'Risk notes'] },
  { id: 'designer', name: 'Interface Critic', category: 'Design', icon: 'palette', tone: 'purple', summary: 'Audits tool surfaces for hierarchy, responsive density, and component states.', description: 'Reviews a workbench page like a product surface: layout rhythm, accessible labels, empty states, and responsive clipping.', tags: ['UI audit', 'A11y', 'Layout'], installs: 9360, favoriteCount: 1211, rating: 4.8, updatedDaysAgo: 3, outputs: ['Visual hierarchy pass', 'A11y notes', 'Responsive risks'] },
  { id: 'qa', name: 'QA Flow Builder', category: 'Engineering', icon: 'fact_check', tone: 'cyan', summary: 'Creates focused checks for UI flows, command output, and API contract edges.', description: 'Useful when a page or workflow needs a compact smoke plan with the right assertions and a clean handoff for testers.', tags: ['Playwright', 'Unit tests', 'Smoke'], installs: 12840, favoriteCount: 1506, rating: 4.7, updatedDaysAgo: 9, outputs: ['Smoke scenarios', 'State matrix', 'Manual QA steps'] },
  { id: 'ops', name: 'Runbook Operator', category: 'Operations', icon: 'terminal', tone: 'green', summary: 'Turns incidents and release notes into commands, checkpoints, and rollback prompts.', description: 'Pairs well with deployment work because it keeps routine operations, checks, and escalation notes in one readable sequence.', tags: ['Runbook', 'Deploy', 'Monitor'], installs: 8700, favoriteCount: 984, rating: 4.6, updatedDaysAgo: 2, outputs: ['Command sequence', 'Rollback prompts', 'Operator handoff'] },
  { id: 'research', name: 'Evidence Synthesizer', category: 'Research', icon: 'travel_explore', tone: 'purple', summary: 'Groups sources into claims, caveats, contradictions, and decision notes.', description: 'Helps teams move from raw references to compact conclusions while preserving the difference between evidence and inference.', tags: ['Sources', 'Citations', 'Summary'], installs: 10320, favoriteCount: 1398, rating: 4.9, updatedDaysAgo: 5, outputs: ['Claim map', 'Source trail', 'Decision summary'] },
  { id: 'release', name: 'Release Steward', category: 'Operations', icon: 'rocket_launch', tone: 'blue', summary: 'Collects branch status, validation commands, changelog points, and merge readiness.', description: 'Keeps release coordination visible across branch status, test evidence, review notes, and handoff copy.', tags: ['PR', 'Validation', 'Changelog'], installs: 7600, favoriteCount: 862, rating: 4.5, updatedDaysAgo: 8, outputs: ['Release checklist', 'Changelog draft', 'Merge summary'] },
  ...mockRunners.map((runner) => ({
    id: runner.id, name: runner.name, category: 'Engineering' as AgentCategory,
    icon: runner.status === 'online' ? 'memory' : 'cloud_off',
    tone: (runner.status === 'online' ? 'cyan' : 'purple') as Agent['tone'],
    summary: runner.capabilities ?? 'Local runner agent',
    description: `Runner ${runner.name} — status: ${runner.status}. Capabilities: ${runner.capabilities ?? 'unknown'}.`,
    tags: [runner.status, ...(runner.capabilities?.split(',') ?? [])],
    installs: runner.status === 'online' ? 5200 : 800,
    favoriteCount: runner.status === 'online' ? 340 : 45,
    rating: runner.status === 'online' ? 4.5 : 3.2,
    updatedDaysAgo: runner.status === 'online' ? 1 : 12,
    outputs: ['Run execution', 'Output streaming', 'File artifacts'],
  })),
];

const categories: Array<AgentCategory | 'All'> = ['All', 'Engineering', 'Design', 'Operations', 'Research'];
const initialFavoriteIds = new Set<string>(['refactor', mockRunners[0]?.id].filter(Boolean) as string[]);
const initialInstalledIds = new Set<string>(['refactor', mockRunners[0]?.id, mockRunners[1]?.id].filter(Boolean) as string[]);
const workspaceLimit = 8;

function formatInstalls(installs: number): string { return `${(installs / 1000).toFixed(1)}k`; }

export function AgentSquarePage() {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<AgentCategory | 'All'>('All');
  const [detailAgentId, setDetailAgentId] = useState<string | null>(agents[0]!.id);
  const [isDetailOpen, setIsDetailOpen] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState(initialFavoriteIds);
  const [installedIds, setInstalledIds] = useState(initialInstalledIds);
  const [query, setQuery] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('popular');
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  const detailAgent = isDetailOpen ? agents.find((a) => a.id === detailAgentId) ?? null : null;
  const hasActiveFilters = activeCategory !== 'All' || query.trim().length > 0 || viewMode !== 'all';
  const workspaceIsFull = installedIds.size >= workspaceLimit;

  const categoryCounts = useMemo(() => {
    const counts = new Map<AgentCategory | 'All', number>([['All', agents.length]]);
    categories.forEach((c) => { if (c !== 'All') counts.set(c, agents.filter((a) => a.category === c).length); });
    return counts;
  }, []);

  function getDisplayInstalls(agentId: string): number {
    const agent = agents.find((a) => a.id === agentId);
    return agent ? agent.installs + (installedIds.has(agentId) && !initialInstalledIds.has(agentId) ? 1 : 0) : 0;
  }

  function getDisplayFavoriteCount(agentId: string): number {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return 0;
    if (favoriteIds.has(agentId) && !initialFavoriteIds.has(agentId)) return agent.favoriteCount + 1;
    if (!favoriteIds.has(agentId) && initialFavoriteIds.has(agentId)) return Math.max(agent.favoriteCount - 1, 0);
    return agent.favoriteCount;
  }

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents
      .filter((a) => activeCategory === 'All' || a.category === activeCategory)
      .filter((a) => { if (viewMode === 'favorites') return favoriteIds.has(a.id); if (viewMode === 'installed') return installedIds.has(a.id); return true; })
      .filter((a) => { if (!q) return true; return [a.name, a.category, a.summary, ...a.tags].join(' ').toLowerCase().includes(q); })
      .sort((a, b) => {
        if (sortMode === 'rating') return b.rating - a.rating || b.installs - a.installs;
        if (sortMode === 'recent') return a.updatedDaysAgo - b.updatedDaysAgo || b.rating - a.rating;
        return getDisplayInstalls(b.id) - getDisplayInstalls(a.id) || b.rating - a.rating;
      });
  }, [activeCategory, favoriteIds, installedIds, query, sortMode, viewMode]);

  function clearFilters() {
    setActiveCategory('All'); setQuery(''); setViewMode('all');
    setConfirmation({ id: `clear-${Date.now()}`, message: t('as.confirm.filtersClearedMsg'), title: t('as.confirm.filtersCleared') });
  }

  function openAgentDetails(agentId: string) { setDetailAgentId(agentId); setIsDetailOpen(true); }

  function toggleFavorite(agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
    const wasFavorite = favoriteIds.has(agentId);
    setFavoriteIds((prev) => { const n = new Set(prev); n.has(agentId) ? n.delete(agentId) : n.add(agentId); return n; });
    if (agent) {
      setConfirmation({
        actionAgentId: agent.id, id: `fav-${agent.id}-${Date.now()}`,
        message: `${formatInstalls(getDisplayFavoriteCount(agent.id) + (wasFavorite ? -1 : 1))} local saves are now shown on the card.`,
        title: wasFavorite ? t('as.confirm.removedFavorite', { name: agent.name }) : t('as.confirm.saved', { name: agent.name }),
      });
    }
  }

  function installAgent(agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    if (installedIds.has(agentId)) {
      openAgentDetails(agentId);
      setConfirmation({ actionAgentId: agentId, id: `inst-${agentId}-${Date.now()}`, message: t('as.confirm.alreadyAddedMsg'), title: t('as.confirm.alreadyAdded', { name: agent.name }) });
      return;
    }
    if (workspaceIsFull) {
      setConfirmation({ actionAgentId: agentId, id: `full-${agentId}-${Date.now()}`, message: t('as.confirm.workspaceFullMsg', { limit: workspaceLimit }), title: t('as.confirm.workspaceFull') });
      return;
    }
    setInstalledIds((prev) => { const n = new Set(prev); n.add(agentId); return n; });
    openAgentDetails(agentId);
    setConfirmation({ actionAgentId: agentId, id: `add-${agentId}-${Date.now()}`, message: t('as.confirm.addedMsg', { current: installedIds.size + 1, limit: workspaceLimit }), title: t('as.confirm.added', { name: agent.name }) });
  }

  const navItems = [
    { icon: 'storefront', label: t('as.nav.marketplace'), active: viewMode === 'all', onClick: () => setViewMode('all') },
    { icon: 'dashboard', label: t('as.nav.workspace'), active: viewMode === 'installed', onClick: () => setViewMode('installed') },
    { icon: 'bookmark', label: t('as.nav.favorites'), active: viewMode === 'favorites', onClick: () => setViewMode('favorites') },
  ];

  const sidebarBottom = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px', border: '1px solid rgba(255,255,255,0.62)', borderRadius: 12, background: 'rgba(255,255,255,0.46)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted-foreground)', letterSpacing: '0.09em' }}>{t('as.slots.label')}</span>
        <strong style={{ fontSize: 12 }}>{installedIds.size} / {workspaceLimit}</strong>
      </div>
      <ProgressBar value={Math.min((installedIds.size / workspaceLimit) * 100, 100)} />
      <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>{t('as.slots.hint')}</p>
    </div>
  );

  return (
    <div className={styles.pageRoot}>
      <ParticleCanvas />
      <WebLayout
        brandName={t('as.brand')}
        brandSubtitle={t('as.subtitle')}
        navItems={navItems}
        sectionLabels={[
          { text: t('as.nav.label') },
          { text: t('as.categories.label') },
        ]}
        sidebarBottom={sidebarBottom}
        topbarLeft={
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--muted-foreground)', marginBottom: 4 }}>{t('as.topbar.eyebrow')}</div>
            <h1 style={{ fontSize: 27, lineHeight: 1.1, margin: 0, color: 'var(--foreground)' }}>{t('as.topbar.title')}</h1>
            <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '4px 0 0' }}>{t('as.topbar.subtitle')}</p>
          </div>
        }
        topbarRight={
          <>
            <SearchInput placeholder={t('as.topbar.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={styles.sortSelect} aria-label="Sort agents" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="popular">{t('as.topbar.sort.popular')}</option>
              <option value="rating">{t('as.topbar.sort.rating')}</option>
              <option value="recent">{t('as.topbar.sort.recent')}</option>
            </select>
          </>
        }
        drawer={detailAgent ? (
          <>
            <div className={styles.drawerHead}>
              <div>
                <div className={styles.drawerSubtitle}>{t('as.drawer.title')}</div>
                <div className={styles.drawerTitle}>{detailAgent.name}</div>
              </div>
              <Button variant="icon" onClick={() => setIsDetailOpen(false)} aria-label="Close detail"><Icon name="close" /></Button>
            </div>
            <div className={styles.drawerSection} style={{ marginTop: 16 }}>
              <div className={styles.drawerHero}>
                <div className={`${styles.agentLogo} ${styles.drawerHeroLogo} ${detailAgent.tone === 'blue' ? styles.logoBlue : detailAgent.tone === 'cyan' ? styles.logoCyan : detailAgent.tone === 'purple' ? styles.logoPurple : styles.logoGreen}`}>
                  <Icon name={detailAgent.icon} />
                </div>
                <div>
                  <Pill variant="cyan">{detailAgent.category}</Pill>
                  <p className={styles.drawerDesc}>{detailAgent.summary}</p>
                </div>
              </div>
              <p className={styles.drawerDesc}>{detailAgent.description}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted-foreground)' }}>
                <span>{t('as.drawer.rating')}</span><strong style={{ fontSize: 12, color: 'var(--foreground)' }}>{t('as.drawer.ratingValue', { rating: detailAgent.rating.toFixed(1) })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted-foreground)' }}>
                <span>{t('as.drawer.installsLabel')}</span><strong style={{ fontSize: 12, color: 'var(--foreground)' }}>{formatInstalls(getDisplayInstalls(detailAgent.id))}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted-foreground)' }}>
                <span>{t('as.drawer.favoritesLabel')}</span><strong style={{ fontSize: 12, color: 'var(--foreground)' }}>{formatInstalls(getDisplayFavoriteCount(detailAgent.id))}</strong>
              </div>
            </div>
            <div className={styles.drawerSection} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className={styles.drawerSectionTitle}>{t('as.drawer.output')}</h3>
                <Pill variant="purple">{t('as.drawer.preview')}</Pill>
              </div>
              {detailAgent.outputs.map((output, i) => (
                <div className={styles.drawerRow} key={output}>
                  <div className={`${styles.drawerRowIcon} ${styles.statIcon} ${i === 1 ? styles.statIconCyan : i === 2 ? styles.statIconPurple : ''}`}>
                    <Icon name={i === 0 ? 'difference' : i === 1 ? 'checklist' : 'notes'} size={18} />
                  </div>
                  <div>
                    <strong style={{ fontSize: 12 }}>{output}</strong>
                    <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('as.drawer.outputHint')}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.drawerSection} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className={styles.drawerSectionTitle}>{t('as.drawer.workspaceState')}</h3>
                <Pill variant={installedIds.has(detailAgent.id) ? 'green' : 'cyan'}>{installedIds.has(detailAgent.id) ? t('as.agent.added') : t('as.agent.available')}</Pill>
              </div>
              <div className={styles.drawerRow}>
                <div className={`${styles.drawerRowIcon} ${styles.statIcon} ${styles.statIconPurple}`}>
                  <Icon name="favorite" size={18} />
                </div>
                <div>
                  <strong style={{ fontSize: 12 }}>{favoriteIds.has(detailAgent.id) ? t('as.drawer.favorited') : t('as.drawer.notFavorited')}</strong>
                  <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('as.drawer.favStateHint')}</p>
                </div>
              </div>
              <div className={styles.drawerRow}>
                <div className={`${styles.drawerRowIcon} ${styles.statIcon} ${styles.statIconGreen}`}>
                  <Icon name="download_done" size={18} />
                </div>
                <div>
                  <strong style={{ fontSize: 12 }}>{installedIds.has(detailAgent.id) ? t('as.drawer.ready') : t('as.drawer.readyAdd')}</strong>
                  <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>{t('as.drawer.installStateHint')}</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.drawerEmpty}>
            <Icon name="ads_click" size={40} />
            <h2 className={styles.drawerTitle}>{t('as.drawer.selectPrompt')}</h2>
            <p className={styles.emptyHint}>{t('as.drawer.selectHint')}</p>
          </div>
        )}
      >
        {/* Stats row */}
        <div className={styles.stats}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}><Icon name="smart_toy" /></div>
            <div><span className={styles.statValue}>{agents.length}</span><span className={styles.statLabel}>{t('as.stats.curated')}</span></div>
          </div>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconCyan}`}><Icon name="download_done" /></div>
            <div><span className={styles.statValue}>{installedIds.size}</span><span className={styles.statLabel}>{t('as.stats.ready')}</span></div>
          </div>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconPurple}`}><Icon name="favorite" /></div>
            <div><span className={styles.statValue}>{favoriteIds.size}</span><span className={styles.statLabel}>{t('as.stats.favorites')}</span></div>
          </div>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconGreen}`}><Icon name="verified" /></div>
            <div><span className={styles.statValue}>98%</span><span className={styles.statLabel}>{t('as.stats.policy')}</span></div>
          </div>
        </div>

        {/* Agent market */}
        <div className={styles.market}>
          <div className={styles.marketHead}>
            <div>
              <div className={styles.marketSubtitle}>{t('as.catalog.title')}</div>
              <div className={styles.marketTitle}>{t('as.catalog.subtitle')}</div>
            </div>
            <div className={styles.filterSummary}>
              <Pill variant="cyan">{t('as.catalog.showing', { count: filteredAgents.length })}</Pill>
              <Button variant="ghost" size="sm" disabled={!hasActiveFilters} onClick={clearFilters}>
                <Icon name="filter_alt_off" size={16} />{t('as.catalog.clear')}
              </Button>
            </div>
          </div>

          {filteredAgents.length > 0 ? (
            <div className={styles.agentGrid}>
              {filteredAgents.map((agent) => {
                const isFav = favoriteIds.has(agent.id);
                const isInst = installedIds.has(agent.id);
                const isAddDisabled = isInst || (workspaceIsFull && !isInst);
                return (
                  <article className={`${styles.agentCard} ${isInst ? styles.agentCardInstalled : ''}`} key={agent.id}>
                    <div className={styles.cardHead}>
                      <div className={styles.cardTitle}>
                        <div className={`${styles.agentLogo} ${agent.tone === 'blue' ? styles.logoBlue : agent.tone === 'cyan' ? styles.logoCyan : agent.tone === 'purple' ? styles.logoPurple : styles.logoGreen}`}>
                          <Icon name={agent.icon} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className={styles.cardName}>{agent.name}</div>
                          <div className={styles.cardCategory}>{agent.category}</div>
                        </div>
                      </div>
                      <button className={`${styles.favBtn} ${isFav ? styles.favBtnActive : ''}`} onClick={() => toggleFavorite(agent.id)} type="button" aria-label={isFav ? `Unfavorite ${agent.name}` : `Favorite ${agent.name}`}>
                        <Icon name="favorite" filled={isFav} />
                      </button>
                    </div>
                    <p className={styles.cardCopy}>{agent.summary}</p>
                    <div className={styles.tagRow}>
                      {agent.tags.map((tag, ti) => (
                        <span className={`${styles.tag} ${ti === 1 ? styles.tagCyan : ti === 2 ? styles.tagPurple : ''}`} key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className={styles.cardMeta}>
                      <span>{t('as.agent.rating', { rating: agent.rating.toFixed(1) })}</span>
                      <span>{t('as.agent.installs', { count: formatInstalls(getDisplayInstalls(agent.id)) })}</span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>{t('as.agent.saves', { count: formatInstalls(getDisplayFavoriteCount(agent.id)) })}</span>
                      <Pill variant={isInst ? 'green' : 'cyan'}>{isInst ? t('as.agent.added') : t('as.agent.available')}</Pill>
                    </div>
                    <div className={styles.cardActions}>
                      <Button variant={isInst ? 'secondary' : 'primary'} size="sm" disabled={isAddDisabled} onClick={() => installAgent(agent.id)} style={{ flex: 1 }}>
                        <Icon name={isInst ? 'check_circle' : 'add'} size={16} />{isInst ? t('as.agent.added') : t('as.agent.add')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openAgentDetails(agent.id)} style={{ flex: 1 }}>
                        <Icon name="open_in_new" size={16} />{t('as.agent.details')}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Icon name="search_off" size={32} />
              <div className={styles.emptyTitle}>{t('as.catalog.emptyTitle')}</div>
              <div className={styles.emptyHint}>{t('as.catalog.emptyHint')}</div>
              <Button variant="primary" disabled={!hasActiveFilters} onClick={clearFilters}>{t('as.catalog.clearFilters')}</Button>
            </div>
          )}
        </div>
      </WebLayout>

      {confirmation ? (
        <div className={styles.confirmBar} role="status">
          <div className={`${styles.statIcon} ${confirmation.actionAgentId ? styles.statIconGreen : styles.statIconCyan}`}>
            <Icon name={confirmation.actionAgentId ? 'download_done' : 'tune'} />
          </div>
          <div className={styles.confirmText}>
            <span className={styles.confirmTitle}>{confirmation.title}</span>
            <span className={styles.confirmDetail}>{confirmation.message}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setConfirmation(null)}>{t('as.confirm.dismiss')}</Button>
        </div>
      ) : null}
    </div>
  );
}

export default AgentSquarePage;
