import { describe, expect, it } from 'vitest';
import {
  composerCaretRestore,
  composerHostKeyDownEffect,
  planComposerHostKeyDown,
  planComposerHostKeyDownEffect,
  planComposerHostKeyDownFromEvent,
  readComposerKeyDownEventFields,
} from './unifiedComposerHostKeyDown';

describe('unifiedComposerHostKeyDown', () => {
  it('reads keydown event fields and plans host keydown', () => {
    expect(readComposerKeyDownEventFields({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      nativeEvent: { isComposing: false },
      currentTarget: {
        selectionStart: 1,
        selectionEnd: 1,
        value: 'ab',
      },
    })).toEqual({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      selectionStart: 1,
      selectionEnd: 1,
      currentText: 'ab',
    });

    expect(planComposerHostKeyDown({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'enter-send',
      composerText: 'ab',
      selectionStart: 1,
      selectionEnd: 1,
      currentText: 'ab',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: false,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({ kind: 'insert-newline', nextText: 'a\nb', caret: 2 });

    expect(planComposerHostKeyDownFromEvent({
      event: {
        key: 'Enter',
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        nativeEvent: { isComposing: false },
        currentTarget: {
          selectionStart: 5,
          selectionEnd: 5,
          value: 'hello',
        },
      },
      submitBehavior: 'enter-send',
      composerText: 'hello',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: true,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({ kind: 'blocked-submit' });

    expect(composerCaretRestore(4)).toEqual({
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it('maps keydown plans into host side-effect descriptors', () => {
    expect(composerHostKeyDownEffect({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(composerHostKeyDownEffect({ kind: 'submit' })).toEqual({ kind: 'submit' });
    expect(composerHostKeyDownEffect({ kind: 'blocked-submit' })).toEqual({
      kind: 'blocked-submit',
    });
    expect(composerHostKeyDownEffect({
      kind: 'insert-newline',
      nextText: 'a\nb',
      caret: 2,
    })).toEqual({
      kind: 'insert-newline',
      textAction: { type: 'setText', text: 'a\nb' },
      caret: { selectionStart: 2, selectionEnd: 2 },
    });
  });

  it('plans full keydown event → host effect', () => {
    expect(planComposerHostKeyDownEffect({
      event: {
        key: 'Enter',
        altKey: false,
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        nativeEvent: { isComposing: false },
        currentTarget: {
          selectionStart: 1,
          selectionEnd: 1,
          value: 'ab',
        },
      },
      submitBehavior: 'enter-send',
      composerText: 'ab',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: false,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({
      kind: 'insert-newline',
      textAction: { type: 'setText', text: 'a\nb' },
      caret: { selectionStart: 2, selectionEnd: 2 },
    });

    expect(planComposerHostKeyDownEffect({
      event: {
        key: 'Enter',
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        nativeEvent: { isComposing: false },
        currentTarget: {
          selectionStart: 5,
          selectionEnd: 5,
          value: 'hello',
        },
      },
      submitBehavior: 'enter-send',
      composerText: 'hello',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: false,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({ kind: 'submit' });
  });
});
