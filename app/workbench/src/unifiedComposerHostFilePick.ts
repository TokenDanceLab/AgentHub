import type { ComposerAttachment } from '@shared/composer';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostFilePick — pure file-picker residual slices from
   unifiedComposerHostHelpers (#780).

   File-input / native-picker planners and attachment resolution.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type ComposerFilePickPlan =
  | { kind: 'noop' }
  | { kind: 'native' }
  | { kind: 'browser'; files: File[] };

export type ComposerOpenFilePickerPlan =
  | { kind: 'native' }
  | { kind: 'web-input' };

export type ComposerFilePickResolution =
  | { kind: 'noop' }
  | { kind: 'attachments'; attachments: ComposerAttachment[]; resetInput: true };

export type ComposerOpenFilePickerResolution =
  | { kind: 'web-input' }
  | { kind: 'attachments'; attachments: ComposerAttachment[] };

/**
 * Plan file-input change handling.
 * Native picker wins when provided (desktop), even if the hidden input fired.
 */
export function planComposerFilePick(params: {
  fileList: FileList | null;
  hasNativePicker: boolean;
}): ComposerFilePickPlan {
  if (params.hasNativePicker) return { kind: 'native' };
  if (!params.fileList || params.fileList.length === 0) return { kind: 'noop' };
  return { kind: 'browser', files: Array.from(params.fileList) };
}

/** Plan attach-button click: native desktop picker vs hidden web input. */
export function planOpenFilePicker(
  hasNativePicker: boolean,
): ComposerOpenFilePickerPlan {
  return hasNativePicker ? { kind: 'native' } : { kind: 'web-input' };
}

/**
 * Resolve attachments for a planned file pick.
 * Keeps browser conversion injectable so the helper stays testable/pure-ish.
 */
export async function resolveComposerFilePickAttachments(params: {
  plan: ComposerFilePickPlan;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  browserFilesToAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
}): Promise<ComposerAttachment[]> {
  const { plan, onPickLocalAttachments, browserFilesToAttachments } = params;
  if (plan.kind === 'native') {
    if (!onPickLocalAttachments) return [];
    try {
      return await onPickLocalAttachments();
    } catch {
      // User cancelled or picker failed — nothing to do
      return [];
    }
  }
  if (plan.kind === 'browser') {
    return browserFilesToAttachments(plan.files);
  }
  return [];
}

/** Resolve attachments for an attach-button open plan. */
export async function resolveOpenFilePickerAttachments(params: {
  plan: ComposerOpenFilePickerPlan;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
}): Promise<ComposerAttachment[] | null> {
  const { plan, onPickLocalAttachments } = params;
  if (plan.kind !== 'native') return null;
  if (!onPickLocalAttachments) return [];
  try {
    return await onPickLocalAttachments();
  } catch {
    // User cancelled
    return [];
  }
}

/**
 * Plan + resolve a hidden file-input change into host dispatch payloads.
 * Returns noop when the file list is empty and no native picker is configured.
 */
export async function resolveComposerFilePickChange(params: {
  fileList: FileList | null;
  hasNativePicker: boolean;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  browserFilesToAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
}): Promise<ComposerFilePickResolution> {
  const plan = planComposerFilePick({
    fileList: params.fileList,
    hasNativePicker: params.hasNativePicker,
  });
  if (plan.kind === 'noop') return { kind: 'noop' };
  const attachments = await resolveComposerFilePickAttachments({
    plan,
    onPickLocalAttachments: params.onPickLocalAttachments,
    browserFilesToAttachments: params.browserFilesToAttachments,
  });
  return { kind: 'attachments', attachments, resetInput: true };
}

/** Plan + resolve attach-button click into host dispatch payloads. */
export async function resolveComposerOpenFilePicker(params: {
  hasNativePicker: boolean;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
}): Promise<ComposerOpenFilePickerResolution> {
  const attachments = await resolveOpenFilePickerAttachments({
    plan: planOpenFilePicker(params.hasNativePicker),
    onPickLocalAttachments: params.onPickLocalAttachments,
  });
  if (attachments === null) return { kind: 'web-input' };
  return { kind: 'attachments', attachments };
}
