import { useRef, useEffect } from 'react';
import { LogEntry } from '../hooks/useEventStream';
import styles from './EventLog.module.css';

interface Props {
  events: LogEntry[];
  online: boolean;
}

export default function EventLog({ events, online }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Events</div>
      <div ref={listRef} className={styles.list}>
        {events.length === 0 ? (
          <div className={styles.empty}>
            {online ? 'Waiting for events...' : 'Start Edge Server to receive events'}
          </div>
        ) : (
          events.map((e, i) => (
            <div key={e.id || `${e.seq}-${i}`} className={styles.row}>
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
    </div>
  );
}
