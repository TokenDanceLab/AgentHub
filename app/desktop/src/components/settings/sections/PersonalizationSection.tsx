import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Callout from '../primitives/Callout';

interface PersonalizationSectionProps {
  username: string | null;
}

export default function PersonalizationSection({ username }: PersonalizationSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.personalization')} description={t('settings.personalizationDesc')}>
      <SettingRow title={t('settings.displayName')} description={username ?? 'AgentHub User'} value="Local" />
      <SettingRow title={t('settings.instructions')} description={t('settings.instructionsDesc')} action />
      <Callout title={t('settings.personalizationNote')} body={t('settings.personalizationNoteDesc')} />
    </Panel>
  );
}
