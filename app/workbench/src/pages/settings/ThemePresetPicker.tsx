// ThemePresetPicker — workbench settings preset chips (#1986, UX F15).
// Surface-agnostic by construction: writes go through the shared SSOT
// `setAgentHubThemePreset` (apply DOM attribute + persist + notify), and the
// picker subscribes to preset changes so chips stay honest no matter which
// surface (or context provider) performed the last write.
import { useCallback, useEffect, useState } from 'react';
import {
  THEME_PRESETS,
  THEME_PRESET_META,
  getStoredAgentHubThemePreset,
  setAgentHubThemePreset,
  subscribeAgentHubThemePreset,
  type ThemePreset,
} from '@shared/theme';
import styles from './ThemePresetPicker.module.css';

export interface ThemePresetPickerProps {
  /** Accessible label of the chip group. */
  groupLabel: string;
  /** Label of the "default" (no preset) chip. */
  defaultLabel: string;
  className?: string | undefined;
}

export function ThemePresetPicker({
  groupLabel,
  defaultLabel,
  className,
}: ThemePresetPickerProps): React.ReactElement {
  const [preset, setPreset] = useState<ThemePreset | undefined>(getStoredAgentHubThemePreset);

  // External writes (other surfaces, tests) keep the selection honest.
  useEffect(() => subscribeAgentHubThemePreset(setPreset), []);

  // The subscription echo updates state — no second local write path.
  const handleSelect = useCallback((next: ThemePreset | undefined): void => {
    setAgentHubThemePreset(next);
  }, []);

  return (
    <div
      className={className ? `${styles.picker} ${className}` : styles.picker}
      role="group"
      aria-label={groupLabel}
      data-testid="theme-preset-picker"
    >
      <button
        type="button"
        className={preset === undefined ? `${styles.chip} ${styles.chipActive}` : styles.chip}
        aria-pressed={preset === undefined}
        onClick={() => handleSelect(undefined)}
        data-testid="theme-preset-default"
      >
        <span className={styles.chipLabel}>{defaultLabel}</span>
      </button>
      {THEME_PRESETS.map((id) => {
        const meta = THEME_PRESET_META[id];
        const active = preset === id;
        return (
          <button
            key={id}
            type="button"
            className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={active}
            onClick={() => handleSelect(id)}
            data-testid={`theme-preset-${id}`}
            title={meta.label}
          >
            <span className={styles.chipLabel}>{meta.label}</span>
            <span className={styles.swatches} aria-hidden="true">
              {meta.darkPreview.map((color) => (
                <span key={color} className={styles.swatch} style={{ background: color }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
