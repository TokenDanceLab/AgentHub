import { useTranslation } from 'react-i18next';
import type { CcSwitchProvider } from '@/stores/modelSettingsStore';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import ProviderHealthRow from '../cards/ProviderHealthRow';
import styles from '../../SettingsPage.module.css';

interface CcSwitchSectionProps {
  ccSwitchBridge: boolean;
  setCcSwitchBridge: (value: boolean) => void;
  ccSwitchProviders: CcSwitchProvider[];
  updateCcSwitchProvider: (id: string, updates: Partial<Omit<CcSwitchProvider, 'id'>>) => void;
}

export default function CcSwitchSection({ ccSwitchBridge, setCcSwitchBridge, ccSwitchProviders, updateCcSwitchProvider }: CcSwitchSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.ccSwitch')} description={t('settings.ccSwitchDesc')}>
      <SettingRow title={t('settings.ccSwitchSource')} description={t('settings.ccSwitchSourceDesc')} value={t('settings.status.localSource')} />
      <SettingRow title={t('settings.ccSwitchBridge')} description={t('settings.ccSwitchBridgeDesc')} control={<Switch checked={ccSwitchBridge} onChange={setCcSwitchBridge} />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.ccSwitchProviders')}</strong><span>{t('settings.ccSwitchProvidersDesc')}</span></div>
        <div className={styles.providerList}>
          {ccSwitchProviders.map((provider) => (
            <ProviderHealthRow key={provider.id} id={provider.id} name={provider.name} health={provider.health}
              modelCount={provider.modelCount} notes={provider.notes}
              onHealthChange={(health) => updateCcSwitchProvider(provider.id, { health })}
              onNotesChange={(notes) => updateCcSwitchProvider(provider.id, { notes })}
            />
          ))}
        </div>
      </div>
      <Callout title={t('settings.ccSwitchHealth')} body={t('settings.ccSwitchHealthDesc')} />
    </Panel>
  );
}
