import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';

export default function EnvironmentSection() {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.environment')} description={t('settings.environmentDesc')}>
      <SettingRow title="Shell" description="PowerShell 7" value="pwsh" />
      <SettingRow title="Node" description={t('settings.environmentNodeDesc')} value="pnpm" />
      <SettingRow title="Tauri" description={t('settings.environmentTauriDesc')} value={t('settings.enabled')} />
    </Panel>
  );
}
