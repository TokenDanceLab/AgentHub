import { describe, expect, it } from 'vitest';
import type { ComposerState } from '@shared/composer';
import {
  MAX_ATTACHMENT_BYTES,
  buildAttachmentOversizeToast,
  buildComposerStatusItems,
  buildTextWithNewline,
  canSubmitFromKeyDown,
  deriveUnifiedComposerState,
  filterAvailableMentionOptions,
  formatQuotePreview,
  formatSelectedAgentLabel,
  isAttachmentUploading,
  isExecutionTargetStillValid,
  isImageAttachment,
  isTargetSelectionRequired,
  mainchainTaskState,
  partitionAttachmentsBySize,
  resolveTargetStatus,
  shouldSubmitComposerKey,
  validateAttachment,
} from './unifiedComposerHelpers';

const baseComposer: ComposerState = {
  conversationId: 'hub-session-1',
  text: 'Run the real task',
  mode: 'code',
  mentions: [{ id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' }],
  attachments: [],
  approvalMode: 'suggest',
  workDir: '',
  submitState: 'idle',
  editingMessageId: null,
  replyTo: null,
  quote: null,
};

describe('unifiedComposerHelpers', () => {
  it('requires a target only when mentions exist and targets are provided', () => {
    expect(isTargetSelectionRequired(undefined, baseComposer.mentions)).toBe(false);
    expect(isTargetSelectionRequired([], [])).toBe(false);
    expect(isTargetSelectionRequired([], baseComposer.mentions)).toBe(true);
  });

  it('builds status items and target guidance text', () => {
    expect(resolveTargetStatus({
      targetSelectionRequired: true,
      executionTargetId: '',
      executionTargets: [],
    })).toBe('当前无在线执行目标。');

    expect(resolveTargetStatus({
      targetSelectionRequired: true,
      executionTargetId: '',
      executionTargets: [{ id: 't1', label: 'Desktop' }],
    })).toBe('请先选择执行目标再开始。');

    expect(buildComposerStatusItems({
      status: {
        dataMode: 'approved-real',
        replayLabel: 'Hub replay: 2 runtime events observed',
        targetLabel: 'Alpha Desktop (target-local-edge-1)',
        targetState: 'ready',
      },
      targetStatus: undefined,
    })).toEqual([
      '数据：真实数据',
      '目标：就绪 · Alpha Desktop (target-local-edge-1)',
      'Hub replay: 2 runtime events observed',
    ]);
  });

  it('filters already-selected mention options', () => {
    expect(filterAvailableMentionOptions(
      [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
        { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
      ],
      baseComposer.mentions,
    )).toEqual([
      { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
    ]);
  });

  it('plans enter-send vs modifier newline behavior', () => {
    expect(shouldSubmitComposerKey({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'enter-send',
    })).toEqual({ shouldSubmit: true, insertNewline: false });

    expect(shouldSubmitComposerKey({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'enter-send',
    })).toEqual({ shouldSubmit: false, insertNewline: true });

    expect(shouldSubmitComposerKey({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'ctrl-enter-send',
    })).toEqual({ shouldSubmit: true, insertNewline: false });
  });

  it('inserts a newline at the caret and validates key-submit readiness', () => {
    expect(buildTextWithNewline({
      text: 'ab',
      selectionStart: 1,
      selectionEnd: 1,
    })).toEqual({ nextText: 'a\nb', caret: 2 });

    expect(canSubmitFromKeyDown({
      currentText: 'hello',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: true,
      executionTargetId: '',
      isRunning: false,
    })).toBe(false);

    expect(canSubmitFromKeyDown({
      currentText: 'hello',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: true,
      executionTargetId: 'target-1',
      isRunning: false,
    })).toBe(true);
  });

  it('derives composer chrome labels and task readiness', () => {
    expect(formatSelectedAgentLabel(baseComposer.mentions)).toBe('@Builder');
    expect(formatQuotePreview({ author: 'Ada', text: 'x'.repeat(80) })).toBe(
      `Ada: ${'x'.repeat(60)}`,
    );
    expect(mainchainTaskState({ composer: baseComposer, targetSelected: true })).toBe('ready');
    expect(isExecutionTargetStillValid([{ id: 't1', label: 'A' }], 't2')).toBe(false);
    expect(isImageAttachment({
      id: 'a1',
      name: 'shot.png',
      mime: 'image/png',
      size: 12,
    })).toBe(true);
    expect(isAttachmentUploading(
      { percent: 40, phase: 'uploading' },
      { id: 'a1', name: 'shot.png', mime: 'image/png', size: 12 },
    )).toBe(true);

    const derived = deriveUnifiedComposerState({
      composer: baseComposer,
      executionTargets: [{ id: 'target-local-edge-1', label: 'Alpha Desktop' }],
      executionTargetId: '',
      mentionableAgents: [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
        { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
      ],
      status: { dataMode: 'approved-real' },
    });

    expect(derived.targetSelectionRequired).toBe(true);
    expect(derived.targetSelected).toBe(false);
    expect(derived.submitDisabled).toBe(true);
    expect(derived.selectedAgentLabel).toBe('@Builder');
    expect(derived.availableMentionOptions).toHaveLength(1);
    expect(derived.statusItems).toContain('数据：真实数据');
    expect(derived.statusItems).toContain('请先选择执行目标再开始。');
    expect(derived.mainchainTask).toBe('draft required');
  });

  describe('attachment size limit', () => {
    function fileOfSize(size: number, name: string): File {
      return new File([new Uint8Array(size)], name);
    }

    it('accepts files at or under the 50MB limit', () => {
      expect(validateAttachment(fileOfSize(0, 'empty.bin'))).toBeNull();
      expect(validateAttachment(fileOfSize(1024, 'small.txt'))).toBeNull();
      expect(validateAttachment(fileOfSize(MAX_ATTACHMENT_BYTES, 'at-limit.bin'))).toBeNull();
    });

    it('rejects files over the limit with a named message', () => {
      const message = validateAttachment(
        fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'huge.zip'),
      );
      expect(message).toContain('huge.zip');
      expect(message).toContain('50.0 MB');
    });

    it('partitions mixed batches without dropping files', () => {
      const small = fileOfSize(10, 'a.txt');
      const big = fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'b.zip');
      const exactly = fileOfSize(MAX_ATTACHMENT_BYTES, 'c.bin');
      const { accepted, rejected } = partitionAttachmentsBySize([small, big, exactly]);
      expect(accepted).toEqual([small, exactly]);
      expect(rejected).toEqual([big]);
    });

    it('builds single and multi-file oversize toasts', () => {
      expect(buildAttachmentOversizeToast([])).toBeUndefined();

      const one = buildAttachmentOversizeToast([fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'big.zip')]);
      expect(one).toContain('big.zip');
      expect(one).toContain('50.0 MB');

      const many = buildAttachmentOversizeToast([
        fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'a.zip'),
        fileOfSize(MAX_ATTACHMENT_BYTES + 2, 'b.zip'),
      ]);
      expect(many).toContain('2 个附件');
      expect(many).toContain('50.0 MB');
    });
  });
});
