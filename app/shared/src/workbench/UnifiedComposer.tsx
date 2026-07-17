import React, { useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
  ComposerState,
} from '../composer';
import { browserFilesToComposerAttachments } from '../composer';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import type { ComposerSubmitBehavior } from './workbenchPreferences';
import styles from './AgentHubWorkbench.module.css';
import {
  ComposerAgentPicker,
  ComposerAttachButton,
  ComposerAttachmentBar,
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerSendButton,
  ComposerStatusStrip,
  ComposerTargetPicker,
} from './UnifiedComposerParts';
import {
  COMPOSER_FILE_ACCEPT,
  buildTextWithNewline,
  canSubmitFromKeyDown,
  deriveUnifiedComposerState,
  findMentionById,
  isExecutionTargetStillValid,
  shouldSubmitComposerKey,
  type AttachmentUploadState,
  type ComposerStatusHints,
} from './unifiedComposerHelpers';

export type { AttachmentUploadState, ComposerStatusHints };

export interface UnifiedComposerProps {
  composer: ComposerState;
  dispatchComposer: React.Dispatch<ComposerAction>;
  executionTargets?: Array<{ id: string; label: string }> | undefined;
  executionTargetId?: string | undefined;
  mentionableAgents?: ComposerMention[];
  onExecutionTargetChange?: ((executionTargetId: string) => void) | undefined;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  submitBehavior?: ComposerSubmitBehavior | undefined;
  status?: {
    dataMode?: string | undefined;
    replayLabel?: string | undefined;
    targetLabel?: string | undefined;
    targetState?: string | undefined;
  } | undefined;
  uploadProgresses?: Record<string, AttachmentUploadState>;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  targetLabel?: string | undefined;
}

