import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';
import styles from '../../SettingsPage.module.css';

interface AppearanceSectionProps {
  themeMode: string;
  setThemeMode: (mode: string) => void;
  compactMode: boolean;
  setCompactMode: (value: boolean) => void;
}

export default function AppearanceSection({ themeMode, setThemeMode, compactMode, setCompactMode }: AppearanceSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <Panel title={t('settings.theme')} description={t('settings.themeDesc')}>
        <div className={styles.segmented}>
          {(['dark', 'light', 'system'] as const).map((mode) => (
            <button
              key={mode}
              className={themeMode === mode ? styles.segmentActive : ''}
              onClick={() => setThemeMode(mode)}
            >
              {t(`settings.theme.${mode}`)}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={t('settings.density')}>
        <SettingRow
          title={t('settings.compactMode')}
          description={t('settings.compactModeDesc')}
          control={<Switch checked={compactMode} onChange={(v) => { setCompactMode(v); writeStoredValue('compactMode', v); }} />}
        />
      </Panel>
    </>
  );
}
