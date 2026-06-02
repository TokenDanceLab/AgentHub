import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SelectControl from '../primitives/SelectControl';
import { writeStoredValue } from '../utils';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';

interface ConfigurationSectionProps {
  defaultAgent: string;
  setDefaultAgent: (value: string) => void;
  routing: string;
  setRouting: (value: string) => void;
  approvalMode: SelectValue;
  setApprovalMode: (value: SelectValue) => void;
  defaultAgentOptions: Array<[string, string]>;
  routingOptions: Array<[string, string]>;
}

export default function ConfigurationSection({
  defaultAgent,
  setDefaultAgent,
  routing,
  setRouting,
  approvalMode,
  setApprovalMode,
  defaultAgentOptions,
  routingOptions,
}: ConfigurationSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.configuration')} description={t('settings.configurationDesc')}>
      <SettingRow
        title={t('settings.defaultAgent')}
        description={t('settings.defaultAgentDesc')}
        control={
          <SelectControl
            value={defaultAgent}
            onChange={(value) => { setDefaultAgent(value); writeStoredValue('defaultAgent', value); }}
            options={defaultAgentOptions}
          />
        }
      />
      <SettingRow
        title={t('settings.routing')}
        description={t('settings.routingDesc')}
        control={
          <SelectControl
            value={routing}
            onChange={(value) => { setRouting(value); writeStoredValue('routing', value); }}
            options={routingOptions}
          />
        }
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
