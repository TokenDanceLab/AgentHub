/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for SettingsPage subviews.
   Extracted for Phase 18 strangler slice #572.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../../designIcons';
import { getWorkbenchDataModeContract } from '@shared/demo';
import { Switch } from '@shared/ui';
import styles from '../SettingsPage.module.css';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';

/* ── Design icons ── */

export function NavGlyph({ name }: { name: DesignNavIconName }): React.ReactElement {
  return (
    <span className={styles.navGlyph} aria-hidden="true">
      <DesignNavIcon
        name={name}
        size={DESIGN_NAV_GLYPH_SIZE}
        strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
      />
    </span>
  );
}

/* ── Scope row ── */

interface SettingsScopeRowProps {
  title: string;
  meta: string;
}

export function SettingsScopeRow({ title, meta }: SettingsScopeRowProps): React.ReactElement {
  return (
    <div className={`${styles.scopeRow} settings-scope-row`} aria-label={title}>
      <strong>{title}</strong>
      <span>{meta}</span>
    </div>
  );
}

/* ── Settings section wrapper ── */

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps): React.ReactElement {
  const count = React.Children.count(children);
  return (
    <section className={`${styles.section} settings-section`}>
      <div className={styles.sectionTitleRow}>
        <h2>{title}</h2>
        <span>{count} 项</span>
      </div>
      <div className={styles.list}>
        {children}
      </div>
    </section>
  );
}

/* ── Settings row ── */

interface SettingsRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
  /** Use a wider control area (for permission segments). */
  wide?: boolean;
  /**
   * Marks a row whose control is not wired to a real capability yet
   * (#1818): renders an explicit "coming soon" note so a disabled control
   * is never read as a working one.
   */
  comingSoon?: boolean;
}

export function SettingsRow({ label, description, children, wide = false, comingSoon = false }: SettingsRowProps): React.ReactElement {
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={`${styles.row} settings-row`} data-card-surface>
      <div>
        <strong className={styles.rowLabel}>{label}</strong>
        <span className={styles.rowDesc}>
          {description}
          {comingSoon && (
            <em className={styles.comingSoonNote}>{tw('settings.comingSoon')}</em>
          )}
        </span>
      </div>
      <div className={`${styles.control}${wide ? ` ${styles.controlWide}` : ''}`}>
        {children}
      </div>
    </div>
  );
}

/* ── Segmented control ── */

interface SettingSegmentProps {
  options: string[];
  active: string;
  onChange: (value: string) => void;
  /**
   * Disabled segments keep their current value visible but ignore clicks —
   * used for preferences that have no effect yet (#1818).
   */
  disabled?: boolean;
}

export function SettingSegment({ options, active, onChange, disabled = false }: SettingSegmentProps): React.ReactElement {
  return (
    <div
      aria-disabled={disabled || undefined}
      className={`${styles.segment}${disabled ? ` ${styles.segmentDisabled}` : ''}`}
    >
      {options.map((option) => (
        <button
          key={option}
          aria-pressed={option === active}
          className={`${styles.segmentBtn}${option === active ? ` ${styles.segmentBtnActive}` : ''}`}
          disabled={disabled}
          type="button"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ── Data mode segmented control ── */

interface DataModeControlProps {
  active: string;
  onChange: (value: string) => void;
}

export function DataModeControl({ active, onChange }: DataModeControlProps): React.ReactElement {
  const normalized = getWorkbenchDataModeContract(active).displayLabel;
  return (
    <SettingSegment
      options={['Auto', 'Mock', 'Fixture', 'Observed', 'Approved real']}
      active={normalized}
      onChange={onChange}
    />
  );
}

/* ── Switch ── */

interface SettingSwitchProps {
  active: boolean;
  onChange: (active: boolean) => void;
  /**
   * Disabled switches keep their current state visible but ignore clicks —
   * used for preferences that have no effect yet (#1818).
   */
  disabled?: boolean;
}

/**
 * Settings switch — thin alias over the shared design-system Switch
 * (#1827): the hand-rolled 42x24 pill moved to shared/src/ui/Switch with
 * token-identical visuals + a missing ':focus-visible' ring.
 */
export function SettingSwitch({ active, onChange, disabled = false }: SettingSwitchProps): React.ReactElement {
  return <Switch checked={active} onChange={onChange} disabled={disabled} />;
}

/* ── Value button ── */

interface SettingValueProps {
  value: string;
  onClick?: () => void;
}

export function SettingValue({ value, onClick }: SettingValueProps): React.ReactElement {
  // Read-only values render as plain text; a button without a handler would
  // be a clickable-but-dead control (#1818).
  if (!onClick) {
    return <span className={styles.valueStatic}>{value}</span>;
  }
  return (
    <button className={styles.value} type="button" onClick={onClick}>
      {value}
    </button>
  );
}

/* ── Path display ── */

interface SettingPathProps {
  value: string;
  onCopy?: () => void;
}

export function SettingPath({ value, onCopy }: SettingPathProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.path}>
      <code className={styles.pathCode}>{value}</code>
      <button
        className={styles.pathBtn}
        type="button"
        aria-label={t("aria.copyPath")}
        onClick={onCopy}
      >
        <DesignNavIcon name="copy" size={14} />
      </button>
    </div>
  );
}
