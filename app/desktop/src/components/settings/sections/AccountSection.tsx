import { useTranslation } from 'react-i18next';
import { UserCircle, LockKeyhole, Globe2, Monitor, Route, LogOut } from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import Callout from '../primitives/Callout';
import { APP_VERSION, HUB_URL } from '@/config';
import { readBrowserStorage, shortId } from '../utils';
import styles from '../../SettingsPage.module.css';

const DEVICE_ID_KEY = 'agenthub_device_id';
const TD_CODE_VERIFIER_KEY = 'td_code_verifier';
const TD_STATE_KEY = 'td_state';

interface AccountSectionProps {
  hubSessionActive: boolean;
  accountName: string;
  tokenSource: string;
  tokenSourceLabel: string;
  desktopDeviceStatus: string;
  deviceId: string | null;
  deviceRegistration: { status: 'idle' | 'registering' | 'registered' | 'error'; error: string | null };
  onOpenAuth: () => void;
  onSignOut: () => void;
}

export default function AccountSection({
  hubSessionActive, accountName, tokenSource, tokenSourceLabel,
  desktopDeviceStatus, deviceId, deviceRegistration, onOpenAuth, onSignOut,
}: AccountSectionProps) {
  const { t } = useTranslation();
  const pkceStateReady = Boolean(readBrowserStorage('session', TD_CODE_VERIFIER_KEY)) && Boolean(readBrowserStorage('session', TD_STATE_KEY));

  return (
    <Panel title={t('settings.account')} description={t('settings.accountDesc')}>
      <div className={styles.accountCard}>
        <UserCircle size={34} />
        <div className={styles.accountInfo}>
          <strong>{hubSessionActive ? accountName : t('settings.notSignedIn')}</strong>
          <span>{hubSessionActive ? t('settings.accountConnected') : t('settings.accountDisconnected')}</span>
        </div>
        {hubSessionActive ? (
          <button className={styles.secondaryBtn} onClick={onSignOut}><LogOut size={16} />{t('settings.signOut')}</button>
        ) : (
          <button className={styles.primaryBtn} onClick={onOpenAuth}><UserCircle size={16} />{t('settings.signIn')}</button>
        )}
      </div>
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<LockKeyhole size={18} />} label={t('settings.hubSession')} value={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')} detail={hubSessionActive ? t('settings.hubSessionDesc') : t('settings.hubSessionSignedOutDesc')} />
        <SummaryCard icon={<Globe2 size={18} />} label="TokenDance ID" value={tokenSource === 'tokendance' ? t('settings.enabled') : t('settings.statusInProgress')} detail={tokenSource === 'tokendance' ? t('settings.tokenDanceSessionDesc') : t('settings.tokenDanceOidcPendingDesc')} />
        <SummaryCard icon={<Monitor size={18} />} label={t('settings.desktopDevice')} value={desktopDeviceStatus} detail={deviceRegistration.status === 'error' ? deviceRegistration.error ?? t('settings.desktopDeviceRegisterFailed') : deviceId ? shortId(deviceId) : t('settings.desktopDeviceMissingDesc')} />
        <SummaryCard icon={<Route size={18} />} label={t('settings.syncScope')} value={deviceRegistration.status === 'registered' ? t('settings.enabled') : t('settings.signedOut')} detail={t('settings.syncScopeDesc')} />
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.identityBoundary')}</strong><span>{t('settings.identityBoundaryDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title={t('settings.hubSession')} description={t('settings.hubSessionCapabilityDesc')} status={hubSessionActive ? t('settings.statusReady') : t('settings.notConfigured')} />
          <CapabilityCard title="TokenDance ID OIDC" description={t('settings.tokenDanceOidcDesc')} status={pkceStateReady ? t('settings.statusInProgress') : t('settings.statusPlanned')} />
          <CapabilityCard title={t('settings.authTokenSource')} description={t('settings.authTokenSourceDesc')} status={tokenSourceLabel} />
          <CapabilityCard title={t('settings.deviceProof')} description={t('settings.deviceProofDesc')} status={t(`settings.deviceStatus.${deviceRegistration.status}`)} />
        </div>
      </div>
      <SettingRow title={t('settings.hubEndpoint')} description={HUB_URL} value={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')} />
      <SettingRow title={t('settings.appVersion')} description={APP_VERSION} value={t('settings.statusReady')} />
      <Callout title={t('settings.accountGuard')} body={t('settings.accountGuardDesc')} />
    </Panel>
  );
}
