import { describe, expect, it } from 'vitest';
import type { ComposerMention, ComposerState } from '@shared/composer';
import {
  MAX_ATTACHMENT_BYTES,
  buildAttachmentOversizeToast,
  buildComposerStatusItems,
  buildTextWithNewline,
  canSubmitFromKeyDown,
  deriveUnifiedComposerState,
  filterAvailableMentionOptions,
  findMentionById,
  formatComposerDataModeLabel,
  formatComposerTargetStateLabel,
  formatQuotePreview,
  formatSelectedAgentLabel,
  isAttachmentUploadFailed,
  isAttachmentUploadInFlight,
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

  describe('attachment upload state flags', () => {
    it('treats hashing and uploading as in flight, done/failed/undefined as not', () => {
      expect(isAttachmentUploadInFlight({ percent: 5, phase: 'hashing' })).toBe(true);
      expect(isAttachmentUploadInFlight({ percent: 60, phase: 'uploading' })).toBe(true);
      expect(isAttachmentUploadInFlight({ percent: 100, phase: 'done' })).toBe(false);
      expect(isAttachmentUploadInFlight({ percent: 100, phase: 'failed' })).toBe(false);
      expect(isAttachmentUploadInFlight(undefined)).toBe(false);
    });

    it('flags only the failed phase as retryable', () => {
      expect(isAttachmentUploadFailed({ percent: 100, phase: 'failed' })).toBe(true);
      expect(isAttachmentUploadFailed({ percent: 100, phase: 'done' })).toBe(false);
      expect(isAttachmentUploadFailed(undefined)).toBe(false);
    });
  });

  describe('label formatting and target validity', () => {
    it('maps every known dataMode code and echoes unknown ones', () => {
      expect(formatComposerDataModeLabel('approved-real')).toBe('真实数据');
      expect(formatComposerDataModeLabel('observed')).toBe('观测数据');
      expect(formatComposerDataModeLabel('fixture')).toBe('示例数据');
      expect(formatComposerDataModeLabel('mock')).toBe('模拟数据');
      expect(formatComposerDataModeLabel('auto')).toBe('自动');
      expect(formatComposerDataModeLabel('custom-mode')).toBe('custom-mode');
    });

    it('maps every known target state code and echoes unknown ones', () => {
      expect(formatComposerTargetStateLabel('ready')).toBe('就绪');
      expect(formatComposerTargetStateLabel('offline')).toBe('离线');
      expect(formatComposerTargetStateLabel('busy')).toBe('忙碌');
      expect(formatComposerTargetStateLabel('error')).toBe('异常');
      expect(formatComposerTargetStateLabel('weird')).toBe('weird');
    });

    it('treats missing targets or an empty selection as still valid', () => {
      expect(isExecutionTargetStillValid(undefined, 't1')).toBe(true);
      expect(isExecutionTargetStillValid([{ id: 't1', label: 'A' }], '')).toBe(true);
      expect(isExecutionTargetStillValid([{ id: 't1', label: 'A' }], 't1')).toBe(true);
    });

    it('resolves no target guidance when selection is optional or already made', () => {
      expect(resolveTargetStatus({
        targetSelectionRequired: false,
        executionTargetId: '',
        executionTargets: [],
      })).toBeUndefined();
      expect(resolveTargetStatus({
        targetSelectionRequired: true,
        executionTargetId: 'target-1',
        executionTargets: [],
      })).toBeUndefined();
    });

    it('finds mention options by id', () => {
      const mentions: ComposerMention[] = [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
        { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
      ];
      expect(findMentionById(mentions, 'profile-reviewer')?.label).toBe('Reviewer');
      expect(findMentionById(mentions, 'missing')).toBeUndefined();
      expect(filterAvailableMentionOptions(mentions, mentions.slice(0, 1))).toEqual([mentions[1]]);
    });
  });

  describe('shouldSubmitComposerKey guards', () => {
    const base = {
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'enter-send' as const,
    };

    it('never submits or inserts newlines for non-Enter keys and chorded Enter', () => {
      for (const key of ['a', 'Escape', 'Tab']) {
        expect(shouldSubmitComposerKey({ ...base, key }))
          .toEqual({ shouldSubmit: false, insertNewline: false });
      }
      expect(shouldSubmitComposerKey({ ...base, key: 'Enter', altKey: true }))
        .toEqual({ shouldSubmit: false, insertNewline: false });
      expect(shouldSubmitComposerKey({ ...base, key: 'Enter', shiftKey: true }))
        .toEqual({ shouldSubmit: false, insertNewline: false });
    });

    it('swallows Enter during IME composition', () => {
      expect(shouldSubmitComposerKey({ ...base, key: 'Enter', isComposing: true }))
        .toEqual({ shouldSubmit: false, insertNewline: false });
    });

    it('leaves plain Enter to the textarea under ctrl-enter-send', () => {
      expect(shouldSubmitComposerKey({ ...base, key: 'Enter', submitBehavior: 'ctrl-enter-send' }))
        .toEqual({ shouldSubmit: false, insertNewline: false });
    });
  });
});
