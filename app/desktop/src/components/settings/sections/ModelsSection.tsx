import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import Callout from '../primitives/Callout';
import SelectControl from '../primitives/SelectControl';
import type { ReasoningEffortPreference } from '@/stores/modelSettingsStore';

const MODEL_OPTIONS = [
  ['auto', 'Auto'], ['claude-opus-4-7', 'claude-opus-4-7'], ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'], ['gpt-5.5', 'gpt-5.5'], ['glm-5.1', 'glm-5.1'],
] as const;

const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance Relay'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['cc-switch-local', 'cc-switch local'],
] as const;

const REASONING_OPTIONS = [
  ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max'],
] as const;

interface ModelsSectionProps {
  defaultModel: string;
  defaultProvider: string;
  modelReasoningEffort: ReasoningEffortPreference;
  providerFallbackEnabled: boolean;
  setDefaultModel: (value: string) => void;
  setDefaultProvider: (value: string) => void;
  setModelReasoningEffort: (value: ReasoningEffortPreference) => void;
  setProviderFallbackEnabled: (value: boolean) => void;
}

export default function ModelsSection({
  defaultModel, defaultProvider, modelReasoningEffort, providerFallbackEnabled,
  setDefaultModel, setDefaultProvider, setModelReasoningEffort, setProviderFallbackEnabled,
}: ModelsSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.models')} description={t('settings.modelsDesc')}>
      <SettingRow title={t('settings.modelConfigSource')} description={t('settings.modelConfigSourceDesc')} value={t('settings.statusLocalSource')} />
      <SettingRow title={t('settings.modelDefault')} description={t('settings.modelDefaultDesc')} control={<SelectControl value={defaultModel} options={MODEL_OPTIONS.map(([v, l]) => [v, l])} onChange={setDefaultModel} />} />
      <SettingRow title={t('settings.modelDefaultProvider')} description={t('settings.modelDefaultProviderDesc')} control={<SelectControl value={defaultProvider} options={PROVIDER_OPTIONS.map(([v, l]) => [v, l])} onChange={setDefaultProvider} />} />
      <SettingRow title={t('settings.modelReasoning')} description={t('settings.modelReasoningDesc')} control={<SelectControl value={modelReasoningEffort} options={REASONING_OPTIONS.map(([v, l]) => [v, l])} onChange={(value) => setModelReasoningEffort(value as ReasoningEffortPreference)} />} />
      <SettingRow title={t('settings.modelProviderFallback')} description={t('settings.modelProviderFallbackDesc')} control={<Switch checked={providerFallbackEnabled} onChange={setProviderFallbackEnabled} />} />
      <Callout title={t('settings.modelLocalGuard')} body={t('settings.modelLocalGuardDesc')} />
    </Panel>
  );
}
