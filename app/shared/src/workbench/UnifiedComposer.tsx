import React, { type ChangeEvent, type FormEvent, useRef } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import type { ApprovalMode, ComposerAction, ComposerMode, ComposerState } from '../composer';
import {
  browserFilesToComposerAttachments,
  canSubmitComposer,
  formatComposerAttachmentSize,
} from '../composer';
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
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = composer.submitState === 'submitting';

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const attachments = await browserFilesToComposerAttachments(files);
    attachments.forEach((attachment) => dispatchComposer({ type: 'addAttachment', attachment }));
    input.value = '';
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <input
        aria-hidden="true"
        className={styles.hiddenAttachmentInput}
        data-testid="composer-attachment-input"
        multiple
        onChange={(event) => void handleAttachmentChange(event)}
        ref={attachmentInputRef}
        tabIndex={-1}
        type="file"
      />
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
      {composer.attachments.length > 0 ? (
        <div aria-label="Selected attachments" className={styles.attachmentTray}>
          {composer.attachments.map((attachment) => (
            <span className={styles.attachmentChip} key={attachment.id}>
              <FileText aria-hidden="true" className={styles.attachmentIcon} />
              <span className={styles.attachmentName}>{attachment.name}</span>
              <span className={styles.attachmentMeta}>
                {attachment.source === 'desktop' ? 'Desktop' : 'Browser'}
                {formatComposerAttachmentSize(attachment.size) ? ` · ${formatComposerAttachmentSize(attachment.size)}` : ''}
              </span>
              <button
                aria-label={`移除附件 ${attachment.name}`}
                className={styles.removeAttachmentButton}
                onClick={() => dispatchComposer({ type: 'removeAttachment', attachmentId: attachment.id })}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.composerRow}>
        <textarea
          aria-label="Composer input"
          className={styles.composerInput}
          onChange={(event) => dispatchComposer({ type: 'setText', text: event.target.value })}
          value={composer.text}
        />
        <button
          aria-label="添加附件"
          className={styles.attachButton}
          disabled={isSubmitting}
          onClick={() => attachmentInputRef.current?.click()}
          title="添加附件"
          type="button"
        >
          <Paperclip aria-hidden="true" />
        </button>
        <button
          className={styles.sendButton}
          disabled={!canSubmitComposer(composer) || isSubmitting}
          type="submit"
        >
          发送消息
        </button>
      </div>
    </form>
  );
}
