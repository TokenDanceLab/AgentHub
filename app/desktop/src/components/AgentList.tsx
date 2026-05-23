import { useTranslation } from 'react-i18next';
import { Circle } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import styles from './AgentList.module.css';

interface Props {
  agents: AgentInfo[];
  online: boolean;
  selectedId?: string;
  onSelect?: (agent: AgentInfo) => void;
}

function capabilityLabels(caps: AgentInfo['capabilities'], t: (key: string) => string): string[] {
  const labels: string[] = [];
  if (caps.streaming) labels.push(t('agent.capability.streaming'));
  if (caps.toolCalls) labels.push(t('agent.capability.toolCalls'));
  if (caps.fileChanges) labels.push(t('agent.capability.fileChanges'));
  if (caps.thinkingVisible) labels.push(t('agent.capability.thinking'));
  if (caps.multiTurn) labels.push(t('agent.capability.multiTurn'));
  return labels;
}

export default function AgentList({ agents, online, selectedId, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <nav className={styles.sidebar} aria-label={t('agent.title')}>
      <div className={styles.title}>{t('agent.title')}</div>
      {agents.length === 0 ? (
        <div className={styles.empty}>
          {online ? t('agent.emptyOnline') : t('agent.emptyOffline')}
        </div>
      ) : (
        <ul className={styles.list}>
          {agents.map((a) => (
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
                  <div className={styles.name}>{a.name}</div>
                  <div className={styles.tags}>
                    {capabilityLabels(a.capabilities, t).map((label) => (
                      <span key={label} className={styles.tag}>
                        {label}
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
}
