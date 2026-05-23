import { useTranslation } from 'react-i18next';
import { Circle, Search } from 'lucide-react';
import { useState, useMemo, memo } from 'react';
import type { AgentInfo } from '@shared/types';
import styles from './AgentList.module.css';

interface Props {
  agents: AgentInfo[];
  online: boolean;
  selectedId?: string;
  onSelect?: (agent: AgentInfo) => void;
}

interface CapItem {
  label: string;
  key: string;
}

function capabilityItems(caps: AgentInfo['capabilities'], t: (key: string) => string): CapItem[] {
  const items: CapItem[] = [];
  if (caps.streaming) items.push({ label: t('agent.capability.streaming'), key: 'streaming' });
  if (caps.toolCalls) items.push({ label: t('agent.capability.toolCalls'), key: 'toolCalls' });
  if (caps.fileChanges) items.push({ label: t('agent.capability.fileChanges'), key: 'fileChanges' });
  if (caps.thinkingVisible) items.push({ label: t('agent.capability.thinking'), key: 'thinkingVisible' });
  if (caps.multiTurn) items.push({ label: t('agent.capability.multiTurn'), key: 'multiTurn' });
  return items;
}

const capColorClass: Record<string, string> = {
  streaming: styles.tagStreaming,
  toolCalls: styles.tagToolCalls,
  fileChanges: styles.tagFileChanges,
  thinkingVisible: styles.tagThinking,
  multiTurn: styles.tagMultiTurn,
};

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
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search agents"
        />
      </div>

      {isEmpty ? (
        <div className={styles.empty}>
          {online ? t('agent.emptyOnline') : t('agent.emptyOffline')}
        </div>
      ) : isSearchEmpty ? (
        <div className={styles.empty}>No agents match your search</div>
      ) : (
        <ul className={styles.list}>
          {filteredAgents.map((a) => (
            <li key={a.id}>
              <button
                className={`${styles.item} ${a.id === selectedId ? styles.selected : ''}`}
                onClick={() => onSelect?.(a)}
                aria-pressed={a.id === selectedId}
              >
                <Circle
                  size={8}
                  fill="currentColor"
                  style={{
                    color:
                      a.status === 'available' ? 'var(--color-success)' : 'var(--color-danger)',
                  }}
                />
                <div className={styles.info}>
                  <div className={styles.name}>{highlightMatch(a.name)}</div>
                  {a.description && (
                    <div className={styles.description}>{a.description}</div>
                  )}
                  <div className={styles.tags}>
                    {capabilityItems(a.capabilities, t).map((item) => (
                      <span
                        key={item.key}
                        className={`${styles.tag} ${capColorClass[item.key] ?? ''}`}
                      >
                        {item.label}
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
