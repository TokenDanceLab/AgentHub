import React, { type FormEvent } from 'react';
import type { ApprovalMode, ComposerAction, ComposerMode, ComposerState } from '../composer';
import { canSubmitComposer } from '../composer';
import styles from './AgentHubWorkbench.module.css';

const composerModes: Array<{ mode: ComposerMode; label: string }> = [
  { mode: 'ask', label: 'Ask' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'code', label: 'Code' },
  { mode: 'review', label: 'Review' },
  { mode: 'deploy', label: 'Deploy' },
];

const approvalModes: Array<{ mode: ApprovalMode; label: string }> = [
  { mode: 'suggest', label: '建议' },
  { mode: 'read-only', label: '只读' },
  { mode: 'workspace-write', label: '可写' },
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
      <div className={styles.composerControls}>
        <label className={styles.composerSelectLabel}>
          <span>权限</span>
          <select
            aria-label="Approval mode"
            className={styles.composerSelect}
            onChange={(event) => dispatchComposer({
              type: 'setApprovalMode',
              approvalMode: event.target.value as ApprovalMode,
            })}
            value={composer.approvalMode}
          >
            {approvalModes.map((item) => (
              <option key={item.mode} value={item.mode}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.workDirLabel}>
          <span>目标目录</span>
          <input
            aria-label="Work directory"
            className={styles.workDirInput}
            onChange={(event) => dispatchComposer({ type: 'setWorkDir', workDir: event.target.value })}
            placeholder="默认 Local Edge 目录"
            spellCheck={false}
            value={composer.workDir}
          />
        </label>
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
