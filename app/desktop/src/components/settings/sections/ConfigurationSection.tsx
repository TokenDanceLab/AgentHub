import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SelectControl from '../primitives/SelectControl';
import { writeStoredValue } from '../utils';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';

interface ConfigurationSectionProps {
  approvalMode: SelectValue;
  setApprovalMode: (value: SelectValue) => void;
}

export default function ConfigurationSection({ approvalMode, setApprovalMode }: ConfigurationSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.configuration')} description={t('settings.configurationDesc')}>
      <SettingRow title={t('settings.defaultAgent')} description="Claude Code / Codex / OpenCode" value="Auto" />
      <SettingRow
        title={t('settings.routing')}
        description={t('settings.routingDesc')}
        value={t('settings.routingAuto')}
      />
      <SettingRow
        title={t('settings.approvalMode')}
        description={t('settings.approvalModeDesc')}
        control={
          <SelectControl
            value={approvalMode}
            onChange={(value) => { setApprovalMode(value as SelectValue); writeStoredValue('approvalMode', value); }}
            options={[
              ['ask', t('settings.approvalMode.ask')],
              ['auto', t('settings.approvalMode.auto')],
              ['manual', t('settings.approvalMode.manual')],
            ]}
          />
        }
      />
    </Panel>
  );
}
