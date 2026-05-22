import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LogEntry } from '@/hooks/useEventStream';
import styles from './EventLog.module.css';

interface Props {
  events: LogEntry[];
  online: boolean;
}

export default function EventLog({ events, online }: Props) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <section className={styles.panel} aria-label={t('event.title')}>
      <div className={styles.title}>{t('event.title')}</div>
      <div ref={listRef} className={styles.list} role="log">
        {events.length === 0 ? (
          <div className={styles.empty}>
            {online ? t('event.emptyOnline') : t('event.emptyOffline')}
          </div>
        ) : (
          events.map((e, i) => (
            <div
              key={e.id || `${e.seq}-${i}`}
              className={styles.row}
              aria-label={`${e.type}: ${e.summary}`}
            >
              <span className={styles.seq}>[{e.seq}]</span>
              <span className={styles.type}>{e.type}</span>
              {e.summary && <span className={styles.summary}>{e.summary}</span>}
              <div className={styles.ts}>
                {new Date(e.sentAt).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
