import { Badge } from './Badge';

interface StatusPillProps {
  status: 'online' | 'running' | 'waiting' | 'failed' | 'offline' | 'muted' | 'completed';
}

export function StatusPill({ status }: StatusPillProps): React.ReactElement {
  const map = {
    online: { label: 'Online', tone: 'success' },
    running: { label: 'Running', tone: 'accent' },
    waiting: { label: 'Review', tone: 'warning' },
    failed: { label: 'Failed', tone: 'danger' },
    offline: { label: 'Offline', tone: 'neutral' },
    muted: { label: 'Muted', tone: 'neutral' },
    completed: { label: 'Done', tone: 'success' },
  } as const;

  return <Badge label={map[status].label} tone={map[status].tone} />;
}
