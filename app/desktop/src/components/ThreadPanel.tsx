import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageSquare } from 'lucide-react';
import type { ThreadInfo } from '@shared/types';
import styles from './ThreadPanel.module.css';

interface Props {
  threads: ThreadInfo[];
  online: boolean;
  selectedId?: string;
  onSelect: (thread: ThreadInfo) => void;
  onCreate: () => void;
}

export default function ThreadPanel({ threads, online, selectedId, onSelect, onCreate }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter((th) => th.title.toLowerCase().includes(q));
  }, [threads, query]);

  return (
    <nav className={styles.sidebar} aria-label={t('thread.title')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('thread.title')}</span>
        <button
          className={styles.createBtn}
          onClick={onCreate}
          disabled={!online}
          title={t('thread.create')}
        >
          <Plus size={16} />
        </button>
      </div>

      <input
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('thread.search')}
      />

      {filtered.length === 0 ? (
        <div className={styles.empty}>{t('thread.empty')}</div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((th) => (
            <li key={th.threadId}>
              <button
                className={`${styles.item} ${th.threadId === selectedId ? styles.selected : ''}`}
                onClick={() => onSelect(th)}
              >
                <MessageSquare size={14} />
                <div className={styles.itemInfo}>
                  <div className={styles.name}>{th.title || th.threadId.slice(0, 12)}</div>
                  <div className={styles.meta}>{new Date(th.updatedAt).toLocaleDateString()}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
