import { useState } from 'react';
import { useHealth } from './hooks/useHealth';
import { useRunners } from './hooks/useRunners';
import { useEventStream } from './hooks/useEventStream';
import { startRun } from './api/edgeClient';
import StatusBar from './components/StatusBar';
import RunnerList from './components/RunnerList';
import EventLog from './components/EventLog';
import styles from './App.module.css';

export default function App() {
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
      setError(`Failed to start run: ${e}`);
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
          Start Mock Run
        </button>
        <button className={styles.btn} onClick={clearEvents}>
          Clear Events
        </button>
      </div>

      <div className={styles.body}>
        <RunnerList runners={runners} online={online} />
        <EventLog events={events} online={online} />
      </div>
    </div>
  );
}
