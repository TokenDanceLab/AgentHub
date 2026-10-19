import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApprovalMode, ComposerMention } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { PermissionModePicker } from '@shared/ui';
import { Button } from '@shared/shadcn/ui/button';
import { DesignNavIcon } from './designIcons';
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

   Helper module for UnifiedComposerParts (#706).
   DesignNavIcon only for icon glyphs.
   Visuals use shadcn Button + Tailwind classes over shared theme tokens.
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
  const placeholder = agentPickerPlaceholder(availableMentionOptions.length, t);
  return (
    <label className="group/picker relative inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-within:bg-muted/60 focus-within:text-foreground has-[:disabled]:opacity-40">
      <DesignNavIcon className="shrink-0" name="agent" size={13} />
      <span aria-hidden="true" className="max-w-[9.5rem] truncate">
        {placeholder}
      </span>
      <DesignNavIcon className="shrink-0 opacity-50" name="chevron" size={10} />
      <select
        aria-label={t('aria.atAgent')}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        disabled={isSubmitting || availableMentionOptions.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        value=""
      >
        <option value="">{placeholder}</option>
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
  const selectedLabel = executionTargets.find(
    (target) => target.id === executionTargetId,
  )?.label;
  const placeholder = selectedLabel ?? targetPickerPlaceholder(executionTargets.length, t);
  return (
    <label className="group/picker relative inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-within:bg-muted/60 focus-within:text-foreground has-[:disabled]:opacity-40">
      <DesignNavIcon className="shrink-0" name="laptop" size={13} />
      <span aria-hidden="true" className="truncate">
        {placeholder}
      </span>
      <DesignNavIcon className="shrink-0 opacity-50" name="chevron" size={10} />
      <select
        aria-label={t('aria.target')}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        disabled={isSubmitting || executionTargets.length === 0}
        onChange={(event) => onChange(event.target.value)}
        value={executionTargetId}
      >
        <option value="">{targetPickerPlaceholder(executionTargets.length, t)}</option>
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
   * button that cancels the active agent run (#1462). Reuses the send
   * button chrome so the hit target stays stable across the morph.
   */
  isRunning?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (isRunning && onCancel) {
    return (
      <Button
        aria-label={t('action.stopRun')}
        className="size-8 shrink-0 rounded-full"
        data-running="true"
        size="icon-lg"
        type="button"
        variant="secondary"
        onClick={onCancel}
      >
        <DesignNavIcon name="stop" size={14} />
      </Button>
    );
  }
  return (
    <Button
      aria-label={hasMentions ? t('action.startAgentTask') : t('profile.sendMessage')}
      className="size-8 shrink-0 rounded-full"
      disabled={submitDisabled}
      size="icon-lg"
      type="submit"
    >
      <DesignNavIcon name="send" size={16} strokeWidth={2.2} />
    </Button>
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
    <Button
      aria-label={t('aria.addAttachment')}
      className="size-7 shrink-0 rounded-md text-muted-foreground"
      disabled={isSubmitting}
      size="icon-sm"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <DesignNavIcon name="paperclip" size={16} />
    </Button>
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
      className="shrink-0"
      triggerClassName="max-w-[11rem] rounded-md bg-transparent! text-xs! text-muted-foreground! hover:bg-muted/60! hover:text-foreground! aria-expanded:bg-muted/60! aria-expanded:text-foreground!"
      onChange={(value) => {
        const mode = pickerValueToApprovalMode(value);
        if (mode) onChange(mode);
      }}
    />
  );
}
