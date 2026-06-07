import { useTranslation } from 'react-i18next';
import { Network, Search, Settings2, Sparkles } from 'lucide-react';
import { useState, useMemo, memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { AgentInfo } from '@shared/types';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import { EmptyState } from '@shared/ui';
import styles from './AgentList.module.css';

const RUNTIME_ORDER = ['orchestrator', 'codex', 'claude', 'opencode'];

function DecorativeRuntimeIcon({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll('title').forEach((node) => node.remove());
  });

  return (
    <span ref={ref} className={styles.decorativeIcon} aria-hidden="true">
      {children}
    </span>
  );
}

function agentIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  if (n.includes('orchestrator')) return <Network size={18} />;
  if (n.includes('claude')) return <DecorativeRuntimeIcon><ClaudeCode size={20} /></DecorativeRuntimeIcon>;
  if (n.includes('codex')) return <DecorativeRuntimeIcon><Codex size={20} /></DecorativeRuntimeIcon>;
  if (n.includes('opencode')) return <DecorativeRuntimeIcon><OpenCode size={20} /></DecorativeRuntimeIcon>;
  return null;
}

function runtimeRank(agent: AgentInfo): number {
  const n = `${agent.id} ${agent.name}`.toLowerCase();
  const idx = RUNTIME_ORDER.findIndex((key) => n.includes(key));
  return idx === -1 ? RUNTIME_ORDER.length : idx;
}

interface Props {
  agents: AgentInfo[];
  online: boolean;
  selectedId?: string;
  onSelect?: (agentId: string) => void;
}

export default memo(function AgentList({ agents, online, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [otherExpanded, setOtherExpanded] = useState(false);

  const { primaryAgents, otherAgents } = useMemo(() => {
    const ordered = [...agents].sort((a, b) => {
      const rankDiff = runtimeRank(a) - runtimeRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });
    const primary = ordered.filter((a) => runtimeRank(a) < RUNTIME_ORDER.length);
    const other = ordered.filter((a) => runtimeRank(a) >= RUNTIME_ORDER.length);
    return { primaryAgents: primary, otherAgents: other };
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const visibleAgents = otherExpanded ? [...primaryAgents, ...otherAgents] : primaryAgents;
    if (!searchQuery.trim()) return visibleAgents;
    const q = searchQuery.toLowerCase();
    return visibleAgents.filter((a) => a.name.toLowerCase().includes(q));
  }, [otherAgents, otherExpanded, primaryAgents, searchQuery]);

  function highlightMatch(text: string): ReactNode {
    if (!searchQuery.trim()) return text;
    const q = searchQuery.trim();
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className={styles.highlight}>{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  const isEmpty = agents.length === 0;
  const isSearchEmpty = !isEmpty && filteredAgents.length === 0 && (searchQuery.trim() || otherAgents.length === 0);
  const availableCount = agents.filter((a) => a.status === 'available').length;

  return (
    <nav className={styles.sidebar} aria-label={t('agent.title')}>
      <div className={styles.title}>
        <span>{t('agent.title')}</span>
        <span className={styles.countPill}>{online ? `${availableCount}/${agents.length}` : t('agent.offline')}</span>
      </div>

      <div className={styles.searchWrapper}>
        <Search size={14} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder={t('agent.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t('agent.search')}
        />
      </div>

      {isEmpty ? (
        <EmptyState
          {...(styles.sidebarEmpty ? { className: styles.sidebarEmpty } : {})}
          titleLevel={3}
          icon={
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="10" y="14" width="28" height="22" rx="4" />
              <circle cx="19" cy="24" r="2.5" />
              <circle cx="29" cy="24" r="2.5" />
              <path d="M18 31c0 0 2.5 3 6 3s6-3 6-3" />
              <line x1="24" y1="8" x2="24" y2="14" />
              <circle cx="24" cy="7" r="2" />
            </svg>
          }
          title={t('agent.emptyTitle')}
          description={online ? t('agent.emptyOnline') : t('agent.emptyOffline')}
        />
      ) : isSearchEmpty ? (
        <div className={styles.empty}>{t('agent.noMatch')}</div>
      ) : (
        <ul className={styles.list}>
          {filteredAgents.map((a) => (
            <li key={a.id}>
              <button
                className={`${styles.item} ${a.id === selectedId ? styles.selected : ''}`}
                onClick={() => onSelect?.(a.id)}
                aria-pressed={a.id === selectedId}
                disabled={a.status !== 'available'}
              >
                <span className={styles.avatar}>
                  {agentIcon(a.name) || <Settings2 size={17} />}
                  <span className={`${styles.statusDot} ${styles[`status_${a.status}`]}`} />
                </span>
                <div className={styles.info}>
                  <div className={styles.nameLine}>
                    <span className={styles.name}>{highlightMatch(a.name)}</span>
                    <span className={`${styles.statusText} ${styles[`statusText_${a.status}`]}`}>
                      {t(`agent.status.${a.status}`)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
          {otherAgents.length > 0 && !searchQuery.trim() && (
            <li>
              <button
                type="button"
                className={styles.otherToggle}
                onClick={() => setOtherExpanded((v) => !v)}
                aria-expanded={otherExpanded}
              >
                <span>{t('agent.runtime.other')}</span>
                <span className={styles.otherCount}>{otherAgents.length}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </nav>
  );
});
