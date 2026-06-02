import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';
import AllowlistEditor, { type AllowlistEntry, readAllowlist, writeAllowlist, mergeAllowlistFromTarget, exportAllowlistPaths } from './AllowlistEditor';

interface PermissionsSectionProps {
  autoReview: boolean;
  setAutoReview: (value: boolean) => void;
  fullAccess: boolean;
  setFullAccess: (value: boolean) => void;
  allowlistEntries: AllowlistEntry[];
  setAllowlistEntries: (entries: AllowlistEntry[]) => void;
}

export { type AllowlistEntry, readAllowlist, writeAllowlist, mergeAllowlistFromTarget, exportAllowlistPaths };

export default function PermissionsSection({ autoReview, setAutoReview, fullAccess, setFullAccess, allowlistEntries, setAllowlistEntries }: PermissionsSectionProps) {
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
      <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.statusReady', 'Active')} />
      <AllowlistEditor entries={allowlistEntries} onEntriesChange={setAllowlistEntries} />
    </Panel>
  );
}
