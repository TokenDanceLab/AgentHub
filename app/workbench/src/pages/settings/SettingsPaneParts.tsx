import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
} from '../../designIcons';
import type { LocalCliDiscoveryManifest } from '@shared/platform';
import styles from '../SettingsPage.module.css';
import {
  SettingPath,
  SettingValue,
  SettingsRow,
  SettingsSection,
} from './shared';
import {
  STATE_PREVIEW_SPECS,
  dataModeStatusDetail,
  dataModeStatusLabel,
  formatLocalCliItemDescription,
  formatLocalCliItemValue,
  joinClassNames,
  statePanelIconName,
  statePanelKindClassName,
} from './SettingsPaneHelpers';
import type { StatePanelKind } from './types';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPaneParts — presentational residual slices from SettingsPanes
   (#686).

   Data-mode / CLI discovery / state-panel leaves and agent-config link.
   CSS stays on SettingsPage.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Data mode status ── */

export function DataModeStatus({
  mode,
}: {
  mode: string;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const detail = dataModeStatusDetail(mode);
  const label = dataModeStatusLabel(mode);

  return (
    <section className={styles.modeStatus} aria-label={t("aria.dataModeStatus")}>
      <div className={styles.modeStatusHead}>
        <span>{label}</span>
        <span className={styles.modeStatusSpacer} aria-hidden="true" />
        <em>{detail.displayLabel}</em>
      </div>
      <strong>{detail.title}</strong>
      <p>{detail.description}</p>
      <dl className={styles.modeFacts}>
        <div>
          <dt>Desktop</dt>
          <dd>{detail.desktopLabel}</dd>
        </div>
        <div>
          <dt>Web</dt>
          <dd>{detail.webLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ── Local CLI discovery ── */

export function LocalCliDiscoveryStatus({
  discovery,
}: {
  discovery: LocalCliDiscoveryManifest;
}): React.ReactElement {
  return (
    <SettingsSection title="CLI 诊断">
      <SettingsRow label="发现模式" description="只做 no-spend CLI 状态发现；不执行 Run、带 prompt 的命令、模型调用或 secrets。">
        <SettingValue value={discovery.mode} />
      </SettingsRow>
      <SettingsRow label="就绪 manifest" description="后续 approved-real 验证必须对齐的 readiness 文档。">
        <SettingPath value={discovery.readinessManifest} />
      </SettingsRow>
      <SettingsRow label="就绪脚本" description="静态 gate 和 no-spend command discovery 的验证入口。">
        <SettingPath value={discovery.readinessScript} />
      </SettingsRow>
      {discovery.items.map((item) => (
        <SettingsRow
          key={item.id}
          label={item.name}
          description={formatLocalCliItemDescription(item)}
        >
          <SettingValue value={formatLocalCliItemValue(item)} />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

/* ── State panel ── */

interface StatePanelProps {
  kind: StatePanelKind;
  label: string;
  title: string;
  copy: string;
  actionLabel: string;
  onAction?: (() => void) | undefined;
  /**
   * Preview-only panels have no real action behind the button; disabling it
   * keeps the sample honest (#1818).
   */
  actionDisabled?: boolean | undefined;
}

export function StatePanel({
  kind,
  label,
  title,
  copy,
  actionLabel,
  onAction,
  actionDisabled = false,
}: StatePanelProps): React.ReactElement {
  const kindClass = statePanelKindClassName(kind, styles);
  const stateIcon = statePanelIconName(kind);
  const articleClass = joinClassNames(
    styles.statePanel,
    kindClass,
    'state-panel',
    kind,
  );

  return (
    <article className={articleClass} aria-label={label}>
      <div className={`${styles.stateMark} state-mark`} aria-hidden="true">
        <DesignNavIcon
          name={stateIcon}
          size={DESIGN_NAV_GLYPH_SIZE}
          strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
        />
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
      <button disabled={actionDisabled} type="button" onClick={onAction}>{actionLabel}</button>
    </article>
  );
}

/* ── Agent config deep-link ── */

export type AgentConfigLinkProps = {
  title: string;
  description: string;
  actionLabel: string;
  ariaLabel: string;
  onOpen: () => void;
};

export function AgentConfigLink({
  title,
  description,
  actionLabel,
  ariaLabel,
  onOpen,
}: AgentConfigLinkProps): React.ReactElement {
  return (
    <section className={styles.agentConfigLink} aria-label={ariaLabel}>
      <div className={styles.agentConfigLinkContent}>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button
        className={styles.agentConfigLinkBtn}
        type="button"
        onClick={onOpen}
      >
        {actionLabel}
        <DesignNavIcon name="external" size={14} />
      </button>
    </section>
  );
}

/* ── State preview grid ── */

export function StatePreviewSection(): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.stateSystem} state-system settings-state-system`}>
      <div className={`${styles.sectionTitleRow} section-title-row`}>
        <h2>{t('settings.statusPreview')}</h2>
        <span>Design System</span>
      </div>
      {/* Sample panels only demonstrate state styling; their action buttons
          are disabled because no real action is wired (#1818). */}
      <p className={styles.statePreviewNote}>{t('settings.statePreviewNote')}</p>
      <div className={`${styles.stateGrid} state-grid`}>
        {STATE_PREVIEW_SPECS.map((spec) => (
          <StatePanel
            actionDisabled
            key={spec.kind}
            kind={spec.kind}
            label={spec.label}
            title={spec.title}
            copy={spec.copy}
            actionLabel={spec.actionLabel}
          />
        ))}
      </div>
    </section>
  );
}
