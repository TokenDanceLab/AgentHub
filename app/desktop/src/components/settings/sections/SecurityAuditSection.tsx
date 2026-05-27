import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import { writeStoredValue } from '../utils';

interface SecurityAuditSectionProps {
  auditTrail: boolean;
  setAuditTrail: (value: boolean) => void;
}

export default function SecurityAuditSection({ auditTrail, setAuditTrail }: SecurityAuditSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.securityAudit')} description={t('settings.securityAuditDesc')}>
      <SettingRow title={t('settings.auditTrail')} description={t('settings.auditTrailDesc')} control={<Switch checked={auditTrail} onChange={(v) => { setAuditTrail(v); writeStoredValue('auditTrail', v); }} />} />
      <SettingRow title={t('settings.auditTrailSource')} description={t('settings.auditTrailSourceDesc')} value={auditTrail ? t('settings.status.localSource') : t('settings.notConfigured')} />
      <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.status.interfaceGap')} />
      <SettingRow title={t('settings.secretScan')} description={t('settings.secretScanDesc')} value={t('settings.status.interfaceGap')} />
      <Callout title={t('settings.securityGuard')} body={t('settings.securityGuardDesc')} />
    </Panel>
  );
}
