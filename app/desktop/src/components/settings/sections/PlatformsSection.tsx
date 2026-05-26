import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import CapabilityCard from '../primitives/CapabilityCard';
import styles from '../../SettingsPage.module.css';

interface PlatformsSectionProps {
  hubSessionActive: boolean;
}

export default function PlatformsSection({ hubSessionActive }: PlatformsSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.platforms')} description={t('settings.platformsDesc')}>
      <SettingRow
        title={t('settings.platformSync')}
        description={t('settings.platformSyncDesc')}
        control={<SwitchPlaceholder />}
      />
      <SettingRow
        title={t('settings.platformSyncSource')}
        description={t('settings.platformSyncSourceDesc')}
        value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
      />
      <div className={styles.capabilityGrid}>
        <CapabilityCard title="macOS" description={t('settings.platformMacosDesc')} status={t('settings.status.localSource')} />
        <CapabilityCard title="Windows" description={t('settings.platformWindowsDesc')} status={t('settings.status.localSource')} />
        <CapabilityCard title="Android" description={t('settings.platformAndroidDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
        <CapabilityCard title="Web" description={t('settings.platformWebDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
      </div>
    </Panel>
  );
}

function SwitchPlaceholder() {
  return (
    <button className={`${styles.switch}`} role="switch" aria-checked={false} disabled>
      <span />
    </button>
  );
}
