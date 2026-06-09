import { useStrings } from '@/i18n/strings';

import { Badge } from './Badge';

interface StatusPillProps {
  status: 'online' | 'running' | 'waiting' | 'failed' | 'offline' | 'muted' | 'completed';
}

export function StatusPill({ status }: StatusPillProps): React.ReactElement {
  const t = useStrings();
  const map = {
    online: { label: t.online, tone: 'success' },
    running: { label: t.runningStatus, tone: 'accent' },
    waiting: { label: t.reviewRequired, tone: 'warning' },
    failed: { label: t.failed, tone: 'danger' },
    offline: { label: t.offline, tone: 'neutral' },
    muted: { label: t.muted, tone: 'neutral' },
    completed: { label: t.done, tone: 'success' },
  } as const;

  return <Badge label={map[status].label} tone={map[status].tone} />;
}
