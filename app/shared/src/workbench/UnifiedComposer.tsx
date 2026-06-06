import React, { type FormEvent } from 'react';
import type { ComposerAction, ComposerMode, ComposerState } from '../composer';
import { canSubmitComposer } from '../composer';
import styles from './AgentHubWorkbench.module.css';

const composerModes: Array<{ mode: ComposerMode; label: string }> = [
  { mode: 'ask', label: 'Ask' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'code', label: 'Code' },
  { mode: 'review', label: 'Review' },
  { mode: 'deploy', label: 'Deploy' },
];

export interface UnifiedComposerProps {
  composer: ComposerState;
  dispatchComposer: React.Dispatch<ComposerAction>;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function UnifiedComposer({
  composer,
  dispatchComposer,
  onSubmit,
}: UnifiedComposerProps): React.ReactElement {
  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <div aria-label="Composer modes" className={styles.composerModes} role="toolbar">
        {composerModes.map((item) => (
          <button
            aria-pressed={composer.mode === item.mode}
            className={styles.composerModeButton}
            key={item.mode}
            onClick={() => dispatchComposer({ type: 'setMode', mode: item.mode })}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.composerRow}>
        <textarea
          aria-label="Composer input"
          className={styles.composerInput}
          onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
          value={composer.text}
        />
        <button
          className={styles.sendButton}
          disabled={!canSubmitComposer(composer) || composer.submitState === 'submitting'}
          type="submit"
        >
          发送消息
        </button>
      </div>
    </form>
  );
}
