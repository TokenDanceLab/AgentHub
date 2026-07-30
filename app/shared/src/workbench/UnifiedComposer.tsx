import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { browserFilesToComposerAttachments } from '../composer';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import {
  ComposerAgentPicker,
  ComposerAttachButton,
  ComposerAttachmentBar,
  ComposerEditBar,
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerSendButton,
  ComposerStatusStrip,
  ComposerTargetPicker,
} from './UnifiedComposerParts';
import {
  buildUnifiedComposerHostState,
  cancelEditAction,
  cancelQuoteAction,
  cancelReplyAction,
  dispatchComposerAttachmentAdds,
  planAddMentionAction,
  planComposerHostKeyDownEffect,
  removeAttachmentAction,
  removeMentionAction,
  resolveComposerFilePickChange,
  resolveComposerOpenFilePicker,
  setComposerTextAction,
  shouldClearExecutionTarget,
  type UnifiedComposerProps,
} from './unifiedComposerHostHelpers';

export type {
  AttachmentUploadState,
  ComposerStatusHints,
  UnifiedComposerProps,
} from './unifiedComposerHostHelpers';

export function UnifiedComposer({
  composer,
  dispatchComposer,
  executionTargets,
  executionTargetId,
  inputRef,
  mentionableAgents,
  onExecutionTargetChange,
  onPickLocalAttachments,
  onSubmit,
  status,
  submitBehavior,
  targetLabel,
  uploadProgresses,
  isRunning,
  onCancel,
}: UnifiedComposerProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { runtime, view } = buildUnifiedComposerHostState({
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    submitBehavior,
    targetLabel,
    onPickLocalAttachments,
    status,
    uploadProgresses,
  });
  const { chromeModel } = view;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shouldClearExecutionTarget(executionTargets, runtime.executionTargetId)) return;
    onExecutionTargetChange?.('');
  }, [runtime.executionTargetId, executionTargets, onExecutionTargetChange]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const effect = planComposerHostKeyDownEffect({
      event,
      submitBehavior: runtime.submitBehavior,
      composerText: composer.text,
      attachments: composer.attachments,
      isSubmitting: view.isSubmitting,
      targetSelectionRequired: view.targetSelectionRequired,
      executionTargetId: runtime.executionTargetId,
    });
    if (effect.kind === 'none') return;
    event.preventDefault();
    if (effect.kind === 'insert-newline') {
      const input = event.currentTarget;
      dispatchComposer(effect.textAction);
      window.requestAnimationFrame(() => {
        input.selectionStart = effect.caret.selectionStart;
        input.selectionEnd = effect.caret.selectionEnd;
      });
      return;
    }
    if (effect.kind === 'submit') event.currentTarget.form?.requestSubmit();
  }

  function selectMention(agentId: string): void {
    const action = planAddMentionAction(runtime.mentionableAgents, agentId);
    if (action) dispatchComposer(action);
  }

  const handleFilePick = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const result = await resolveComposerFilePickChange({
      fileList: event.target.files,
      hasNativePicker: runtime.hasNativePicker,
      onPickLocalAttachments,
      browserFilesToAttachments: browserFilesToComposerAttachments,
    });
    if (result.kind === 'noop') return;
    dispatchComposerAttachmentAdds(dispatchComposer, result.attachments);
    if (result.resetInput && fileInputRef.current) fileInputRef.current.value = '';
  }, [dispatchComposer, onPickLocalAttachments, runtime.hasNativePicker]);

  function openFilePicker(): void {
    void resolveComposerOpenFilePicker({
      hasNativePicker: runtime.hasNativePicker,
      onPickLocalAttachments,
    }).then((result) => {
      if (result.kind === 'web-input') {
        fileInputRef.current?.click();
        return;
      }
      dispatchComposerAttachmentAdds(dispatchComposer, result.attachments);
    });
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      {chromeModel.replyTo && (
        <ComposerReplyBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelReplyAction())}
          replyTo={chromeModel.replyTo}
        />
      )}
      {chromeModel.quote && (
        <ComposerQuoteBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelQuoteAction())}
          quote={chromeModel.quote}
        />
      )}
      {composer.editingMessageId && (
        <ComposerEditBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelEditAction())}
        />
      )}
      {chromeModel.mentions && (
        <ComposerMentionChips
          isSubmitting={view.isSubmitting}
          mentions={chromeModel.mentions}
          onRemove={(id) => dispatchComposer(removeMentionAction(id))}
        />
      )}
      {chromeModel.mainchain && (
        <ComposerMainchainStrip {...chromeModel.mainchain} />
      )}
      {chromeModel.attachment && (
        <ComposerAttachmentBar
          attachments={chromeModel.attachment.attachments}
          isSubmitting={view.isSubmitting}
          onRemove={(id) => dispatchComposer(removeAttachmentAction(id))}
          uploadProgresses={chromeModel.attachment.uploadProgresses}
        />
      )}
      <div className={styles.composerRow}>
        <textarea
          aria-label={t('aria.composerInput')}
          data-composer-input
          className={styles.composerInput}
          ref={inputRef}
          onChange={(e) => dispatchComposer(setComposerTextAction(e.target.value))}
          onKeyDown={handleKeyDown}
          placeholder={view.inputPlaceholder}
          rows={1}
          value={composer.text}
        />
        <input
          accept={view.fileAccept}
          aria-hidden="true"
          hidden
          onChange={handleFilePick}
          ref={fileInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />
        <ComposerAttachButton isSubmitting={view.isSubmitting} onClick={openFilePicker} />
        {chromeModel.agentOptions && (
          <ComposerAgentPicker
            availableMentionOptions={chromeModel.agentOptions}
            isSubmitting={view.isSubmitting}
            onSelect={selectMention}
          />
        )}
        {chromeModel.targetPicker && (
          <ComposerTargetPicker
            {...chromeModel.targetPicker}
            isSubmitting={view.isSubmitting}
            onChange={(id) => onExecutionTargetChange?.(id)}
          />
        )}
        <ComposerSendButton
          hasMentions={view.hasMentions}
          isRunning={isRunning}
          onCancel={onCancel}
          submitDisabled={view.submitDisabled}
        />
      </div>
      {chromeModel.statusItems && (
        <ComposerStatusStrip statusItems={chromeModel.statusItems} />
      )}
    </form>
  );
}
