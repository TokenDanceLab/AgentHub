import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import type { ProviderHealth } from '@/stores/modelSettingsStore';
import SelectControl from '../primitives/SelectControl';
import styles from '../primitives/primitives.module.css';

const PROVIDER_HEALTH_OPTIONS = [
  ['ready', 'Ready'],
  ['degraded', 'Degraded'],
  ['disabled', 'Disabled'],
] as const;

interface ProviderHealthRowProps {
  id: string;
  name: string;
  health: ProviderHealth;
  modelCount: number;
  notes: string;
  onHealthChange: (health: ProviderHealth) => void;
  onNotesChange: (notes: string) => void;
}

export default function ProviderHealthRow({
  id,
  name,
  health,
  modelCount,
  notes,
  onHealthChange,
  onNotesChange,
}: ProviderHealthRowProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.providerRow}>
      <div className={styles.providerMain}>
        <div className={styles.connectionIcon}>
          <Plug size={17} />
        </div>
        <div className={styles.settingCopy}>
          <strong>{name}</strong>
          <span>{id}</span>
          <div className={styles.taskMeta}>
            <span>{t('settings.ccSwitchModelCount', { count: modelCount })}</span>
          </div>
        </div>
        <span className={`${styles.statusPill} ${health === 'ready' ? styles.statusPillOn : ''}`}>
          {t(`settings.providerHealth.${health}`)}
        </span>
      </div>
      <div className={styles.providerControls}>
        <label>
          <span>{t('settings.ccSwitchHealth')}</span>
          <SelectControl
            value={health}
            options={PROVIDER_HEALTH_OPTIONS.map(([value, label]) => [value, label])}
            onChange={(value) => onHealthChange(value as ProviderHealth)}
          />
        </label>
        <label>
          <span>{t('settings.ccSwitchNotes')}</span>
          <textarea
            className={styles.textInput}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
