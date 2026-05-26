import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';

interface PermissionsSectionProps {
  autoReview: boolean;
  setAutoReview: (value: boolean) => void;
  fullAccess: boolean;
  setFullAccess: (value: boolean) => void;
}

export default function PermissionsSection({ autoReview, setAutoReview, fullAccess, setFullAccess }: PermissionsSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.permissions')} description={t('settings.permissionsDesc')}>
      <SettingRow
        title={t('settings.autoReview')}
        description={t('settings.autoReviewDesc')}
        control={<Switch checked={autoReview} onChange={(v) => { setAutoReview(v); writeStoredValue('autoReview', v); }} />}
      />
      <SettingRow
        title={t('settings.fullAccess')}
        description={t('settings.fullAccessDesc')}
        control={<Switch checked={fullAccess} onChange={(v) => { setFullAccess(v); writeStoredValue('fullAccess', v); }} />}
      />
      <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.statusPlanned')} />
    </Panel>
  );
}
