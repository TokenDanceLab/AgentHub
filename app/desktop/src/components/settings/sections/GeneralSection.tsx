import { useTranslation } from 'react-i18next';
import { Monitor, Eye } from 'lucide-react';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import ModeCard from '../primitives/ModeCard';
import Switch from '../primitives/Switch';
import SelectControl from '../primitives/SelectControl';
import { writeStoredValue } from '../utils';
import styles from '../../SettingsPage.module.css';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';

interface GeneralSectionProps {
  detailLevel: SelectValue;
  setDetailLevel: (value: SelectValue) => void;
  compactMode: boolean;
  setCompactMode: (value: boolean) => void;
}

export default function GeneralSection({ detailLevel, setDetailLevel, compactMode, setCompactMode }: GeneralSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <Panel title={t('settings.workMode')} description={t('settings.workModeDesc')}>
        <div className={styles.modeGrid}>
          <ModeCard
            active={detailLevel === 'detailed'}
            icon={<Monitor size={20} />}
            title={t('settings.modeCoding')}
            description={t('settings.modeCodingDesc')}
            onClick={() => { setDetailLevel('detailed'); writeStoredValue('detailLevel', 'detailed'); }}
          />
          <ModeCard
            active={detailLevel === 'balanced'}
            icon={<Eye size={20} />}
            title={t('settings.modeDaily')}
            description={t('settings.modeDailyDesc')}
            onClick={() => { setDetailLevel('balanced'); writeStoredValue('detailLevel', 'balanced'); }}
          />
        </div>
      </Panel>
      <Panel title={t('settings.general')}>
        <SettingRow
          title={t('settings.compactMode')}
          description={t('settings.compactModeDesc')}
          control={<Switch checked={compactMode} onChange={(v) => { setCompactMode(v); writeStoredValue('compactMode', v); }} />}
        />
        <SettingRow
          title={t('settings.detailLevel')}
          description={t('settings.detailLevelDesc')}
          control={
            <SelectControl
              value={detailLevel}
              onChange={(value) => { setDetailLevel(value as SelectValue); writeStoredValue('detailLevel', value); }}
              options={[
                ['detailed', t('settings.detailLevel.detailed')],
                ['balanced', t('settings.detailLevel.balanced')],
              ]}
            />
          }
        />
      </Panel>
    </>
  );
}