export function UnifiedComposer({
  composer,
  dispatchComposer,
  executionTargets,
  executionTargetId = '',
  inputRef,
  mentionableAgents = [],
  onExecutionTargetChange,
  onPickLocalAttachments,
  onSubmit,
  status,
  submitBehavior = 'enter-send',
  targetLabel = 'AgentHub',
  uploadProgresses,
}: UnifiedComposerProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const derived = deriveUnifiedComposerState({
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    status,
  });
  const {
    isSubmitting,
    targetSelectionRequired,
    targetSelected,
    submitDisabled,
    selectedTargetLabel,
    selectedAgentLabel,
    availableMentionOptions,
    statusItems,
    mainchainTask,
  } = derived;

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExecutionTargetStillValid(executionTargets, executionTargetId)) return;
    onExecutionTargetChange?.('');
  }, [executionTargetId, executionTargets, onExecutionTargetChange]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const plan = shouldSubmitComposerKey({
      key: event.key,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: event.nativeEvent.isComposing,
      submitBehavior,
    });

    if (plan.insertNewline) {
      event.preventDefault();
      insertComposerNewline(event.currentTarget);
      return;
    }
    if (!plan.shouldSubmit) return;

    event.preventDefault();
    // Use the textarea's current DOM value instead of composer.text to avoid
    // stale-state issues: React batches state updates, so the latest onChange
    // dispatch may not have re-rendered yet when Enter fires immediately after.
    const currentText = event.currentTarget.value ?? '';
    if (canSubmitFromKeyDown({
      currentText,
      attachments: composer.attachments,
      isSubmitting,
      targetSelectionRequired,
      executionTargetId,
    })) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  function insertComposerNewline(input: HTMLTextAreaElement): void {
    const { nextText, caret } = buildTextWithNewline({
      text: composer.text,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    });
    dispatchComposer({ type: 'setText', text: nextText });
    window.requestAnimationFrame(() => {
      input.selectionStart = caret;
      input.selectionEnd = caret;
    });
  }

  function selectMention(agentId: string): void {
    const mention = findMentionById(mentionableAgents, agentId);
    if (!mention) return;
    dispatchComposer({ type: 'addMention', mention });
  }

  const handleFilePick = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    // Desktop platform: delegate to the native file picker if available
    if (onPickLocalAttachments) {
      try {
        const attachments = await onPickLocalAttachments();
        attachments.forEach((attachment) => {
          dispatchComposer({ type: 'addAttachment', attachment });
        });
      } catch {
        // User cancelled or picker failed — nothing to do
      }
      // Reset so the same file can be picked again
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Web platform: use browser file input directly
    const files = Array.from(fileList);
    const attachments = await browserFilesToComposerAttachments(files);
    attachments.forEach((attachment) => {
      dispatchComposer({ type: 'addAttachment', attachment });
    });
    // Reset so the same file can be picked again
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [dispatchComposer, onPickLocalAttachments]);

  function openFilePicker(): void {
    // Desktop: use the platform-native picker
    if (onPickLocalAttachments) {
      void onPickLocalAttachments().then((attachments) => {
        attachments.forEach((attachment) => {
          dispatchComposer({ type: 'addAttachment', attachment });
        });
      }).catch(() => {
        // User cancelled
      });
      return;
    }
    // Web: trigger the hidden file input
    fileInputRef.current?.click();
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      {composer.replyTo && (
        <ComposerReplyBar
          isSubmitting={isSubmitting}
          onCancel={() => dispatchComposer({ type: 'setReplyTo', replyTo: null })}
          replyTo={composer.replyTo}
        />
      )}
      {composer.quote && (
        <ComposerQuoteBar
          isSubmitting={isSubmitting}
          onCancel={() => dispatchComposer({ type: 'setQuote', quote: null })}
          quote={composer.quote}
        />
      )}
      {composer.mentions.length > 0 && (
        <ComposerMentionChips
          isSubmitting={isSubmitting}
          mentions={composer.mentions}
          onRemove={(mentionId) => dispatchComposer({ type: 'removeMention', mentionId })}
        />
      )}
      {composer.mentions.length > 0 && (
        <ComposerMainchainStrip
          mainchainTask={mainchainTask}
          selectedAgentLabel={selectedAgentLabel}
          selectedTargetLabel={selectedTargetLabel}
          targetSelected={targetSelected}
        />
      )}
      {composer.attachments.length > 0 && (
        <ComposerAttachmentBar
          attachments={composer.attachments}
          isSubmitting={isSubmitting}
          onRemove={(attachmentId) => dispatchComposer({ type: 'removeAttachment', attachmentId })}
          uploadProgresses={uploadProgresses}
        />
      )}
      <div className={styles.composerRow}>
        <textarea
          aria-label={t('aria.composerInput')}
          data-composer-input
          className={styles.composerInput}
          ref={inputRef}
          onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
          onKeyDown={handleKeyDown}
          placeholder={`发消息给 ${targetLabel}`}
          rows={1}
          value={composer.text}
        />

        <input
          accept={COMPOSER_FILE_ACCEPT}
          aria-hidden="true"
          hidden
          onChange={handleFilePick}
          ref={fileInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />

        <ComposerAttachButton isSubmitting={isSubmitting} onClick={openFilePicker} />

        {mentionableAgents.length > 0 && (
          <ComposerAgentPicker
            availableMentionOptions={availableMentionOptions}
            isSubmitting={isSubmitting}
            onSelect={selectMention}
          />
        )}

        {executionTargets && (
          <ComposerTargetPicker
            executionTargetId={executionTargetId}
            executionTargets={executionTargets}
            isSubmitting={isSubmitting}
            onChange={(nextTargetId) => onExecutionTargetChange?.(nextTargetId)}
          />
        )}

        <ComposerSendButton
          hasMentions={composer.mentions.length > 0}
          submitDisabled={submitDisabled}
        />
      </div>
      {statusItems.length > 0 && (
        <ComposerStatusStrip statusItems={statusItems} />
      )}
    </form>
  );
}
