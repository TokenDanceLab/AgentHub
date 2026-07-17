import { describe, expect, it } from 'vitest';
import type { ComposerAttachment, ComposerMention } from '../composer';
import {
  agentPickerPlaceholder,
  buildAttachmentChipViewModel,
  formatAgentOptionLabel,
  formatMainchainAgentLabel,
  formatMainchainTargetLabel,
  formatMainchainTaskLabel,
  formatMentionChipLabel,
  formatReplyToLabel,
  mainchainDataState,
  resolveAttachmentUploadProgress,
  targetPickerPlaceholder,
} from './ComposerPartsHelpers';

const imageAttachment: ComposerAttachment = {
  id: 'att-1',
  name: 'shot.png',
  mime: 'image/png',
  size: 2048,
  contentPreview: 'AB12preview',
};

const textAttachment: ComposerAttachment = {
  id: 'att-2',
  name: 'notes.txt',
  mime: 'text/plain',
  size: 12,
};

describe('ComposerPartsHelpers', () => {
  it('formats reply, mention, and mainchain labels without UX drift', () => {
    expect(formatReplyToLabel({ author: 'Ada', preview: 'hello' })).toBe(
      '回复至 Ada: hello',
    );
    expect(formatMentionChipLabel({ id: 'a1', label: 'Builder' })).toBe('@Builder');
    expect(formatMainchainAgentLabel('@Builder')).toBe('Agent @Builder');
    expect(formatMainchainTargetLabel(undefined)).toBe('Target missing');
    expect(formatMainchainTargetLabel('Desktop')).toBe('Target Desktop');
    expect(formatMainchainTaskLabel('ready')).toBe('Task ready');
    expect(formatMainchainTaskLabel('draft required')).toBe('Task draft required');
    expect(mainchainDataState(true)).toBe('selected');
    expect(mainchainDataState(false)).toBe('missing');
  });

  it('builds picker placeholders and agent option labels', () => {
    expect(agentPickerPlaceholder(0)).toBe('All agents mentioned');
    expect(agentPickerPlaceholder(2)).toBe('Mention agent');
    expect(targetPickerPlaceholder(0)).toBe('No online target');
    expect(targetPickerPlaceholder(1)).toBe('Select target');

    const withRuntime: ComposerMention = {
      id: 'profile-builder',
      label: 'Builder',
      runtimeId: 'claude-code',
    };
    const withoutRuntime: ComposerMention = {
      id: 'profile-reviewer',
      label: 'Reviewer',
    };
    expect(formatAgentOptionLabel(withRuntime)).toBe('Builder (claude-code)');
    expect(formatAgentOptionLabel(withoutRuntime)).toBe('Reviewer');
  });

  it('derives attachment chip view-model and resolves upload progress', () => {
    const uploading = buildAttachmentChipViewModel({
      attachment: imageAttachment,
      uploadProgress: { percent: 42, phase: 'uploading' },
    });
    expect(uploading.isImage).toBe(true);
    expect(uploading.isUploading).toBe(true);
    expect(uploading.uploadPercent).toBe(42);
    expect(uploading.thumbPreview).toBe('AB');
    expect(uploading.sizeLabel).toBeTruthy();

    const idle = buildAttachmentChipViewModel({
      attachment: textAttachment,
      uploadProgress: undefined,
    });
    expect(idle.isImage).toBe(false);
    expect(idle.isUploading).toBe(false);
    expect(idle.uploadPercent).toBe(0);
    expect(idle.thumbPreview).toBeUndefined();

    const map = {
      'att-1': { percent: 10, phase: 'hashing' as const },
    };
    expect(resolveAttachmentUploadProgress(map, 'att-1')).toEqual({
      percent: 10,
      phase: 'hashing',
    });
    expect(resolveAttachmentUploadProgress(map, 'missing')).toBeUndefined();
    expect(resolveAttachmentUploadProgress(undefined, 'att-1')).toBeUndefined();
  });
});
