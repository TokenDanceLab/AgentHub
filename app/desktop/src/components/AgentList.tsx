import { useTranslation } from 'react-i18next';
import { Search, Settings2, Sparkles } from 'lucide-react';
import { useState, useMemo, memo, type ReactNode } from 'react';
import type { AgentInfo } from '@shared/types';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import styles from './AgentList.module.css';

function agentIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  if (n.includes('claude')) return <ClaudeCode size={20} />;
  if (n.includes('codex')) return <Codex size={20} />;
  if (n.includes('opencode')) return <OpenCode size={20} />;
  return null;
}

type CapabilityKey = keyof AgentInfo['capabilities'];

const CAPABILITY_KEYS: CapabilityKey[] = ['streaming', 'toolCalls', 'fileChanges', 'thinkingVisible', 'multiTurn'];

function capabilityLabelKey(key: CapabilityKey) {
  if (key === 'thinkingVisible') return 'agent.capability.thinking';
  return `agent.capability.${key}`;
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
  const isSearchEmpty = !isEmpty && filteredAgents.length === 0;
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
        <div className={styles.empty}>
          <Sparkles size={16} />
          <span>{online ? t('agent.emptyOnline') : t('agent.emptyOffline')}</span>
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
                  {a.description && (
                    <div className={styles.description}>{a.description}</div>
                  )}
                  <div className={styles.metaLine}>
                    {a.version && <span className={styles.version}>{a.version}</span>}
                    {CAPABILITY_KEYS.filter((key) => a.capabilities[key]).slice(0, 3).map((key) => (
                      <span key={key} className={styles.capability}>
                        {t(capabilityLabelKey(key))}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
});
