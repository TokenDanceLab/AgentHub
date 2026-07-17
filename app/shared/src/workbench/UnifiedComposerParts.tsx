import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComposerAttachment,
  ComposerMention,
  ComposerState,
} from '../composer';
import { formatComposerAttachmentSize } from '../composer';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';
import {
  type AttachmentUploadState,
  type ComposerExecutionTarget,
  formatQuotePreview,
  isAttachmentUploading,
  isImageAttachment,
} from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   UnifiedComposer presentational subpanels.

   Residual extract from UnifiedComposer for Phase 24 #638.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function ComposerReplyBar({
  replyTo,
  isSubmitting,
  onCancel,
}: {
  replyTo: NonNullable<ComposerState['replyTo']>;
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.replyToBar}>
      <span className={styles.replyToLabel}>
        回复至 {replyTo.author}: {replyTo.preview}
      </span>
      <button
        aria-label={t('aria.cancelReply')}
        className={styles.replyToCancel}
        disabled={isSubmitting}
        onClick={onCancel}
        type="button"
      >
        x
      </button>
    </div>
  );
}

export function ComposerQuoteBar({
  quote,
  isSubmitting,
  onCancel,
}: {
  quote: NonNullable<ComposerState['quote']>;
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.quoteBar}>
      <span className={styles.quoteBarLabel}>
        {formatQuotePreview(quote)}
      </span>
      <button
        aria-label={t('aria.cancelQuote')}
        className={styles.quoteBarCancel}
        disabled={isSubmitting}
        onClick={onCancel}
        type="button"
      >
        x
      </button>
    </div>
  );
}

export function ComposerMentionChips({
  mentions,
  isSubmitting,
  onRemove,
}: {
  mentions: ComposerMention[];
  isSubmitting: boolean;
  onRemove: (mentionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.composerMentions} aria-label={t('aria.selectedAgents')}>
      {mentions.map((mention) => (
        <button
          aria-label={t('action.removeMention', { label: mention.label })}
          className={styles.composerMentionChip}
          disabled={isSubmitting}
          key={mention.id}
          onClick={() => onRemove(mention.id)}
          type="button"
        >
          @{mention.label}
        </button>
      ))}
    </div>
  );
}

export function ComposerMainchainStrip({
  selectedAgentLabel,
  selectedTargetLabel,
  targetSelected,
  mainchainTask,
}: {
  selectedAgentLabel: string;
  selectedTargetLabel: string | undefined;
  targetSelected: boolean;
  mainchainTask: 'ready' | 'draft required';
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.composerMainchain} aria-label={t('aria.agentMainChain')}>
      <span data-state="selected">Agent {selectedAgentLabel}</span>
      <span data-state={targetSelected ? 'selected' : 'missing'}>
        Target {selectedTargetLabel ?? 'missing'}
      </span>
      <span data-state={mainchainTask === 'ready' ? 'selected' : 'missing'}>
        Task {mainchainTask}
      </span>
    </div>
  );
}

export function ComposerAttachmentBar({
  attachments,
  isSubmitting,
  uploadProgresses,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
  onRemove: (attachmentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.composerAttachmentBar} aria-label={t('aria.attachments')}>
      {attachments.map((attachment) => {
        const progress = uploadProgresses?.[attachment.id];
        return (
          <ComposerAttachmentChip
            attachment={attachment}
            isSubmitting={isSubmitting}
            key={attachment.id}
            onRemove={() => onRemove(attachment.id)}
            {...(progress ? { uploadProgress: progress } : {})}
          />
        );
      })}
    </div>
  );
}

export function ComposerAttachmentChip({
  attachment,
  isSubmitting,
  onRemove,
  uploadProgress,
}: {
  attachment: ComposerAttachment;
  isSubmitting: boolean;
  onRemove: () => void;
  uploadProgress?: AttachmentUploadState;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const isImage = isImageAttachment(attachment);
  const sizeLabel = attachment.size ? formatComposerAttachmentSize(attachment.size) : undefined;
  const isUploading = isAttachmentUploading(uploadProgress, attachment);
  const uploadPercent = uploadProgress?.percent ?? 0;

  return (
    <div className={styles.attachmentChip} {...(isUploading ? { 'data-uploading': 'true' } : {})}>
      {isImage && attachment.contentPreview && (
        <span className={styles.attachmentChipThumb} aria-hidden="true">
          {attachment.contentPreview.slice(0, 2)}
        </span>
      )}
      <span className={styles.attachmentChipName}>
        {attachment.name}
      </span>
      {sizeLabel && (
        <span className={styles.attachmentChipSize}>{sizeLabel}</span>
      )}
      {isUploading ? (
        <span className={styles.attachmentUploadBar}>
          <span className={styles.attachmentUploadFill} style={{ width: `${uploadPercent}%` }} />
        </span>
      ) : (
        <button
          aria-label={t('action.removeAttachment', { name: attachment.name })}
          className={styles.attachmentChipRemove}
          disabled={isSubmitting}
          onClick={onRemove}
          type="button"
        >
          &times;
        </button>
      )}
    </div>
  );
}

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
      <span>@Agent</span>
      <select
        aria-label={t('aria.atAgent')}
        className={styles.composerAgentSelect}
        disabled={isSubmitting || availableMentionOptions.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        value=""
      >
        <option value="">
          {availableMentionOptions.length > 0 ? 'Mention agent' : 'All agents mentioned'}
        </option>
        {availableMentionOptions.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.label}
            {agent.runtimeId ? ` (${agent.runtimeId})` : ''}
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
      <span>Desktop/Edge target</span>
      <select
        aria-label={t('aria.target')}
        className={styles.composerTargetSelect}
        disabled={isSubmitting || executionTargets.length === 0}
        onChange={(event) => onChange(event.target.value)}
        value={executionTargetId}
      >
        <option value="">
          {executionTargets.length > 0 ? 'Select target' : 'No online target'}
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

export function ComposerStatusStrip({
  statusItems,
}: {
  statusItems: string[];
}): React.ReactElement {
  return (
    <div className={styles.composerStatus} role="status">
      {statusItems.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

export function ComposerSendButton({
  hasMentions,
  submitDisabled,
}: {
  hasMentions: boolean;
  submitDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
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
