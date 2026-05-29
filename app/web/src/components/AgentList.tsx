import { useTranslation } from 'react-i18next';
import { MapPin, Search, Settings2, Sparkles } from 'lucide-react';
import { useState, useMemo, memo, type ReactNode } from 'react';
import type { AgentInfo } from '@shared/types';
import { EmptyState } from '@shared/ui';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import styles from './AgentList.module.css';

const RUNTIME_ORDER = ['codex', 'claude', 'opencode'];

function agentIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  if (n.includes('claude')) return <ClaudeCode size={20} />;
  if (n.includes('codex')) return <Codex size={20} />;
  if (n.includes('opencode')) return <OpenCode size={20} />;
  return null;
}

function runtimeRank(agent: AgentInfo): number {
  const n = agent.name.toLowerCase();
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
          title={online ? t('agent.emptyOnline') : t('agent.emptyOffline')}
          description={online ? t('agent.emptyOnlineDescription') : t('agent.emptyOfflineDescription')}
          icon={<Sparkles size={16} />}
          titleLevel={3}
          className={styles.emptyState ?? ''}
          contentClassName={styles.emptyStateContent ?? ''}
          iconClassName={styles.emptyStateIcon ?? ''}
          titleClassName={styles.emptyStateTitle ?? ''}
          descriptionClassName={styles.emptyStateDescription ?? ''}
        />
      ) : isSearchEmpty ? (
        <EmptyState
          title={t('agent.noMatch')}
          description={t('agent.noMatchDescription')}
          titleLevel={3}
          className={styles.emptyState ?? ''}
          contentClassName={styles.emptyStateContent ?? ''}
          titleClassName={styles.emptyStateTitle ?? ''}
          descriptionClassName={styles.emptyStateDescription ?? ''}
        />
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
                  <div className={styles.metaLine}>
                    {a.version && <span className={styles.version}>{a.version}</span>}
                    <span className={styles.runtimeMeta}>
                      <MapPin size={10} aria-hidden="true" />
                      {a.runtimeId ?? t('agent.runtime.hubProfile')}
                    </span>
                    <span className={styles.runtimeMeta}>{t('agent.runtime.cliAdapter')}</span>
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
