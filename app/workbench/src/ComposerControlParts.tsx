import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApprovalMode, ComposerMention } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { PermissionModePicker } from '@shared/ui';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';
import {
  activeComposerApprovalModeLabel,
  approvalModeToPickerValue,
  buildComposerApprovalModeOptions,
  pickerValueToApprovalMode,
} from './composerApprovalMode';
import {
  agentPickerPlaceholder,
  formatAgentOptionLabel,
  targetPickerPlaceholder,
} from './ComposerPartsHelpers';
import type { ComposerExecutionTarget } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer control chrome — agent/target pickers + attach/send buttons.

   Residual extract from UnifiedComposerParts for Phase 30 #706.
   DesignNavIcon only for icon glyphs.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function ComposerAgentPicker({
  availableMentionOptions,
  isSubmitting,
  onSelect,
}: {
  availableMentionOptions: ComposerMention[];
  isSubmitting: boolean;
  onSelect: (agentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <label className={styles.composerAgentPicker}>
      <span>{t('composer.agentPicker')}</span>
      <select
        aria-label={t('aria.atAgent')}
        className={styles.composerAgentSelect}
        disabled={isSubmitting || availableMentionOptions.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        value=""
      >
        <option value="">
          {agentPickerPlaceholder(availableMentionOptions.length, t)}
        </option>
        {availableMentionOptions.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {formatAgentOptionLabel(agent)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ComposerTargetPicker({
  executionTargets,
  executionTargetId,
  isSubmitting,
  onChange,
}: {
  executionTargets: ComposerExecutionTarget[];
  executionTargetId: string;
  isSubmitting: boolean;
  onChange: (executionTargetId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <label className={styles.composerTargetPicker}>
      <span>{t('composer.targetPicker')}</span>
      <select
        aria-label={t('aria.target')}
        className={styles.composerTargetSelect}
        disabled={isSubmitting || executionTargets.length === 0}
        onChange={(event) => onChange(event.target.value)}
        value={executionTargetId}
      >
        <option value="">
          {targetPickerPlaceholder(executionTargets.length, t)}
        </option>
        {executionTargets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ComposerSendButton({
  hasMentions,
  submitDisabled,
  isRunning,
  onCancel,
}: {
  hasMentions: boolean;
  submitDisabled: boolean;
  /**
   * When true (and `onCancel` is provided) the send button morphs into a stop
   * button that cancels the active agent run (#1462 CF13). Reuses the send
   * button chrome so the hit target stays stable across the morph.
   */
  isRunning?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (isRunning && onCancel) {
    return (
      <button
        aria-label={t('action.stopRun')}
        className={styles.sendButton}
        data-running="true"
        type="button"
        onClick={onCancel}
      >
        <DesignNavIcon name="stop" />
      </button>
    );
  }
  return (
    <button
      aria-label={hasMentions ? t('action.startAgentTask') : t('profile.sendMessage')}
      className={styles.sendButton}
      disabled={submitDisabled}
      type="submit"
    >
      <DesignNavIcon name="send" />
    </button>
  );
}

export function ComposerAttachButton({
  isSubmitting,
  onClick,
}: {
  isSubmitting: boolean;
  onClick: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <button
      aria-label={t('aria.addAttachment')}
      className={styles.attachmentButton}
      disabled={isSubmitting}
      onClick={onClick}
      type="button"
    >
      <DesignNavIcon name="paperclip" />
    </button>
  );
}

/**
 * #1816 — per-message approval-mode picker (the UI carrier for
 * `composerReducer.setApprovalMode`, which previously had no dispatch source).
 * Reuses the shared PermissionModePicker; mapping/labels live in
 * composerApprovalMode.ts. Disabled while a submit is in flight.
 */
export function ComposerApprovalModePicker({
  approvalMode,
  isSubmitting,
  onChange,
}: {
  approvalMode: ApprovalMode;
  isSubmitting: boolean;
  onChange: (mode: ApprovalMode) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const options = useMemo(
    () => buildComposerApprovalModeOptions((key) => translate(key)),
    [translate],
  );
  const triggerLabel = useMemo(
    () => activeComposerApprovalModeLabel(approvalMode, (key) => translate(key)),
    [approvalMode, translate],
  );
  return (
    <PermissionModePicker
      value={approvalModeToPickerValue(approvalMode)}
      label={triggerLabel}
      ariaLabel={translate('composer.approvalMode.aria', { mode: triggerLabel })}
      options={options}
      disabled={isSubmitting}
      // Conditional spread: desktop's tsconfig types css-module values as
      // possibly-undefined and compiles with exactOptionalPropertyTypes.
      {...(styles.composerApprovalModePicker
        ? { className: styles.composerApprovalModePicker }
        : {})}
      onChange={(value) => {
        const mode = pickerValueToApprovalMode(value);
        if (mode) onChange(mode);
      }}
    />
  );
}
