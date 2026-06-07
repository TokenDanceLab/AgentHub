import React, { type FormEvent } from 'react';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
  ComposerState,
} from '../composer';
import { canSubmitComposer } from '../composer';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';

export interface UnifiedComposerProps {
  composer: ComposerState;
  dispatchComposer: React.Dispatch<ComposerAction>;
  mentionableAgents?: ComposerMention[];
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  targetLabel?: string | undefined;
}

export function UnifiedComposer({
  composer,
  dispatchComposer,
  onSubmit,
  targetLabel = 'AgentHub',
}: UnifiedComposerProps): React.ReactElement {
  const isSubmitting = composer.submitState === 'submitting';

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <div className={styles.composerRow}>
        <textarea
          aria-label="Composer input"
          className={styles.composerInput}
          onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
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
