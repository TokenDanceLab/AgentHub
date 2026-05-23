import { useState } from 'react';
import {
  Search,
  Code,
  CheckCircle,
  Network,
  SlidersHorizontal,
  ExternalLink,
  Rocket,
} from 'lucide-react';
import styles from './AgentSquarePage.module.css';

/* ── Types ──────────────────────────────────────────────────────────── */
type Category = 'All' | 'Coding' | 'Review' | 'Orchestrator' | 'Custom';

interface AgentCard {
  id: string;
  name: string;
  initials: string;
  category: Exclude<Category, 'All'>;
  description: string;
  tags: string[];
  status: 'online' | 'busy' | 'offline';
  installs: number;
  rating: number;
  avatarColor: 'blue' | 'green' | 'purple' | 'orange';
}

interface FilterTab {
  key: Category;
  label: string;
  icon: typeof Search | null;
}

/* ── Mock Data ──────────────────────────────────────────────────────── */
const filterTabs: FilterTab[] = [
  { key: 'All', label: 'All', icon: null },
  { key: 'Coding', label: 'Coding', icon: Code },
  { key: 'Review', label: 'Review', icon: CheckCircle },
  { key: 'Orchestrator', label: 'Orchestrator', icon: Network },
  { key: 'Custom', label: 'Custom', icon: SlidersHorizontal },
];

const agents: AgentCard[] = [
  {
    id: 'agent-refactor',
    name: 'Code Refactor Pro',
    initials: 'CR',
    category: 'Coding',
    description: 'Modernizes front-end and Go service modules while keeping reviewable diffs visible.',
    tags: ['streaming', 'toolCalls', 'fileChanges'],
    status: 'online',
    installs: 14820,
    rating: 4.9,
    avatarColor: 'blue',
  },
  {
    id: 'agent-security',
    name: 'Security Reviewer',
    initials: 'SR',
    category: 'Review',
    description: 'Audits code for security vulnerabilities and provides fix recommendations.',
    tags: ['toolCalls', 'fileChanges'],
    status: 'busy',
    installs: 9360,
    rating: 4.8,
    avatarColor: 'green',
  },
  {
    id: 'agent-workflow',
    name: 'Workflow Orchestrator',
    initials: 'WO',
    category: 'Orchestrator',
    description: 'Coordinates multi-agent workflows across complex delivery pipelines.',
    tags: ['streaming', 'toolCalls', 'multi-agent'],
    status: 'online',
    installs: 12840,
    rating: 4.7,
    avatarColor: 'purple',
  },
  {
    id: 'agent-custom-react',
    name: 'Custom React Builder',
    initials: 'RB',
    category: 'Custom',
    description: 'Builds custom React components and hooks on demand from specifications.',
    tags: ['streaming', 'fileChanges'],
    status: 'offline',
    installs: 8700,
    rating: 4.6,
    avatarColor: 'orange',
  },
  {
    id: 'agent-test-gen',
    name: 'Test Suite Generator',
    initials: 'TG',
    category: 'Coding',
    description: 'Generates comprehensive test suites with edge case coverage.',
    tags: ['streaming', 'toolCalls', 'fileChanges'],
    status: 'online',
    installs: 10320,
    rating: 4.9,
    avatarColor: 'blue',
  },
  {
    id: 'agent-pr-bot',
    name: 'PR Merger Bot',
    initials: 'PM',
    category: 'Orchestrator',
    description: 'Automates PR reviews, CI checks, and merge coordination.',
    tags: ['toolCalls', 'multi-agent'],
    status: 'busy',
    installs: 7600,
    rating: 4.5,
    avatarColor: 'purple',
  },
];

/* ── Helpers ────────────────────────────────────────────────────────── */
function avatarColorClass(color: AgentCard['avatarColor']): string {
  switch (color) {
    case 'blue': return styles.avatarBlue;
    case 'green': return styles.avatarGreen;
    case 'purple': return styles.avatarPurple;
    case 'orange': return styles.avatarOrange;
    default: return styles.avatarBlue;
  }
}

