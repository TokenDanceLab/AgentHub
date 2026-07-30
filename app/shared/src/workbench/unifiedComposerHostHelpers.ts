/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostHelpers — stable public surface for UnifiedComposer
   host pure helpers (#718 / residual thin #780).

   Implementation lives in:
   - unifiedComposerHostViewModel
   - unifiedComposerHostKeyDown
   - unifiedComposerHostActions
   - unifiedComposerHostFilePick

   Re-exports keep import paths stable for UnifiedComposer and tests.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type {
  AttachmentUploadState,
  ComposerExecutionTarget,
  ComposerStatusHints,
  UnifiedComposerProps,
  ComposerChromeVisibility,
  ComposerHostRuntimeDefaults,
  ComposerHostMainchainModel,
  ComposerHostAttachmentModel,
  ComposerHostTargetPickerModel,
  ComposerHostChromeModel,
  ComposerHostViewModel,
  UnifiedComposerHostState,
} from './unifiedComposerHostViewModel';

export {
  composerInputPlaceholder,
  resolveComposerHostRuntime,
  shouldClearExecutionTarget,
  deriveComposerChromeVisibility,
  buildComposerHostChromeModel,
  buildComposerHostViewModel,
  buildUnifiedComposerHostState,
} from './unifiedComposerHostViewModel';

export type {
  ComposerHostKeyDownPlan,
  ComposerKeyDownEventFields,
  ComposerCaretRestore,
  ComposerHostKeyDownEffect,
} from './unifiedComposerHostKeyDown';

export {
  composerHostKeyDownEffect,
  planComposerHostKeyDownEffect,
  readComposerKeyDownEventFields,
  planComposerHostKeyDown,
  planComposerHostKeyDownFromEvent,
  composerCaretRestore,
} from './unifiedComposerHostKeyDown';

export {
  planAddMentionAction,
  composerAttachmentAddActions,
  cancelReplyAction,
  cancelQuoteAction,
  cancelEditAction,
  removeMentionAction,
  removeAttachmentAction,
  setComposerTextAction,
  setEditingMessageAction,
  dispatchComposerAttachmentAdds,
} from './unifiedComposerHostActions';

export type {
  ComposerFilePickPlan,
  ComposerOpenFilePickerPlan,
  ComposerFilePickResolution,
  ComposerOpenFilePickerResolution,
} from './unifiedComposerHostFilePick';

export {
  planComposerFilePick,
  planOpenFilePicker,
  resolveComposerFilePickAttachments,
  resolveOpenFilePickerAttachments,
  resolveComposerFilePickChange,
  resolveComposerOpenFilePicker,
} from './unifiedComposerHostFilePick';

// Re-export COMPOSER_FILE_ACCEPT for consumers that imported it via host helpers.
export { COMPOSER_FILE_ACCEPT } from './unifiedComposerHelpers';
