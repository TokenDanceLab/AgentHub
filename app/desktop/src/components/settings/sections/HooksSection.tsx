import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import { writeStoredValue } from '../utils';
import styles from '../../SettingsPage.module.css';

interface HooksSectionProps {
  enableHooks: boolean;
  setEnableHooks: (value: boolean) => void;
}

export default function HooksSection({ enableHooks, setEnableHooks }: HooksSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.hooks')} description={t('settings.hooksDesc')}>
      <SettingRow
        title={t('settings.enableHooks')}
        description={t('settings.enableHooksDesc')}
        control={<Switch checked={enableHooks} onChange={(v) => { setEnableHooks(v); writeStoredValue('enableHooks', v); }} />}
      />
      <SettingRow title="pre-run" description={t('settings.hookPreRun')} value={t('settings.notConfigured')} />
      <SettingRow title="post-run" description={t('settings.hookPostRun')} value={t('settings.notConfigured')} />
    </Panel>
  );
}
