import { useTranslation } from 'react-i18next';
import type { ModelAliasMapping } from '@/stores/modelSettingsStore';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import AliasMappingRow from '../cards/AliasMappingRow';
import styles from '../primitives/primitives.module.css';

interface ModelMappingSectionProps {
  modelMappingEnabled: boolean;
  setModelMappingEnabled: (value: boolean) => void;
  modelAliases: ModelAliasMapping[];
  toggleModelAlias: (alias: string) => void;
  updateModelAlias: (alias: string, updates: Partial<Omit<ModelAliasMapping, 'alias'>>) => void;
}

export default function ModelMappingSection({
  modelMappingEnabled, setModelMappingEnabled, modelAliases,
  toggleModelAlias, updateModelAlias,
}: ModelMappingSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.modelMapping')} description={t('settings.modelMappingDesc')}>
      <SettingRow title={t('settings.modelMappingSource')} description={t('settings.modelMappingSourceDesc')} value={t('settings.statusLocalSource')} />
      <SettingRow title={t('settings.enableModelMapping')} description={t('settings.enableModelMappingDesc')} control={<Switch checked={modelMappingEnabled} onChange={setModelMappingEnabled} />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.modelAlias')}</strong><span>{t('settings.modelAliasDesc')}</span></div>
        <div className={styles.modelAliasList}>
          {modelAliases.map((item) => (
            <AliasMappingRow key={item.alias} alias={item.alias} model={item.model} provider={item.provider}
              reasoningEffort={item.reasoningEffort} enabled={item.enabled}
              onToggle={() => toggleModelAlias(item.alias)}
              onModelChange={(model) => updateModelAlias(item.alias, { model })}
              onProviderChange={(provider) => updateModelAlias(item.alias, { provider })}
              onReasoningChange={(reasoningEffort) => updateModelAlias(item.alias, { reasoningEffort })}
            />
          ))}
        </div>
      </div>
      <Callout title={t('settings.modelPolicy')} body={t('settings.modelPolicyDesc')} />
    </Panel>
  );
}
