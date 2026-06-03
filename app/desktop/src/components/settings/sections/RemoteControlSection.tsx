import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import styles from '../primitives/primitives.module.css';

interface RemoteControlSectionProps {
  hubSessionActive: boolean;
}

export default function RemoteControlSection({ hubSessionActive }: RemoteControlSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.remoteControl')} description={t('settings.remoteControlDesc')}>
      <SettingRow
        title={t('settings.remoteControlEnable')}
        description={t('settings.remoteControlEnableDesc')}
        control={<button className={`${styles.switch}`} role="switch" aria-checked={false} disabled><span /></button>}
      />
      <SettingRow title={t('settings.remoteControlApproval')} description={t('settings.remoteControlApprovalDesc')} value={t('settings.approvalMode.ask')} />
      <SettingRow
        title={t('settings.remoteControlDevices')}
        description={t('settings.remoteControlDevicesDesc')}
        value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
      />
    </Panel>
  );
}
