import { useTranslation } from 'react-i18next';
import Switch from '../primitives/Switch';
import SelectControl from '../primitives/SelectControl';
import type { ReasoningEffortPreference } from '@/stores/modelSettingsStore';
import styles from '../../SettingsPage.module.css';

const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance Relay'],
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['cc-switch-local', 'cc-switch local'],
] as const;

const REASONING_OPTIONS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['max', 'Max'],
] as const;

interface AliasMappingRowProps {
  alias: string;
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffortPreference;
  enabled: boolean;
  onToggle: () => void;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onReasoningChange: (reasoningEffort: ReasoningEffortPreference) => void;
}

export default function AliasMappingRow({
  alias,
  model,
  provider,
  reasoningEffort,
  enabled,
  onToggle,
  onModelChange,
  onProviderChange,
  onReasoningChange,
}: AliasMappingRowProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.modelAliasRow}>
      <div className={styles.modelAliasHead}>
        <div>
          <strong>{alias}</strong>
          <span>{t('settings.modelAliasRoute', { model, provider })}</span>
        </div>
        <Switch checked={enabled} onChange={onToggle} />
      </div>
      <div className={styles.modelAliasControls}>
        <label>
          <span>{t('settings.modelAliasModel')}</span>
          <SelectControl
            value={model}
            options={MODEL_OPTIONS.filter(([value]) => value !== 'auto').map(([value, label]) => [value, label])}
            onChange={onModelChange}
          />
        </label>
        <label>
          <span>{t('settings.modelAliasProvider')}</span>
          <SelectControl
            value={provider}
            options={PROVIDER_OPTIONS.map(([value, label]) => [value, label])}
            onChange={onProviderChange}
          />
        </label>
        <label>
          <span>{t('settings.modelAliasReasoning')}</span>
          <SelectControl
            value={reasoningEffort}
            options={REASONING_OPTIONS.map(([value, label]) => [value, label])}
            onChange={(value) => onReasoningChange(value as ReasoningEffortPreference)}
          />
        </label>
      </div>
    </div>
  );
}
