import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComposerMention,
  ComposerState,
} from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import {
  formatMainchainAgentLabel,
  formatMainchainTargetLabel,
  formatMainchainTaskLabel,
  formatMentionChipLabel,
  formatReplyToLabel,
  mainchainDataState,
} from './ComposerPartsHelpers';
import { formatQuotePreview } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer context chrome — reply / quote / mentions / mainchain / status.

   Residual extract from UnifiedComposerParts for Phase 30 #706.
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
        {formatReplyToLabel(replyTo)}
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

/**
 * Edit-context bar shown above the composer while editing an already-sent
 * message (#1462 CF16). Reuses the reply bar chrome so no new CSS is needed.
 */
export function ComposerEditBar({
  isSubmitting,
  onCancel,
}: {
  isSubmitting: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.replyToBar} data-edit-bar="true">
      <span className={styles.replyToLabel}>{t('composer.editingMessage')}</span>
      <button
        aria-label={t('aria.cancelEdit')}
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
        <button type="button"
          aria-label={t('action.removeMention', { label: mention.label })}
          className={styles.composerMentionChip}
          disabled={isSubmitting}
          key={mention.id}
          onClick={() => onRemove(mention.id)}
        >
          {formatMentionChipLabel(mention)}
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
      <span data-state="selected">{formatMainchainAgentLabel(selectedAgentLabel)}</span>
      <span data-state={mainchainDataState(targetSelected)}>
        {formatMainchainTargetLabel(selectedTargetLabel)}
      </span>
      <span data-state={mainchainDataState(mainchainTask === 'ready')}>
        {formatMainchainTaskLabel(mainchainTask)}
      </span>
    </div>
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
