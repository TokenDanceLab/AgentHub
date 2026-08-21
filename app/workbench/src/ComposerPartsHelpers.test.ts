import { describe, expect, it } from 'vitest';
import type { ComposerAttachment, ComposerMention } from '@shared/composer';
import {
  agentPickerPlaceholder,
  buildAttachmentChipViewModel,
  formatAgentOptionLabel,
  formatMainchainAgentLabel,
  formatMainchainTargetLabel,
  formatMainchainTaskLabel,
  formatMentionChipLabel,
  formatReplyToLabel,
  isMediaAttachment,
  mainchainDataState,
  resolveAttachmentPreviewKind,
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
    expect(formatMainchainTargetLabel(undefined)).toBe('目标未选');
    expect(formatMainchainTargetLabel('Desktop')).toBe('目标 Desktop');
    expect(formatMainchainTaskLabel('ready')).toBe('任务就绪');
    expect(formatMainchainTaskLabel('draft required')).toBe('需填写内容');
    expect(mainchainDataState(true)).toBe('selected');
    expect(mainchainDataState(false)).toBe('missing');
  });

  it('builds picker placeholders and agent option labels', () => {
    expect(agentPickerPlaceholder(0)).toBe('已全部提及');
    expect(agentPickerPlaceholder(2)).toBe('选择 Agent');
    expect(targetPickerPlaceholder(0)).toBe('无在线目标');
    expect(targetPickerPlaceholder(1)).toBe('选择执行目标');

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
    expect(uploading.previewKind).toBe('image');
    expect(uploading.sizeLabel).toBeTruthy();

    const idle = buildAttachmentChipViewModel({
      attachment: textAttachment,
      uploadProgress: undefined,
    });
    expect(idle.isImage).toBe(false);
    expect(idle.isMedia).toBe(false);
    expect(idle.isUploading).toBe(false);
    expect(idle.uploadPercent).toBe(0);
    expect(idle.previewKind).toBeUndefined();

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

  it('resolves image / media / code preview kinds', () => {
    expect(resolveAttachmentPreviewKind(imageAttachment)).toBe('image');
    expect(resolveAttachmentPreviewKind(textAttachment)).toBeUndefined();
    expect(resolveAttachmentPreviewKind({
      id: 'a1',
      name: 'notes.txt',
      mime: 'text/plain',
      size: 12,
      contentPreview: 'hello\nworld',
    })).toBe('code');
    expect(isMediaAttachment({
      id: 'a1',
      name: 'clip.mp4',
      mime: 'video/mp4',
      size: 99,
    })).toBe(true);
    expect(isMediaAttachment({
      id: 'a1',
      name: 'voice.mp3',
      size: 99,
    })).toBe(true);
    expect(isMediaAttachment({
      id: 'a1',
      name: 'notes.txt',
      mime: 'text/plain',
      size: 99,
    })).toBe(false);
    expect(resolveAttachmentPreviewKind({
      id: 'a1',
      name: 'clip.mp4',
      mime: 'video/mp4',
      size: 99,
    })).toBe('media');
    expect(resolveAttachmentPreviewKind({
      id: 'a1',
      name: 'archive.zip',
      size: 99,
    })).toBeUndefined();
  });
});
