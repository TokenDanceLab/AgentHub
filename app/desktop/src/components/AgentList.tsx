import { useTranslation } from 'react-i18next';
import { Search, Terminal } from 'lucide-react';
import { useState, useMemo, memo, type ReactNode } from 'react';
import type { AgentInfo } from '@shared/types';
import { Anthropic, OpenAI } from '@lobehub/icons';
import styles from './AgentList.module.css';

function agentIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  if (n.includes('claude')) return <Anthropic size={18} />;
  if (n.includes('codex') || n.includes('openai')) return <OpenAI size={18} />;
  if (n.includes('opencode')) return <Terminal size={16} strokeWidth={1.8} />;
  return null;
}

interface Props {
  agents: AgentInfo[];
  online: boolean;
  selectedId?: string;
  onSelect?: (agent: AgentInfo) => void;
}

export default memo(function AgentList({ agents, online, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, searchQuery]);

  function highlightMatch(text: string): React.ReactNode {
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
  const isSearchEmpty = !isEmpty && filteredAgents.length === 0;

  return (
    <nav className={styles.sidebar} aria-label={t('agent.title')}>
      <div className={styles.title}>{t('agent.title')}</div>

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
        <div className={styles.empty}>
          {online ? t('agent.emptyOnline') : t('agent.emptyOffline')}
        </div>
      ) : isSearchEmpty ? (
        <div className={styles.empty}>{t('agent.noMatch')}</div>
      ) : (
        <ul className={styles.list}>
          {filteredAgents.map((a) => (
            <li key={a.id}>
              <button
                className={`${styles.item} ${a.id === selectedId ? styles.selected : ''}`}
                onClick={() => onSelect?.(a)}
                aria-pressed={a.id === selectedId}
              >
                {agentIcon(a.name) || (
                  <span
                    className={styles.statusDot}
                    style={{
                      backgroundColor:
                        a.status === 'available' ? 'var(--color-success)' : 'var(--color-danger)',
                    }}
                  />
                )}
                <div className={styles.info}>
                  <div className={styles.name}>{highlightMatch(a.name)}</div>
                  {a.description && (
                    <div className={styles.description}>{a.description}</div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
});
