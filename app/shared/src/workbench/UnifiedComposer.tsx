import React, { useEffect, type FormEvent } from 'react';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
  ComposerState,
} from '../composer';
import { canSubmitComposer } from '../composer';
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
  onExecutionTargetChange,
  onSubmit,
  submitBehavior = 'enter-send',
  targetLabel = 'AgentHub',
}: UnifiedComposerProps): React.ReactElement {
  const isSubmitting = composer.submitState === 'submitting';
  const targetSelectionRequired = Boolean(executionTargets) && composer.mentions.length > 0;
  const targetSelected = !targetSelectionRequired || executionTargetId.trim().length > 0;
  const submitDisabled = !canSubmitComposer(composer) || isSubmitting || !targetSelected;
  const targetStatus = targetSelectionRequired && !executionTargetId
    ? executionTargets && executionTargets.length > 0
      ? 'Select a Desktop/Edge target before starting.'
      : 'No online Desktop/Edge target is available.'
    : undefined;

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
    if (canSubmitComposer(composer) && !isSubmitting) {
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

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
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
          aria-label="发送消息"
          className={styles.sendButton}
          disabled={submitDisabled}
          type="submit"
        >
          <DesignNavIcon name="send" />
        </button>
      </div>
      {targetStatus && <div className={styles.composerStatus}>{targetStatus}</div>}
    </form>
  );
}
