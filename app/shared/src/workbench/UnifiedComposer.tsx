import React, { useCallback, useEffect, useRef, type FormEvent } from 'react';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
  ComposerState,
} from '../composer';
import { browserFilesToComposerAttachments, canSubmitComposer, formatComposerAttachmentSize } from '../composer';
import { DesignNavIcon } from './designIcons';
import type { ComposerSubmitBehavior } from './workbenchPreferences';
import styles from './AgentHubWorkbench.module.css';

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
}: UnifiedComposerProps): React.ReactElement {
  const isSubmitting = composer.submitState === 'submitting';
  const targetSelectionRequired = Boolean(executionTargets) && composer.mentions.length > 0;
  const targetSelected = !targetSelectionRequired || executionTargetId.trim().length > 0;
  const submitDisabled = !canSubmitComposer(composer) || isSubmitting || !targetSelected;
  const selectedTargetLabel = executionTargets?.find((target) => target.id === executionTargetId)?.label;
  const selectedAgentLabel = composer.mentions.map((mention) => `@${mention.label}`).join(', ');
  const targetStatus = targetSelectionRequired && !executionTargetId
    ? executionTargets && executionTargets.length > 0
      ? 'Select a Desktop/Edge target before starting.'
      : 'No online Desktop/Edge target is available.'
    : undefined;
  const selectedMentionIds = new Set(composer.mentions.map((mention) => mention.id));
  const availableMentionOptions = mentionableAgents.filter((agent) => !selectedMentionIds.has(agent.id));
  const statusItems = [
    status?.dataMode ? `Data: ${status.dataMode}` : undefined,
    status?.targetState ? `Target: ${status.targetState}${status.targetLabel ? ` - ${status.targetLabel}` : ''}` : undefined,
    status?.replayLabel,
    isSubmitting ? 'Run/task: starting' : undefined,
    composer.submitState === 'error' ? 'Run/task: start failed' : undefined,
    targetStatus,
  ].filter((item): item is string => Boolean(item));

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!executionTargets || !executionTargetId) return;
    if (!executionTargets.some((target) => target.id === executionTargetId)) {
      onExecutionTargetChange?.('');
    }
  }, [executionTargetId, executionTargets, onExecutionTargetChange]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;

    const modifierPressed = event.ctrlKey || event.metaKey;
    const shouldSubmit = submitBehavior === 'enter-send' ? !modifierPressed : modifierPressed;
    if (!shouldSubmit && submitBehavior === 'enter-send' && modifierPressed) {
      event.preventDefault();
      insertComposerNewline(event.currentTarget);
      return;
    }
    if (!shouldSubmit) return;

    event.preventDefault();
    if (!submitDisabled) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  function insertComposerNewline(input: HTMLTextAreaElement): void {
    const start = input.selectionStart ?? composer.text.length;
    const end = input.selectionEnd ?? start;
    const nextText = `${composer.text.slice(0, start)}\n${composer.text.slice(end)}`;
    dispatchComposer({ type: 'setText', text: nextText });
    window.requestAnimationFrame(() => {
      input.selectionStart = start + 1;
      input.selectionEnd = start + 1;
    });
  }

  function selectMention(agentId: string): void {
    const mention = mentionableAgents.find((agent) => agent.id === agentId);
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
        <div className={styles.replyToBar}>
          <span className={styles.replyToLabel}>
            回复至 {composer.replyTo.author}: {composer.replyTo.preview}
          </span>
          <button
            aria-label="取消回复"
            className={styles.replyToCancel}
            disabled={isSubmitting}
            onClick={() => dispatchComposer({ type: 'setReplyTo', replyTo: null })}
            type="button"
          >
            x
          </button>
        </div>
      )}
      {composer.quote && (
        <div className={styles.quoteBar}>
          <span className={styles.quoteBarLabel}>
            {composer.quote.author ? `${composer.quote.author}: ` : ''}{composer.quote.text.slice(0, 60)}
          </span>
          <button
            aria-label="取消引用"
            className={styles.quoteBarCancel}
            disabled={isSubmitting}
            onClick={() => dispatchComposer({ type: 'setQuote', quote: null })}
            type="button"
          >
            x
          </button>
        </div>
      )}
      {composer.mentions.length > 0 && (
        <div className={styles.composerMentions} aria-label="Selected agents">
          {composer.mentions.map((mention) => (
            <button
              aria-label={`Remove @${mention.label}`}
              className={styles.composerMentionChip}
              disabled={isSubmitting}
              key={mention.id}
              onClick={() => dispatchComposer({ type: 'removeMention', mentionId: mention.id })}
              type="button"
            >
              @{mention.label}
            </button>
          ))}
        </div>
      )}
      {composer.mentions.length > 0 && (
        <div className={styles.composerMainchain} aria-label="@Agent main chain">
          <span data-state="selected">Agent {selectedAgentLabel}</span>
          <span data-state={targetSelected ? 'selected' : 'missing'}>
            Target {selectedTargetLabel ?? 'missing'}
          </span>
          <span data-state={canSubmitComposer(composer) && targetSelected ? 'selected' : 'missing'}>
            Task {canSubmitComposer(composer) && targetSelected ? 'ready' : 'draft required'}
          </span>
        </div>
      )}
      {composer.attachments.length > 0 && (
        <div className={styles.composerAttachmentBar} aria-label="Attachments">
          {composer.attachments.map((attachment) => (
            <ComposerAttachmentChip
              attachment={attachment}
              isSubmitting={isSubmitting}
              key={attachment.id}
              onRemove={() => dispatchComposer({ type: 'removeAttachment', attachmentId: attachment.id })}
            />
          ))}
        </div>
      )}
      <div className={styles.composerRow}>
        <textarea
          aria-label="Composer input"
          className={styles.composerInput}
          ref={inputRef}
          onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
          onKeyDown={handleKeyDown}
          placeholder={`发消息给 ${targetLabel}`}
          rows={1}
          value={composer.text}
        />

        <input
          accept="image/*,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.toml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.hpp,.log,.zip,.tar,.gz"
          aria-hidden="true"
          hidden
          onChange={handleFilePick}
          ref={fileInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />

        <button
          aria-label="Add attachment"
          className={styles.attachmentButton}
          disabled={isSubmitting}
          onClick={openFilePicker}
          type="button"
        >
          <DesignNavIcon name="paperclip" />
        </button>

        {mentionableAgents.length > 0 && (
          <label className={styles.composerAgentPicker}>
            <span>@Agent</span>
            <select
              aria-label="@Agent"
              className={styles.composerAgentSelect}
              disabled={isSubmitting || availableMentionOptions.length === 0}
              onChange={(event) => selectMention(event.target.value)}
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
        )}

        {executionTargets && (
          <label className={styles.composerTargetPicker}>
            <span>Desktop/Edge target</span>
            <select
              aria-label="Desktop/Edge target"
              className={styles.composerTargetSelect}
              disabled={isSubmitting || executionTargets.length === 0}
              onChange={(event) => onExecutionTargetChange?.(event.target.value)}
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
        )}

        <button
          aria-label={composer.mentions.length > 0 ? '启动 Agent 任务' : '发送消息'}
          className={styles.sendButton}
          disabled={submitDisabled}
          type="submit"
        >
          <DesignNavIcon name="send" />
        </button>
      </div>
      {statusItems.length > 0 && (
        <div className={styles.composerStatus} role="status">
          {statusItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
    </form>
  );
}

/* ── Attachment chip ── */

function ComposerAttachmentChip({
  attachment,
  isSubmitting,
  onRemove,
}: {
  attachment: ComposerAttachment;
  isSubmitting: boolean;
  onRemove: () => void;
}): React.ReactElement {
  const isImage = attachment.mime?.startsWith('image/');
  const sizeLabel = attachment.size ? formatComposerAttachmentSize(attachment.size) : undefined;

  return (
    <div className={styles.attachmentChip}>
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
      <button
        aria-label={`Remove ${attachment.name}`}
        className={styles.attachmentChipRemove}
        disabled={isSubmitting}
        onClick={onRemove}
        type="button"
      >
        &times;
      </button>
    </div>
  );
}
