import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import ConnectionRow from '../primitives/ConnectionRow';

interface ConnectionsSectionProps {
  edgeOnline: boolean;
  hubSessionActive: boolean;
  runnerSummary: string;
}

export default function ConnectionsSection({ edgeOnline, hubSessionActive, runnerSummary }: ConnectionsSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.connections')} description={t('settings.connectionsDesc')}>
      <ConnectionRow
        name="Hub"
        description={hubSessionActive ? t('status.hubConnected') : t('status.hubDisconnected')}
        connected={hubSessionActive}
        onlineLabel={t('settings.online')}
        offlineLabel={t('settings.offline')}
      />
      <ConnectionRow
        name="Edge"
        description={`${t('settings.edgeLocal')} · ${runnerSummary}`}
        connected={edgeOnline}
        onlineLabel={t('settings.online')}
        offlineLabel={t('settings.offline')}
      />
      <ConnectionRow
        name="WebSocket"
        description={t('status.wsConnected')}
        connected={edgeOnline}
        onlineLabel={t('settings.online')}
        offlineLabel={t('settings.offline')}
      />
    </Panel>
  );
}
