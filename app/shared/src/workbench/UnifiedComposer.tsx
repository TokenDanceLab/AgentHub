import React, { type FormEvent } from 'react';
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
  mentionableAgents?: ComposerMention[];
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  submitBehavior?: ComposerSubmitBehavior | undefined;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  targetLabel?: string | undefined;
}

export function UnifiedComposer({
  composer,
  dispatchComposer,
  inputRef,
  onSubmit,
  submitBehavior = 'enter-send',
  targetLabel = 'AgentHub',
}: UnifiedComposerProps): React.ReactElement {
  const isSubmitting = composer.submitState === 'submitting';

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

        <button
          aria-label="发送消息"
          className={styles.sendButton}
          disabled={!canSubmitComposer(composer) || isSubmitting}
          type="submit"
        >
          <DesignNavIcon name="send" />
        </button>
      </div>
    </form>
  );
}
