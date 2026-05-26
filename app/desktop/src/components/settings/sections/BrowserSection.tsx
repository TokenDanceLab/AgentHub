import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';

interface BrowserSectionProps {
  browserPreview: boolean;
  setBrowserPreview: (value: boolean) => void;
}

export default function BrowserSection({ browserPreview, setBrowserPreview }: BrowserSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.browser')} description={t('settings.browserDesc')}>
      <SettingRow
        title={t('settings.browserPreview')}
        description={t('settings.browserPreviewDesc')}
        control={<Switch checked={browserPreview} onChange={(v) => { setBrowserPreview(v); writeStoredValue('browserPreview', v); }} />}
      />
      <SettingRow title={t('settings.browserEngine')} description="Chromium / Playwright" value="Auto" />
    </Panel>
  );
}
