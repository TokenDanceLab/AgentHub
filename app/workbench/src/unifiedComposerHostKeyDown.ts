import type { ComposerAction, ComposerAttachment } from '@shared/composer';
import type { ComposerSubmitBehavior } from './workbenchPreferences';
import {
  buildTextWithNewline,
  canSubmitFromKeyDown,
  shouldSubmitComposerKey,
} from './unifiedComposerHelpers';
import { setComposerTextAction } from './unifiedComposerHostActions';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostKeyDown — pure keydown residual slices from
   unifiedComposerHostHelpers (#780).

   Keydown event field readers, submit/newline planners, and host effect
   mappers. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type ComposerHostKeyDownPlan =
  | { kind: 'none' }
  | { kind: 'insert-newline'; nextText: string; caret: number }
  | { kind: 'submit' }
  | { kind: 'blocked-submit' };

export interface ComposerKeyDownEventFields {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  currentText: string;
}

export interface ComposerCaretRestore {
  selectionStart: number;
  selectionEnd: number;
}

export type ComposerHostKeyDownEffect =
  | { kind: 'none' }
  | { kind: 'insert-newline'; textAction: Extract<ComposerAction, { type: 'setText' }>; caret: ComposerCaretRestore }
  | { kind: 'submit' }
  | { kind: 'blocked-submit' };

/** Map a keydown plan into host side-effect descriptors. */
export function composerHostKeyDownEffect(
  plan: ComposerHostKeyDownPlan,
): ComposerHostKeyDownEffect {
  if (plan.kind === 'insert-newline') {
    return {
      kind: 'insert-newline',
      textAction: setComposerTextAction(plan.nextText),
      caret: composerCaretRestore(plan.caret),
    };
  }
  if (plan.kind === 'submit') return { kind: 'submit' };
  if (plan.kind === 'blocked-submit') return { kind: 'blocked-submit' };
  return { kind: 'none' };
}

/** Full keydown event → host effect planner. */
export function planComposerHostKeyDownEffect(params: {
  event: {
    key: string;
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    currentTarget: {
      selectionStart: number | null;
      selectionEnd: number | null;
      value: string;
    };
  };
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
  isRunning: boolean;
}): ComposerHostKeyDownEffect {
  return composerHostKeyDownEffect(planComposerHostKeyDownFromEvent(params));
}

/** Snapshot keyboard event fields used by the host keydown planner. */
export function readComposerKeyDownEventFields(event: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent: { isComposing: boolean };
  currentTarget: {
    selectionStart: number | null;
    selectionEnd: number | null;
    value: string;
  };
}): ComposerKeyDownEventFields {
  return {
    key: event.key,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    isComposing: event.nativeEvent.isComposing,
    selectionStart: event.currentTarget.selectionStart,
    selectionEnd: event.currentTarget.selectionEnd,
    // Prefer the textarea DOM value over React state to avoid stale submit
    // when Enter races an in-flight onChange batch.
    currentText: event.currentTarget.value ?? '',
  };
}

/**
 * Plan host keydown behavior for the composer textarea.
 * `blocked-submit` means preventDefault without requestSubmit (mirrors shell).
 */
export function planComposerHostKeyDown(params: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  currentText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
  isRunning: boolean;
}): ComposerHostKeyDownPlan {
  const keyPlan = shouldSubmitComposerKey({
    key: params.key,
    altKey: params.altKey,
    shiftKey: params.shiftKey,
    ctrlKey: params.ctrlKey,
    metaKey: params.metaKey,
    isComposing: params.isComposing,
    submitBehavior: params.submitBehavior,
  });

  if (keyPlan.insertNewline) {
    const { nextText, caret } = buildTextWithNewline({
      text: params.composerText,
      selectionStart: params.selectionStart,
      selectionEnd: params.selectionEnd,
    });
    return { kind: 'insert-newline', nextText, caret };
  }

  if (!keyPlan.shouldSubmit) return { kind: 'none' };

  if (canSubmitFromKeyDown({
    currentText: params.currentText,
    attachments: params.attachments,
    isSubmitting: params.isSubmitting,
    targetSelectionRequired: params.targetSelectionRequired,
    executionTargetId: params.executionTargetId,
    isRunning: params.isRunning,
  })) {
    return { kind: 'submit' };
  }

  return { kind: 'blocked-submit' };
}

/** Read + plan keydown in one pure step for the host handler. */
export function planComposerHostKeyDownFromEvent(params: {
  event: {
    key: string;
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    currentTarget: {
      selectionStart: number | null;
      selectionEnd: number | null;
      value: string;
    };
  };
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
  isRunning: boolean;
}): ComposerHostKeyDownPlan {
  const fields = readComposerKeyDownEventFields(params.event);
  return planComposerHostKeyDown({
    ...fields,
    submitBehavior: params.submitBehavior,
    composerText: params.composerText,
    attachments: params.attachments,
    isSubmitting: params.isSubmitting,
    targetSelectionRequired: params.targetSelectionRequired,
    executionTargetId: params.executionTargetId,
    isRunning: params.isRunning,
  });
}

/** Pure caret restore values after insert-newline. */
export function composerCaretRestore(caret: number): ComposerCaretRestore {
  return {
    selectionStart: caret,
    selectionEnd: caret,
  };
}
