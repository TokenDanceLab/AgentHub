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
import { getWorkbenchDataModeContract } from '../../../demo';
import styles from '../SettingsPage.module.css';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../../../chatview/i18n/resources';

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
}

export function SettingsRow({ label, description, children, wide = false }: SettingsRowProps): React.ReactElement {
  return (
    <div className={`${styles.row} settings-row`} data-card-surface>
      <div>
        <strong className={styles.rowLabel}>{label}</strong>
        <span className={styles.rowDesc}>{description}</span>
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
}

export function SettingSegment({ options, active, onChange }: SettingSegmentProps): React.ReactElement {
  return (
    <div className={styles.segment}>
      {options.map((option) => (
        <button
          key={option}
          aria-pressed={option === active}
          className={`${styles.segmentBtn}${option === active ? ` ${styles.segmentBtnActive}` : ''}`}
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
}

export function SettingSwitch({ active, onChange }: SettingSwitchProps): React.ReactElement {
  return (
    <button
      className={`${styles.switch}${active ? ` ${styles.switchOn}` : ''}`}
      type="button"
      role="switch"
      aria-checked={active}
      onClick={() => onChange(!active)}
    >
      <span className={styles.switchThumb} />
    </button>
  );
}

/* ── Value button ── */

interface SettingValueProps {
  value: string;
  onClick?: () => void;
}

export function SettingValue({ value, onClick }: SettingValueProps): React.ReactElement {
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
