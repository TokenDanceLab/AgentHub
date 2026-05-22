import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useRunners } from '@/hooks/useRunners';
import { useEventStream } from '@/hooks/useEventStream';
import { startRun } from '@/api/edgeClient';
import StatusBar from '@/components/StatusBar';
import RunnerList from '@/components/RunnerList';
import EventLog from '@/components/EventLog';
import styles from '@/App.module.css';

export default function App() {
  const { t } = useTranslation();
  const { online, health } = useHealth();
  const runners = useRunners(online);
  const { events, isConnected, clearEvents } = useEventStream(online);
  const [error, setError] = useState<string | null>(null);

  const handleStartRun = async () => {
    try {
      const run = await startRun();
      setError(null);
      console.log('run started:', run.runId);
    } catch (e) {
      setError(t('error.streamError', { message: String(e) }));
    }
  };

  return (
    <div className={styles.root}>
      <StatusBar
        online={online}
        health={health}
        isConnected={isConnected}
        error={error}
      />

      <div className={styles.toolbar}>
        <button className={styles.btn} onClick={handleStartRun} disabled={!online}>
          {t('action.startRun')}
        </button>
        <button className={styles.btn} onClick={clearEvents} aria-label={t('action.clearEvents')}>
          {t('action.clearEvents')}
        </button>
      </div>

      <div className={styles.body}>
        <RunnerList runners={runners} online={online} />
        <EventLog events={events} online={online} />
      </div>
    </div>
  );
}
