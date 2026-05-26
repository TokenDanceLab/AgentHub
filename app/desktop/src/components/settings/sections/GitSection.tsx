import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';

interface GitSectionProps {
  autoDetectGit: boolean;
  setAutoDetectGit: (value: boolean) => void;
}

export default function GitSection({ autoDetectGit, setAutoDetectGit }: GitSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.git')} description={t('settings.gitDesc')}>
      <SettingRow
        title={t('settings.autoDetectGit')}
        description={t('settings.autoDetectGitDesc')}
        control={<Switch checked={autoDetectGit} onChange={(v) => { setAutoDetectGit(v); writeStoredValue('autoDetectGit', v); }} />}
      />
      <SettingRow title={t('settings.branchPolicy')} description="feat/* -> dev/delicious233 -> master" />
      <SettingRow title={t('settings.commitStyle')} description="type(scope): summary" />
    </Panel>
  );
}
