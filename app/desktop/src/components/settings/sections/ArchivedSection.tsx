import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import EmptyBlock from '../primitives/EmptyBlock';

export default function ArchivedSection() {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.archived')} description={t('settings.archivedDesc')}>
      <EmptyBlock title={t('settings.noArchived')} description={t('settings.noArchivedDesc')} />
    </Panel>
  );
}
