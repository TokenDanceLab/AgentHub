import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { THEME_PRESETS, THEME_PRESET_META, type ThemePreset } from '@/contexts/ThemeContext';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SelectControl from '../primitives/SelectControl';
import styles from '../primitives/primitives.module.css';

type ThemeMode = 'dark' | 'light' | 'system';

interface AppearanceSectionProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  themePreset: ThemePreset | undefined;
  setThemePreset: (preset: ThemePreset | undefined) => void;
}

const LANGUAGE_OPTIONS: Array<[string, string]> = [
  ['en', 'English'],
  ['zh', '中文'],
];

export default function AppearanceSection({
  themeMode, setThemeMode,
  themePreset, setThemePreset,
}: AppearanceSectionProps) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
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

      <Panel title={t('settings.themePreset')} description={t('settings.themePresetDesc')}>
        <div className={styles.presetGrid}>
          <button
            type="button"
            className={`${styles.presetCard} ${themePreset === undefined ? styles.presetCardActive : ''}`}
            onClick={() => setThemePreset(undefined)}
          >
            <div className={styles.presetSwatches}>
              {/* theme preview swatch - intentional */}
              <span className={styles.presetSwatch} style={{ background: '#5d68cc' }} />
              <span className={styles.presetSwatch} style={{ background: '#25252d' }} />
              <span className={styles.presetSwatch} style={{ background: '#d7d9e1' }} />
            </div>
            <div className={styles.presetCardLabel}>
              <strong>AgentHub</strong>
              <small>{t('settings.themePresetDefault')}</small>
            </div>
          </button>
          {THEME_PRESETS.map((key) => {
            const meta = THEME_PRESET_META[key];
            const [accent, surface, muted] = meta.darkPreview;
            return (
              <button
                key={key}
                type="button"
                className={`${styles.presetCard} ${themePreset === key ? styles.presetCardActive : ''}`}
                onClick={() => setThemePreset(key)}
              >
                <div className={styles.presetSwatches}>
                  {/* theme preview swatch - intentional */}
                  <span className={styles.presetSwatch} style={{ background: accent }} />
                  <span className={styles.presetSwatch} style={{ background: surface }} />
                  <span className={styles.presetSwatch} style={{ background: muted }} />
                </div>
                <div className={styles.presetCardLabel}>
                  <strong>{meta.label}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={t('settings.language')} description={t('settings.languageDesc')}>
        <SettingRow
          title={t('settings.language')}
          description={t('settings.languageDesc')}
          control={
            <SelectControl
              value={language}
              options={LANGUAGE_OPTIONS}
              onChange={(value) => setLanguage(value as 'en' | 'zh')}
            />
          }
        />
      </Panel>
    </>
  );
}
