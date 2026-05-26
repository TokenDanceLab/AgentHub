import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';

interface WorktreeSectionProps {
  worktreeIsolation: boolean;
  setWorktreeIsolation: (value: boolean) => void;
}

export default function WorktreeSection({ worktreeIsolation, setWorktreeIsolation }: WorktreeSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.worktree')} description={t('settings.worktreeDesc')}>
      <SettingRow title={t('settings.defaultWorkspace')} description="D:\\Code\\TokenDance" />
      <SettingRow
        title={t('settings.worktreeIsolation')}
        description={t('settings.worktreeIsolationDesc')}
        control={<Switch checked={worktreeIsolation} onChange={(v) => { setWorktreeIsolation(v); writeStoredValue('worktreeIsolation', v); }} />}
      />
      <SettingRow title={t('settings.worktreePolicy')} description=".worktrees/<feature>" />
    </Panel>
  );
}
