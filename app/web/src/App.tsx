import { useState } from 'react';
import { edgeClient } from '@/api/edgeClient';
import WorkbenchShell from '@/components/WorkbenchShell';
import { useHealth } from '@/hooks/useHealth';
import { useRunners } from '@/hooks/useRunners';
import { useWorkbenchEvents } from '@/hooks/useWorkbenchEvents';

export default function App() {
  const { online, health } = useHealth();
  const runners = useRunners(online);
  const { connected, state, clearEvents } = useWorkbenchEvents(online);
  const [error, setError] = useState<string | null>(null);

  async function handleStartRun() {
    try {
      await edgeClient.startRun();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <WorkbenchShell
      online={online}
      connected={connected}
      error={error}
      health={health}
      runners={runners}
      state={state}
      onStartRun={handleStartRun}
      onClearEvents={clearEvents}
    />
  );
}
