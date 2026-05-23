import { useEffect, useMemo, useRef, useState } from 'react';
import { mockRunners } from '@shared/index';

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
  {
    id: 'refactor',
    name: 'Code Refactor Pro',
    category: 'Engineering',
    icon: 'code_blocks',
    tone: 'blue',
    summary: 'Modernizes front-end and Go service modules while keeping reviewable diffs visible.',
    description:
      'Best for code cleanup passes where the workspace needs scoped patches, local conventions, and clear validation notes before review.',
    tags: ['TypeScript', 'Go', 'Review'],
    installs: 14820,
    favoriteCount: 1824,
    rating: 4.9,
    updatedDaysAgo: 6,
    outputs: ['Scoped patch plan', 'Validation checklist', 'Risk notes'],
  },
  {
    id: 'designer',
    name: 'Interface Critic',
    category: 'Design',
    icon: 'palette',
    tone: 'purple',
    summary: 'Audits tool surfaces for hierarchy, responsive density, and component states.',
    description:
      'Reviews a workbench page like a product surface: layout rhythm, accessible labels, empty states, and responsive clipping.',
    tags: ['UI audit', 'A11y', 'Layout'],
    installs: 9360,
    favoriteCount: 1211,
    rating: 4.8,
    updatedDaysAgo: 3,
    outputs: ['Visual hierarchy pass', 'A11y notes', 'Responsive risks'],
  },
  {
    id: 'qa',
    name: 'QA Flow Builder',
    category: 'Engineering',
    icon: 'fact_check',
    tone: 'cyan',
    summary: 'Creates focused checks for UI flows, command output, and API contract edges.',
    description:
      'Useful when a page or workflow needs a compact smoke plan with the right assertions and a clean handoff for testers.',
    tags: ['Playwright', 'Unit tests', 'Smoke'],
    installs: 12840,
    favoriteCount: 1506,
    rating: 4.7,
    updatedDaysAgo: 9,
    outputs: ['Smoke scenarios', 'State matrix', 'Manual QA steps'],
  },
  {
    id: 'ops',
    name: 'Runbook Operator',
    category: 'Operations',
    icon: 'terminal',
    tone: 'green',
    summary: 'Turns incidents and release notes into commands, checkpoints, and rollback prompts.',
    description:
      'Pairs well with deployment work because it keeps routine operations, checks, and escalation notes in one readable sequence.',
    tags: ['Runbook', 'Deploy', 'Monitor'],
    installs: 8700,
    favoriteCount: 984,
    rating: 4.6,
    updatedDaysAgo: 2,
    outputs: ['Command sequence', 'Rollback prompts', 'Operator handoff'],
  },
  {
    id: 'research',
    name: 'Evidence Synthesizer',
    category: 'Research',
    icon: 'travel_explore',
    tone: 'purple',
    summary: 'Groups sources into claims, caveats, contradictions, and decision notes.',
    description:
      'Helps teams move from raw references to compact conclusions while preserving the difference between evidence and inference.',
    tags: ['Sources', 'Citations', 'Summary'],
    installs: 10320,
    favoriteCount: 1398,
    rating: 4.9,
    updatedDaysAgo: 5,
    outputs: ['Claim map', 'Source trail', 'Decision summary'],
  },
  {
    id: 'release',
    name: 'Release Steward',
    category: 'Operations',
    icon: 'rocket_launch',
    tone: 'blue',
    summary: 'Collects branch status, validation commands, changelog points, and merge readiness.',
    description:
      'Keeps release coordination visible across branch status, test evidence, review notes, and handoff copy.',
    tags: ['PR', 'Validation', 'Changelog'],
    installs: 7600,
    favoriteCount: 862,
    rating: 4.5,
    updatedDaysAgo: 8,
    outputs: ['Release checklist', 'Changelog draft', 'Merge summary'],
  },
  ...mockRunners.map((runner) => ({
    id: runner.id,
    name: runner.name,
    category: 'Engineering' as AgentCategory,
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

const sortLabels: Record<SortMode, string> = {
  popular: 'Most installed',
  rating: 'Highest rated',
  recent: 'Recently updated',
};

const viewModeLabels: Record<ViewMode, string> = {
  all: 'All agents',
  favorites: 'Only favorites',
  installed: 'Only added',
};

function formatInstalls(installs: number): string {
  return `${(installs / 1000).toFixed(1)}k`;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return;
    }

    type Particle = {
      alpha: number;
      hue: number;
      radius: number;
      velocityX: number;
      velocityY: number;
      x: number;
      y: number;
    };

    let animationFrame = 0;
    let height = 0;
    let width = 0;
    let particles: Particle[] = [];

    const createParticle = (index: number): Particle => ({
      alpha: 0.18 + Math.random() * 0.2,
      hue: index % 3 === 0 ? 196 : 210,
      radius: 1.6 + Math.random() * 2.6,
      velocityX: -0.18 + Math.random() * 0.36,
      velocityY: -0.18 - Math.random() * 0.48,
      x: Math.random() * width,
      y: Math.random() * height,
    });

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: 56 }, (_, index) => createParticle(index));
    };

    const draw = () => {
      animationFrame = window.requestAnimationFrame(draw);
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.velocityX;
        particle.y += particle.velocityY;

        if (particle.y < -16) {
          particle.y = height + 16;
          particle.x = Math.random() * width;
        }

        if (particle.x < -16) {
          particle.x = width + 16;
        }

        if (particle.x > width + 16) {
          particle.x = -16;
        }

        context.beginPath();
        context.fillStyle = `hsla(${particle.hue}, 84%, 48%, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const nextParticle = particles[nextIndex];
          const dx = particle.x - nextParticle.x;
          const dy = particle.y - nextParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 126) {
            context.beginPath();
            context.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            context.lineWidth = 1;
            context.moveTo(particle.x, particle.y);
            context.lineTo(nextParticle.x, nextParticle.y);
            context.stroke();
          }
        }
      });
    };

    resize();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas aria-hidden="true" className="asr-particle-canvas" ref={canvasRef} />;
}

export function AgentSquarePageInteractive() {
  const [activeCategory, setActiveCategory] = useState<AgentCategory | 'All'>('All');
  const [detailAgentId, setDetailAgentId] = useState<string | null>(agents[0].id);
  const [isDetailOpen, setIsDetailOpen] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState(initialFavoriteIds);
  const [installedIds, setInstalledIds] = useState(initialInstalledIds);
  const [query, setQuery] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('popular');
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  const detailAgent = isDetailOpen ? agents.find((agent) => agent.id === detailAgentId) ?? null : null;
  const hasActiveFilters = activeCategory !== 'All' || query.trim().length > 0 || viewMode !== 'all';
  const workspaceIsFull = installedIds.size >= workspaceLimit;

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return agents
      .filter((agent) => activeCategory === 'All' || agent.category === activeCategory)
      .filter((agent) => {
        if (viewMode === 'favorites') {
          return favoriteIds.has(agent.id);
        }

        if (viewMode === 'installed') {
          return installedIds.has(agent.id);
        }

        return true;
      })
      .filter((agent) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [agent.name, agent.category, agent.summary, ...agent.tags].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((firstAgent, secondAgent) => {
        if (sortMode === 'rating') {
          return secondAgent.rating - firstAgent.rating || secondAgent.installs - firstAgent.installs;
        }

        if (sortMode === 'recent') {
          return firstAgent.updatedDaysAgo - secondAgent.updatedDaysAgo || secondAgent.rating - firstAgent.rating;
        }

        const firstInstalls = getDisplayInstalls(firstAgent.id);
        const secondInstalls = getDisplayInstalls(secondAgent.id);
        return secondInstalls - firstInstalls || secondAgent.rating - firstAgent.rating;
      });
  }, [activeCategory, favoriteIds, installedIds, query, sortMode, viewMode]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<AgentCategory | 'All', number>([['All', agents.length]]);

    categories.forEach((category) => {
      if (category !== 'All') {
        counts.set(
          category,
          agents.filter((agent) => agent.category === category).length,
        );
      }
    });

    return counts;
  }, []);

  function getDisplayInstalls(agentId: string): number {
    const agent = agents.find((currentAgent) => currentAgent.id === agentId);

    if (!agent) {
      return 0;
    }

    return agent.installs + (installedIds.has(agentId) && !initialInstalledIds.has(agentId) ? 1 : 0);
  }

  function getDisplayFavoriteCount(agentId: string): number {
    const agent = agents.find((currentAgent) => currentAgent.id === agentId);

    if (!agent) {
      return 0;
    }

    if (favoriteIds.has(agentId) && !initialFavoriteIds.has(agentId)) {
      return agent.favoriteCount + 1;
    }

    if (!favoriteIds.has(agentId) && initialFavoriteIds.has(agentId)) {
      return Math.max(agent.favoriteCount - 1, 0);
    }

    return agent.favoriteCount;
  }

  function clearFilters() {
    setActiveCategory('All');
    setQuery('');
    setViewMode('all');
    setConfirmation({
      id: `clear-${Date.now()}`,
      message: 'The catalog is back to the full local preview set.',
      title: 'Filters cleared',
    });
  }

  function openAgentDetails(agentId: string) {
    setDetailAgentId(agentId);
    setIsDetailOpen(true);
  }

  function toggleFavorite(agentId: string) {
    const agent = agents.find((currentAgent) => currentAgent.id === agentId);
    const wasFavorite = favoriteIds.has(agentId);

    setFavoriteIds((currentFavoriteIds) => {
      const nextFavoriteIds = new Set(currentFavoriteIds);

      if (nextFavoriteIds.has(agentId)) {
        nextFavoriteIds.delete(agentId);
      } else {
        nextFavoriteIds.add(agentId);
      }

      return nextFavoriteIds;
    });

    if (agent) {
      setConfirmation({
        actionAgentId: agent.id,
        id: `favorite-${agent.id}-${Date.now()}`,
        message: `${formatInstalls(getDisplayFavoriteCount(agent.id) + (wasFavorite ? -1 : 1))} local saves are now shown on the card.`,
        title: wasFavorite ? `${agent.name} removed from favorites` : `${agent.name} saved`,
      });
    }
  }

  function installAgent(agentId: string) {
    const agent = agents.find((currentAgent) => currentAgent.id === agentId);

    if (!agent) {
      return;
    }

    if (installedIds.has(agentId)) {
      openAgentDetails(agentId);
      setConfirmation({
        actionAgentId: agentId,
        id: `installed-${agentId}-${Date.now()}`,
        message: 'This agent is already staged in the current workspace.',
        title: `${agent.name} already added`,
      });
      return;
    }

    if (workspaceIsFull) {
      setConfirmation({
        actionAgentId: agentId,
        id: `full-${agentId}-${Date.now()}`,
        message: `The workspace limit is ${workspaceLimit} local agents. Remove one before adding another.`,
        title: 'Workspace is full',
      });
      return;
    }

    setInstalledIds((currentInstalledIds) => {
      const nextInstalledIds = new Set(currentInstalledIds);
      nextInstalledIds.add(agentId);
      return nextInstalledIds;
    });
    openAgentDetails(agentId);
    setConfirmation({
      actionAgentId: agentId,
      id: `add-${agentId}-${Date.now()}`,
      message: `${installedIds.size + 1} of ${workspaceLimit} workspace slots are now staged.`,
      title: `${agent.name} added to workspace`,
    });
  }

  return (
    <div className="asr-root">
      <style>{styles}</style>
      <ParticleCanvas />

      <div className="asr-page">
        <div className="asr-workspace">
          <aside className="asr-sidebar asr-glass">
            <div className="asr-brand">
              <span className="asr-brand-mark">AH</span>
              <div className="asr-truncate asr-title">
                <h2>AGENTHUB</h2>
                <p className="asr-brand-sub">Agent Square</p>
              </div>
            </div>

            <section className="asr-stack">
              <div className="asr-section-head">
                <h3>Navigation</h3>
                <span className="asr-pill asr-pill-cyan">
                  <span className="asr-status-dot" />
                  Local
                </span>
              </div>

              <div className="asr-nav-list">
                <button
                  className={cx('asr-nav-item', viewMode === 'all' && 'asr-active')}
                  onClick={() => setViewMode('all')}
                  type="button"
                >
                  <div className="asr-icon-tile">
                    <span className="material-symbols-outlined">storefront</span>
                  </div>
                  <div className="asr-truncate">
                    <strong className="asr-small">Marketplace</strong>
                    <p className="asr-tiny asr-muted asr-truncate">Browse installable agents</p>
                  </div>
                </button>

                <button
                  className={cx('asr-nav-item', viewMode === 'installed' && 'asr-active')}
                  onClick={() => setViewMode('installed')}
                  type="button"
                >
                  <div className="asr-icon-tile asr-cyan">
                    <span className="material-symbols-outlined">dashboard</span>
                  </div>
                  <div className="asr-truncate">
                    <strong className="asr-small">Workspace</strong>
                    <p className="asr-tiny asr-muted asr-truncate">{installedIds.size} agents added</p>
                  </div>
                </button>

                <button
                  className={cx('asr-nav-item', viewMode === 'favorites' && 'asr-active')}
                  onClick={() => setViewMode('favorites')}
                  type="button"
                >
                  <div className="asr-icon-tile asr-purple">
                    <span className="material-symbols-outlined">bookmark</span>
                  </div>
                  <div className="asr-truncate">
                    <strong className="asr-small">Favorites</strong>
                    <p className="asr-tiny asr-muted asr-truncate">{favoriteIds.size} saved agents</p>
                  </div>
                </button>
              </div>
            </section>

            <section className="asr-stack">
              <div className="asr-section-head">
                <h3>Categories</h3>
                <span className="asr-tiny asr-muted">Preview filters</span>
              </div>
              <div className="asr-category-list">
                {categories.map((category) => (
                  <button
                    className={cx('asr-category-button', activeCategory === category && 'asr-active')}
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    type="button"
                  >
                    <span>{category === 'All' ? 'All agents' : category}</span>
                    <span className={cx('asr-pill', category === 'Engineering' && 'asr-pill-cyan', category === 'Design' && 'asr-pill-purple', category === 'Operations' && 'asr-pill-green')}>
                      {categoryCounts.get(category)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="asr-sidebar-card asr-glass">
              <div className="asr-mini-row">
                <span className="asr-label asr-muted">Workspace slots</span>
                <strong className="asr-small">{installedIds.size} / {workspaceLimit}</strong>
              </div>
              <div className="asr-progress">
                <span style={{ width: `${Math.min((installedIds.size / workspaceLimit) * 100, 100)}%` }} />
              </div>
              <p className="asr-small asr-muted">Added agents are staged for the current workspace.</p>
            </section>
          </aside>

          <main className="asr-main">
            <header className="asr-topbar asr-glass">
              <div>
                <p className="asr-label asr-muted">Agent market</p>
                <h1>Find the right specialist before a run starts</h1>
                <p className="asr-small asr-muted">Search, compare, favorite, and stage agents for the workspace.</p>
              </div>

              <div className="asr-toolbar">
                <label className="asr-search">
                  <span className="material-symbols-outlined">search</span>
                  <input
                    aria-label="Search agents"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search agents or skills"
                    value={query}
                  />
                </label>

                <select
                  aria-label="Sort agents"
                  className="asr-select"
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  value={sortMode}
                >
                  {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {sortLabels[mode]}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            <section className="asr-stats">
              <div className="asr-metric-card asr-glass">
                <div className="asr-icon-tile">
                  <span className="material-symbols-outlined">smart_toy</span>
                </div>
                <div>
                  <strong>{agents.length}</strong>
                  <span className="asr-small asr-muted">Curated agents</span>
                </div>
              </div>
              <div className="asr-metric-card asr-glass">
                <div className="asr-icon-tile asr-cyan">
                  <span className="material-symbols-outlined">download_done</span>
                </div>
                <div>
                  <strong>{installedIds.size}</strong>
                  <span className="asr-small asr-muted">Workspace ready</span>
                </div>
              </div>
              <div className="asr-metric-card asr-glass">
                <div className="asr-icon-tile asr-purple">
                  <span className="material-symbols-outlined">favorite</span>
                </div>
                <div>
                  <strong>{favoriteIds.size}</strong>
                  <span className="asr-small asr-muted">Favorites</span>
                </div>
              </div>
              <div className="asr-metric-card asr-glass">
                <div className="asr-icon-tile asr-green">
                  <span className="material-symbols-outlined">verified</span>
                </div>
                <div>
                  <strong>98%</strong>
                  <span className="asr-small asr-muted">Policy checks</span>
                </div>
              </div>
            </section>

            <section className="asr-market asr-glass">
              <div className="asr-market-head">
                <div>
                  <p className="asr-label asr-muted">Agent catalog</p>
                  <h2>Installable specialists</h2>
                </div>
                <div className="asr-filter-summary">
                  <span className="asr-pill asr-pill-cyan">Showing {filteredAgents.length} agents</span>
                  <span className="asr-pill">{viewModeLabels[viewMode]}</span>
                  <button className="asr-button asr-ghost" disabled={!hasActiveFilters} onClick={clearFilters} type="button">
                    <span className="material-symbols-outlined">filter_alt_off</span>
                    Clear
                  </button>
                </div>
              </div>

              {filteredAgents.length > 0 ? (
                <div className="asr-agent-grid">
                  {filteredAgents.map((agent) => {
                  const isFavorite = favoriteIds.has(agent.id);
                  const isInstalled = installedIds.has(agent.id);
                  const isAddDisabled = isInstalled || (workspaceIsFull && !isInstalled);

                  return (
                    <article className={cx('asr-agent-card asr-glass', isInstalled && 'asr-installed')} key={agent.id}>
                      <div className="asr-card-head">
                        <div className="asr-card-title">
                          <div className={cx('asr-agent-logo', `asr-${agent.tone}`)}>
                            <span className="material-symbols-outlined">{agent.icon}</span>
                          </div>
                          <div className="asr-truncate">
                            <h3 className="asr-truncate">{agent.name}</h3>
                            <p className="asr-tiny asr-muted asr-truncate">{agent.category}</p>
                          </div>
                        </div>
                        <button
                          aria-label={isFavorite ? `Unfavorite ${agent.name}` : `Favorite ${agent.name}`}
                          className={cx('asr-icon-button', isFavorite && 'asr-is-favorite')}
                          onClick={() => toggleFavorite(agent.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined">favorite</span>
                        </button>
                      </div>

                      <p className="asr-card-copy">{agent.summary}</p>

                      <div className="asr-tag-row">
                        {agent.tags.map((tag, tagIndex) => (
                          <span className={cx('asr-tag', tagIndex === 1 && 'asr-tag-cyan', tagIndex === 2 && 'asr-tag-purple')} key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="asr-mini-row">
                        <span className="asr-small asr-muted">{agent.rating.toFixed(1)} rating</span>
                        <span className="asr-small asr-muted">{formatInstalls(getDisplayInstalls(agent.id))} installs</span>
                      </div>

                      <div className="asr-mini-row">
                        <span className="asr-small asr-muted">{formatInstalls(getDisplayFavoriteCount(agent.id))} saves</span>
                        <span className={cx('asr-pill', isInstalled ? 'asr-pill-green' : 'asr-pill-cyan')}>
                          {isInstalled ? 'Added' : 'Available'}
                        </span>
                      </div>

                      <div className="asr-card-actions">
                        <button
                          className={cx('asr-button asr-primary', isInstalled && 'asr-button-success')}
                          disabled={isAddDisabled}
                          onClick={() => installAgent(agent.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined">{isInstalled ? 'check_circle' : 'add'}</span>
                          {isInstalled ? 'Added' : 'Add'}
                        </button>
                        <button className="asr-button asr-ghost" onClick={() => openAgentDetails(agent.id)} type="button">
                          <span className="material-symbols-outlined">open_in_new</span>
                          Details
                        </button>
                      </div>
                    </article>
                  );
                  })}
                </div>
              ) : (
                <div className="asr-empty-state">
                  <div className="asr-icon-tile asr-purple">
                    <span className="material-symbols-outlined">search_off</span>
                  </div>
                  <div>
                    <h3>No agents match this view</h3>
                    <p className="asr-small asr-muted">Try another category, remove the search text, or clear the local filters.</p>
                  </div>
                  <button className="asr-button asr-primary" disabled={!hasActiveFilters} onClick={clearFilters} type="button">
                    <span className="material-symbols-outlined">filter_alt_off</span>
                    Clear filters
                  </button>
                </div>
              )}
            </section>
          </main>

          <aside className="asr-drawer asr-glass">
            {detailAgent ? (
              <>
                <div className="asr-drawer-header">
                  <div>
                    <p className="asr-label asr-muted">Agent detail</p>
                    <h2>{detailAgent.name}</h2>
                  </div>
                  <button className="asr-icon-button" onClick={() => setIsDetailOpen(false)} type="button" aria-label="Close detail drawer">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <section className="asr-stack">
                  <div className="asr-drawer-hero">
                    <div className={cx('asr-agent-logo', `asr-${detailAgent.tone}`)}>
                      <span className="material-symbols-outlined">{detailAgent.icon}</span>
                    </div>
                    <div>
                      <span className="asr-pill asr-pill-cyan">{detailAgent.category}</span>
                      <p className="asr-small asr-muted">{detailAgent.summary}</p>
                    </div>
                  </div>
                  <p className="asr-small asr-muted">{detailAgent.description}</p>
                  <div className="asr-mini-row">
                    <span className="asr-small asr-muted">Rating</span>
                    <strong className="asr-small">{detailAgent.rating.toFixed(1)} / 5</strong>
                  </div>
                  <div className="asr-mini-row">
                    <span className="asr-small asr-muted">Installs</span>
                    <strong className="asr-small">{formatInstalls(getDisplayInstalls(detailAgent.id))}</strong>
                  </div>
                  <div className="asr-mini-row">
                    <span className="asr-small asr-muted">Favorites</span>
                    <strong className="asr-small">{formatInstalls(getDisplayFavoriteCount(detailAgent.id))}</strong>
                  </div>
                </section>

                <section className="asr-stack">
                  <div className="asr-section-head">
                    <h3>Expected output</h3>
                    <span className="asr-pill asr-pill-purple">Preview</span>
                  </div>
                  <div className="asr-tool-list">
                    {detailAgent.outputs.map((output, outputIndex) => (
                      <div className="asr-tool-row" key={output}>
                        <div className={cx('asr-icon-tile', outputIndex === 1 && 'asr-cyan', outputIndex === 2 && 'asr-purple')}>
                          <span className="material-symbols-outlined">{outputIndex === 0 ? 'difference' : outputIndex === 1 ? 'checklist' : 'notes'}</span>
                        </div>
                        <div>
                          <strong className="asr-small">{output}</strong>
                          <p className="asr-tiny asr-muted">Visible in the workspace handoff after staging.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="asr-stack">
                  <div className="asr-section-head">
                    <h3>Workspace state</h3>
                    <span className={cx('asr-pill', installedIds.has(detailAgent.id) ? 'asr-pill-green' : 'asr-pill-cyan')}>
                      {installedIds.has(detailAgent.id) ? 'Added' : 'Available'}
                    </span>
                  </div>
                  <div className="asr-activity-list">
                    <div className="asr-activity-row">
                      <div className="asr-icon-tile asr-purple">
                        <span className="material-symbols-outlined">favorite</span>
                      </div>
                      <div>
                        <strong className="asr-small">{favoriteIds.has(detailAgent.id) ? 'Saved to favorites' : 'Not favorited'}</strong>
                        <p className="asr-tiny asr-muted">Favorite state updates immediately on the card.</p>
                      </div>
                    </div>
                    <div className="asr-activity-row">
                      <div className="asr-icon-tile asr-green">
                        <span className="material-symbols-outlined">download_done</span>
                      </div>
                      <div>
                        <strong className="asr-small">{installedIds.has(detailAgent.id) ? 'Ready in workspace' : 'Ready to add'}</strong>
                        <p className="asr-tiny asr-muted">Install state changes the card action and summary count.</p>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <div className="asr-drawer-empty">
                <div className="asr-icon-tile asr-cyan">
                  <span className="material-symbols-outlined">ads_click</span>
                </div>
                <h2>Select an agent</h2>
                <p className="asr-small asr-muted">Open details from any visible card to compare output, rating, install count, and workspace state.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {confirmation ? (
        <div className="asr-confirm-bar asr-glass" role="status">
          <div className={cx('asr-icon-tile', confirmation.actionAgentId ? 'asr-green' : 'asr-cyan')}>
            <span className="material-symbols-outlined">{confirmation.actionAgentId ? 'download_done' : 'tune'}</span>
          </div>
          <div className="asr-truncate">
            <strong className="asr-small">{confirmation.title}</strong>
            <p className="asr-tiny asr-muted asr-truncate">{confirmation.message}</p>
          </div>
          <button className="asr-button asr-ghost" onClick={() => setConfirmation(null)} type="button">
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

const styles = `
  @import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap");
  @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap");

  .asr-root {
    --asr-bg: #edf6ff;
    --asr-bg-soft: #f7fbff;
    --asr-ink: #172033;
    --asr-muted: #667085;
    --asr-line: rgba(133, 153, 184, 0.22);
    --asr-blue: #1769e8;
    --asr-cyan: #08a7cf;
    --asr-purple: #7457e8;
    --asr-green: #1d9b67;
    --asr-glass: rgba(255, 255, 255, 0.72);
    --asr-glass-border: rgba(255, 255, 255, 0.7);
    --asr-shadow: 0 18px 48px rgba(26, 40, 80, 0.14);
    min-height: 100vh;
    color: var(--asr-ink);
    background:
      radial-gradient(circle at 18% 12%, rgba(8, 167, 207, 0.16), transparent 28%),
      radial-gradient(circle at 82% 8%, rgba(116, 87, 232, 0.14), transparent 30%),
      linear-gradient(135deg, #f7fbff, #edf6ff);
    font-family: "Hanken Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }

  .asr-root *,
  .asr-root *::before,
  .asr-root *::after {
    box-sizing: border-box;
  }

  .asr-root button,
  .asr-root input,
  .asr-root select {
    font: inherit;
  }

  .asr-root button {
    cursor: pointer;
  }

  .asr-root button:disabled {
    cursor: not-allowed;
  }

  .asr-root h1,
  .asr-root h2,
  .asr-root h3,
  .asr-root p {
    margin: 0;
  }

  .asr-root h1 {
    font-size: 27px;
    line-height: 1.1;
    letter-spacing: 0;
  }

  .asr-title h2 {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
    color: #172033;
  }

  .asr-root h3 {
    font-size: 15px;
    line-height: 1.25;
    letter-spacing: 0;
  }

  .asr-particle-canvas {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
  }

  .asr-page {
    position: relative;
    z-index: 1;
    height: 100vh;
    padding: 18px;
  }

  .asr-workspace {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 316px;
    gap: 18px;
    height: calc(100vh - 44px);
    width: 100%;
  }

  .asr-glass {
    background: var(--asr-glass);
    border: 1px solid var(--asr-glass-border);
    border-radius: 12px;
    box-shadow: var(--asr-shadow);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
  }

  .asr-sidebar,
  .asr-main,
  .asr-drawer {
    display: flex;
    min-height: 0;
    flex-direction: column;
  }

  .asr-sidebar,
  .asr-drawer {
    gap: 16px;
    overflow: auto;
    padding: 18px;
  }

  .asr-main {
    gap: 16px;
    overflow: hidden;
  }

  .asr-muted {
    color: var(--asr-muted);
  }

  .asr-tiny {
    font-size: 11px;
    line-height: 1.35;
    letter-spacing: 0;
  }

  .asr-small {
    font-size: 12px;
    line-height: 1.45;
    letter-spacing: 0;
  }

  .asr-label {
    font-size: 11px;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    margin: 0 0 4px;
  }

  .asr-title .asr-brand-sub {
    margin: 0;
    color: var(--asr-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    line-height: 1.236;
  }

  .asr-root .material-symbols-outlined {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    overflow: hidden;
    font-size: 18px;
    line-height: 1;
    vertical-align: middle;
    font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 24;
  }

  .asr-brand,
  .asr-section-head,
  .asr-mini-row,
  .asr-card-head,
  .asr-card-actions,
  .asr-topbar,
  .asr-toolbar,
  .asr-market-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .asr-brand {
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    gap: 10px;
  }

  .asr-section-head,
  .asr-mini-row,
  .asr-topbar,
  .asr-market-head {
    justify-content: space-between;
  }

  .asr-brand-mark,
  .asr-icon-tile,
  .asr-agent-logo,
  .asr-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .asr-brand-mark {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: #fff;
    font-weight: 900;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--asr-blue), var(--asr-cyan));
    box-shadow: 0 10px 22px rgba(23, 105, 232, 0.24);
  }

  .asr-truncate {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .asr-stack,
  .asr-nav-list,
  .asr-category-list,
  .asr-tool-list,
  .asr-activity-list {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 10px;
  }

  .asr-nav-item,
  .asr-category-button,
  .asr-tool-row,
  .asr-activity-row,
  .asr-metric-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 10px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.46);
    color: var(--asr-ink);
  }

  .asr-active {
    border-color: rgba(23, 105, 232, 0.2);
    background: rgba(23, 105, 232, 0.1);
    color: #1459c7;
  }

  .asr-nav-item {
    width: 100%;
    text-align: left;
  }

  .asr-category-button {
    width: 100%;
    justify-content: space-between;
    text-align: left;
  }

  .asr-icon-tile,
  .asr-agent-logo {
    width: 34px;
    height: 34px;
    color: var(--asr-blue);
    border-radius: 10px;
    background: rgba(23, 105, 232, 0.1);
  }

  .asr-agent-logo {
    width: 40px;
    height: 40px;
  }

  .asr-cyan {
    color: #087f9e;
    background: rgba(8, 167, 207, 0.11);
  }

  .asr-purple {
    color: #6044d7;
    background: rgba(116, 87, 232, 0.11);
  }

  .asr-green {
    color: #15744b;
    background: rgba(29, 155, 103, 0.11);
  }

  .asr-blue {
    color: var(--asr-blue);
    background: rgba(23, 105, 232, 0.1);
  }

  .asr-pill,
  .asr-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 5px 9px;
    border: 1px solid rgba(23, 105, 232, 0.13);
    border-radius: 999px;
    background: rgba(23, 105, 232, 0.08);
    color: #1459c7;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  }

  .asr-pill-cyan,
  .asr-tag-cyan {
    border-color: rgba(8, 167, 207, 0.18);
    background: rgba(8, 167, 207, 0.1);
    color: #087f9e;
  }

  .asr-pill-purple,
  .asr-tag-purple {
    border-color: rgba(116, 87, 232, 0.18);
    background: rgba(116, 87, 232, 0.1);
    color: #6044d7;
  }

  .asr-pill-green {
    border-color: rgba(29, 155, 103, 0.2);
    background: rgba(29, 155, 103, 0.11);
    color: #15744b;
  }

  .asr-status-dot {
    display: inline-flex;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--asr-green);
    box-shadow: 0 0 0 4px rgba(29, 155, 103, 0.12);
  }

  .asr-sidebar-card {
    margin-top: auto;
    padding: 12px;
  }

  .asr-progress {
    width: 100%;
    height: 7px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(23, 105, 232, 0.11);
  }

  .asr-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--asr-blue), var(--asr-cyan), var(--asr-purple));
  }

  .asr-topbar {
    min-height: 104px;
    padding: 18px 20px;
  }

  .asr-toolbar {
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .asr-search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(340px, 100%);
    min-height: 38px;
    padding: 8px 11px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.58);
    color: var(--asr-muted);
  }

  .asr-search input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--asr-ink);
  }

  .asr-select {
    min-height: 38px;
    padding: 8px 34px 8px 11px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 8px;
    outline: 0;
    background: rgba(255, 255, 255, 0.62);
    color: var(--asr-ink);
    font-size: 12px;
    font-weight: 800;
  }

  .asr-button,
  .asr-icon-button {
    border: 1px solid rgba(23, 105, 232, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.62);
    color: var(--asr-ink);
    box-shadow: 0 8px 18px rgba(26, 40, 80, 0.08);
  }

  .asr-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 38px;
    padding: 9px 12px;
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
  }

  .asr-primary {
    border-color: transparent;
    color: #fff;
    background: linear-gradient(135deg, var(--asr-blue), var(--asr-cyan));
    box-shadow: 0 10px 22px rgba(23, 105, 232, 0.23);
  }

  .asr-button-success {
    background: linear-gradient(135deg, var(--asr-green), var(--asr-cyan));
  }

  .asr-ghost,
  .asr-icon-button {
    box-shadow: none;
  }

  .asr-button:disabled,
  .asr-icon-button:disabled {
    opacity: 0.62;
  }

  .asr-icon-button {
    width: 34px;
    height: 34px;
    padding: 0;
  }

  .asr-is-favorite,
  .asr-is-favorite .material-symbols-outlined {
    color: #fff;
    border-color: transparent;
    background: linear-gradient(135deg, var(--asr-purple), var(--asr-blue));
    font-variation-settings: "FILL" 1, "wght" 600, "GRAD" 0, "opsz" 24;
  }

  .asr-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(120px, 1fr));
    gap: 10px;
  }

  .asr-metric-card {
    align-items: flex-start;
    padding: 12px;
  }

  .asr-metric-card strong {
    display: block;
    margin-bottom: 4px;
    font-size: 20px;
    line-height: 1;
  }

  .asr-market {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
    padding: 16px;
  }

  .asr-filter-summary {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  .asr-agent-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(230px, 1fr));
    gap: 14px;
    overflow: auto;
    padding: 2px 4px 6px 2px;
  }

  .asr-agent-card {
    display: flex;
    min-height: 238px;
    flex-direction: column;
    gap: 12px;
    padding: 15px;
    border-radius: 12px;
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
  }

  .asr-agent-card:hover {
    transform: translateY(-2px);
    border-color: rgba(23, 105, 232, 0.24);
    box-shadow: 0 22px 54px rgba(26, 40, 80, 0.16);
  }

  .asr-card-head {
    align-items: flex-start;
    justify-content: space-between;
  }

  .asr-card-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .asr-card-copy {
    min-height: 58px;
    color: var(--asr-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .asr-tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .asr-card-actions {
    justify-content: space-between;
    margin-top: auto;
  }

  .asr-card-actions .asr-button {
    flex: 1;
  }

  .asr-installed {
    border-color: rgba(29, 155, 103, 0.28);
  }

  .asr-empty-state,
  .asr-drawer-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    flex-direction: column;
    gap: 12px;
    padding: 28px;
    border: 1px dashed rgba(23, 105, 232, 0.22);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.42);
    text-align: center;
  }

  .asr-drawer-empty {
    flex: 1;
    min-height: 0;
  }

  .asr-drawer-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--asr-line);
  }

  .asr-drawer-hero {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .asr-drawer-hero .asr-agent-logo {
    width: 44px;
    height: 44px;
  }

  .asr-tool-row,
  .asr-activity-row {
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.52);
  }

  .asr-confirm-bar {
    position: fixed;
    left: 50%;
    bottom: 22px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(560px, calc(100vw - 44px));
    padding: 12px 14px;
    transform: translateX(-50%);
  }

  @media (max-width: 1180px) {
    .asr-workspace {
      grid-template-columns: 220px minmax(0, 1fr);
    }

    .asr-drawer {
      display: none;
    }

    .asr-agent-grid {
      grid-template-columns: repeat(2, minmax(230px, 1fr));
    }
  }

  @media (max-width: 820px) {
    .asr-root {
      overflow: auto;
    }

    .asr-page {
      height: auto;
      min-height: 100vh;
      padding: 14px;
    }

    .asr-workspace {
      display: flex;
      height: auto;
      flex-direction: column;
    }

    .asr-topbar,
    .asr-market-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .asr-filter-summary {
      justify-content: flex-start;
    }

    .asr-toolbar,
    .asr-search {
      width: 100%;
    }

    .asr-stats,
    .asr-agent-grid {
      grid-template-columns: 1fr;
    }

    .asr-market,
    .asr-agent-grid {
      overflow: visible;
    }
  }
`;

export default AgentSquarePageInteractive;