function statusDotClass(status: AgentCard['status']): string {
  switch (status) {
    case 'online': return styles.dotOnline;
    case 'busy': return styles.dotBusy;
    case 'offline': return styles.dotOffline;
    default: return styles.dotOnline;
  }
}

function statusLabel(status: AgentCard['status']): string {
  switch (status) {
    case 'online': return 'Online';
    case 'busy': return 'Busy';
    case 'offline': return 'Offline';
    default: return 'Unknown';
  }
}

function formatInstalls(count: number): string {
  return `${(count / 1000).toFixed(1)}k`;
}

/* ── Component ──────────────────────────────────────────────────────── */
export default function AgentSquarePage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = agents.filter((agent) => {
    const matchesCategory =
      activeCategory === 'All' || agent.category === activeCategory;
    const matchesSearch =
      !searchQuery ||
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const categoryCounts: Record<Category, number> = {
    All: agents.length,
    Coding: agents.filter((a) => a.category === 'Coding').length,
    Review: agents.filter((a) => a.category === 'Review').length,
    Orchestrator: agents.filter((a) => a.category === 'Orchestrator').length,
    Custom: agents.filter((a) => a.category === 'Custom').length,
  };

  return (
    <div className={styles.root}>
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Agent Square</h1>
          <p className={styles.pageSubtitle}>
            Browse, search, and deploy agents to your workspace.
          </p>
        </div>

        {/* Search */}
        <div className={styles.searchBar}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search agents or skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search agents"
          />
        </div>

        {/* Filter Tabs */}
        <div className={styles.filterBar} role="tablist" aria-label="Agent categories">
          {filterTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeCategory;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                className={`${styles.filterTab} ${isActive ? styles.filterTabActive : ''}`}
                onClick={() => setActiveCategory(tab.key)}
              >
                {Icon && <Icon size={14} />}
                <span>{tab.label}</span>
                <span className={styles.filterCount}>{categoryCounts[tab.key]}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Agent Grid ───────────────────────────────────────────────── */}
      <div className={styles.grid}>
        {filteredAgents.length > 0 ? (
          filteredAgents.map((agent) => (
            <article key={agent.id} className={styles.card}>
              {/* Card Header: Avatar + Name + Status Dot */}
              <div className={styles.cardHeader}>
                <div
                  className={`${styles.cardAvatar} ${avatarColorClass(agent.avatarColor)}`}
                  aria-hidden="true"
                >
                  {agent.initials}
                </div>
                <div className={styles.cardTitle}>
                  <div className={styles.cardName}>{agent.name}</div>
                  <div className={styles.cardCategory}>{agent.category}</div>
                </div>
                <span
                  className={`${styles.statusDot} ${statusDotClass(agent.status)}`}
                  title={statusLabel(agent.status)}
                  aria-label={`Agent status: ${statusLabel(agent.status)}`}
                />
              </div>

              {/* Description */}
              <p className={styles.cardDesc}>{agent.description}</p>

              {/* Tags */}
              <div className={styles.tags}>
                {agent.tags.map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>

              {/* Stats */}
              <div className={styles.cardStats}>
                <span>{formatInstalls(agent.installs)} installs</span>
                <span>{agent.rating.toFixed(1)} rating</span>
              </div>

              {/* Actions */}
              <div className={styles.cardActions}>
                <button className={`${styles.cardBtn} ${styles.btnView}`}>
                  <ExternalLink size={14} />
                  View
                </button>
                <button className={`${styles.cardBtn} ${styles.btnDeploy}`}>
                  <Rocket size={14} />
                  Deploy
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className={styles.emptyState}>
            <Search size={40} className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>No agents found</div>
            <div className={styles.emptyText}>
              Try adjusting your search or switching categories.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
