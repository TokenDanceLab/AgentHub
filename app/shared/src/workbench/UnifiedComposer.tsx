import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browserFilesToComposerAttachments } from '../composer';
import type { ComposerMention } from '../composer';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import {
  detectMentionTrigger,
  filterMentionCandidates,
  removeMentionTriggerText,
  type MentionTrigger,
} from './composerMentionTrigger';
import {
  clampPopoverPosition,
  measureCaretCoords,
  planMentionPopoverKeyDown,
  type MentionPopoverCoords,
} from './composerMentionPopoverHelpers';
import { ComposerMentionPopover } from './ComposerMentionPopover';
import { filterAvailableMentionOptions } from './unifiedComposerHelpers';
import styles from './AgentHubWorkbench.module.css';
import {
  ComposerAgentPicker,
  ComposerAttachButton,
  ComposerAttachmentBar,
  ComposerEditBar,
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerSendButton,
  ComposerStatusStrip,
  ComposerTargetPicker,
} from './UnifiedComposerParts';
import {
  buildUnifiedComposerHostState,
  cancelEditAction,
  cancelQuoteAction,
  cancelReplyAction,
  dispatchComposerAttachmentAdds,
  planAddMentionAction,
  planComposerHostKeyDownEffect,
  removeAttachmentAction,
  removeMentionAction,
  resolveComposerFilePickChange,
  resolveComposerOpenFilePicker,
  setComposerTextAction,
  shouldClearExecutionTarget,
  type UnifiedComposerProps,
} from './unifiedComposerHostHelpers';

export type {
  AttachmentUploadState,
  ComposerStatusHints,
  UnifiedComposerProps,
} from './unifiedComposerHostHelpers';

export function UnifiedComposer({
  composer,
  dispatchComposer,
  executionTargets,
  executionTargetId,
  inputRef,
  mentionableAgents,
  onExecutionTargetChange,
  onPickLocalAttachments,
  onSubmit,
  status,
  submitBehavior,
  targetLabel,
  uploadProgresses,
  isRunning,
  onCancel,
}: UnifiedComposerProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { runtime, view } = buildUnifiedComposerHostState({
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    submitBehavior,
    targetLabel,
    onPickLocalAttachments,
    status,
    uploadProgresses,
  });
  const { chromeModel } = view;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shouldClearExecutionTarget(executionTargets, runtime.executionTargetId)) return;
    onExecutionTargetChange?.('');
  }, [runtime.executionTargetId, executionTargets, onExecutionTargetChange]);

  /* ═══════════════ @mention inline popover (T11 / UI1) ═══════════════
     The textarea reports every text/cursor change to evaluateTrigger; an
     active '@' before the caret (preceded by whitespace, no whitespace in
     the query segment) opens the popover. The popover reuses the existing
     mentionableAgents data + planAddMentionAction so dispatchRole ('context'
     vs 'dispatch') semantics flow through unchanged. IME composition is
     guarded via compositionRef so '@' detection never fires mid-composition. */

  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [popoverCoords, setPopoverCoords] = useState<MentionPopoverCoords | null>(null);
  const compositionRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();

  const mentionCandidates = mentionTrigger
    ? filterMentionCandidates({
        candidates: filterAvailableMentionOptions(runtime.mentionableAgents, composer.mentions),
        query: mentionTrigger.query,
      })
    : [];
  const popoverOpen = mentionTrigger !== null;
  const clampedActiveIndex =
    mentionCandidates.length === 0
      ? 0
      : Math.min(mentionActiveIndex, mentionCandidates.length - 1);

  const setTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof inputRef === 'function') {
        inputRef(node);
      } else if (inputRef) {
        (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    },
    [inputRef],
  );

  function evaluateTrigger(textarea: HTMLTextAreaElement): void {
    if (compositionRef.current) return;
    const value = textarea.value;
    const caret = textarea.selectionStart ?? value.length;
    const trigger =
      runtime.mentionableAgents.length === 0
        ? null
        : detectMentionTrigger({ text: value, caret });
    // Skip the state update when nothing changed (avoid popover churn).
    const unchanged =
      mentionTrigger &&
      trigger &&
      mentionTrigger.atOffset === trigger.atOffset &&
      mentionTrigger.query === trigger.query &&
      mentionTrigger.caret === trigger.caret;
    if (unchanged) return;
    // Reset the highlight to the top whenever a fresh trigger or new query
    // appears; clampedActiveIndex keeps the render in range until then.
    if (trigger && (!mentionTrigger || mentionTrigger.query !== trigger.query)) {
      setMentionActiveIndex(0);
    }
    setMentionTrigger(trigger);
  }

  function handleTextChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    dispatchComposer(setComposerTextAction(event.target.value));
    evaluateTrigger(event.currentTarget);
  }

  function selectMentionCandidate(mention: ComposerMention): void {
    if (!mentionTrigger) return;
    const { nextText, nextCaret } = removeMentionTriggerText({
      text: composer.text,
      atOffset: mentionTrigger.atOffset,
      caret: mentionTrigger.caret,
    });
    dispatchComposer(setComposerTextAction(nextText));
    const action = planAddMentionAction(runtime.mentionableAgents, mention.id);
    if (action) dispatchComposer(action);
    setMentionTrigger(null);
    setMentionActiveIndex(0);
    window.requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (input) {
        input.setSelectionRange(nextCaret, nextCaret);
        input.focus();
      }
    });
  }

  // Recompute popover position when the trigger or text changes.
  useLayoutEffect(() => {
    if (!mentionTrigger) {
      setPopoverCoords(null);
      return;
    }
    const textarea = textareaRef.current;
    const caret = measureCaretCoords(textarea, mentionTrigger.caret);
    if (!caret) {
      setPopoverCoords(null);
      return;
    }
    const popoverEl =
      typeof document === 'undefined'
        ? null
        : document.getElementById(listboxId);
    const popoverWidth = popoverEl?.offsetWidth ?? 280;
    const popoverHeight = popoverEl?.offsetHeight ?? 240;
    setPopoverCoords(
      clampPopoverPosition({
        caretTop: caret.top,
        caretLeft: caret.left,
        caretHeight: caret.height,
        popoverWidth,
        popoverHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, [mentionTrigger, composer.text, listboxId]);

  // Close the popover on outside pointer down (clicks inside the popover or
  // textarea are ignored; textarea moves re-evaluate via onSelect).
  useEffect(() => {
    if (!mentionTrigger) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) return;
      const popover =
        typeof document === 'undefined' ? null : document.getElementById(listboxId);
      if (popover?.contains(target)) return;
      if (textareaRef.current?.contains(target)) return;
      setMentionTrigger(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [mentionTrigger, listboxId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const popoverPlan = planMentionPopoverKeyDown({
      key: event.key,
      isComposing: event.nativeEvent.isComposing,
      popoverOpen,
      candidateCount: mentionCandidates.length,
    });
    if (popoverPlan.kind !== 'none' && popoverPlan.kind !== 'close-defer') {
      event.preventDefault();
      if (popoverPlan.kind === 'close') {
        setMentionTrigger(null);
      } else if (popoverPlan.kind === 'move') {
        const next = clampedActiveIndex + popoverPlan.delta;
        setMentionActiveIndex(Math.max(0, Math.min(next, mentionCandidates.length - 1)));
      } else if (popoverPlan.kind === 'select') {
        const active = mentionCandidates[clampedActiveIndex];
        if (active) selectMentionCandidate(active);
      }
      return;
    }
    if (popoverPlan.kind === 'close-defer') {
      setMentionTrigger(null);
      // Fall through to the normal submit/newline planner.
    }
    const effect = planComposerHostKeyDownEffect({
      event,
      submitBehavior: runtime.submitBehavior,
      composerText: composer.text,
      attachments: composer.attachments,
      isSubmitting: view.isSubmitting,
      targetSelectionRequired: view.targetSelectionRequired,
      executionTargetId: runtime.executionTargetId,
    });
    if (effect.kind === 'none') return;
    event.preventDefault();
    if (effect.kind === 'insert-newline') {
      const input = event.currentTarget;
      dispatchComposer(effect.textAction);
      window.requestAnimationFrame(() => {
        input.selectionStart = effect.caret.selectionStart;
        input.selectionEnd = effect.caret.selectionEnd;
      });
      return;
    }
    if (effect.kind === 'submit') event.currentTarget.form?.requestSubmit();
  }

  function selectMention(agentId: string): void {
    const action = planAddMentionAction(runtime.mentionableAgents, agentId);
    if (action) dispatchComposer(action);
  }

  const handleFilePick = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const result = await resolveComposerFilePickChange({
      fileList: event.target.files,
      hasNativePicker: runtime.hasNativePicker,
      onPickLocalAttachments,
      browserFilesToAttachments: browserFilesToComposerAttachments,
    });
    if (result.kind === 'noop') return;
    dispatchComposerAttachmentAdds(dispatchComposer, result.attachments);
    if (result.resetInput && fileInputRef.current) fileInputRef.current.value = '';
  }, [dispatchComposer, onPickLocalAttachments, runtime.hasNativePicker]);

  function openFilePicker(): void {
    void resolveComposerOpenFilePicker({
      hasNativePicker: runtime.hasNativePicker,
      onPickLocalAttachments,
    }).then((result) => {
      if (result.kind === 'web-input') {
        fileInputRef.current?.click();
        return;
      }
      dispatchComposerAttachmentAdds(dispatchComposer, result.attachments);
    });
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      {chromeModel.replyTo && (
        <ComposerReplyBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelReplyAction())}
          replyTo={chromeModel.replyTo}
        />
      )}
      {chromeModel.quote && (
        <ComposerQuoteBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelQuoteAction())}
          quote={chromeModel.quote}
        />
      )}
      {composer.editingMessageId && (
        <ComposerEditBar
          isSubmitting={view.isSubmitting}
          onCancel={() => dispatchComposer(cancelEditAction())}
        />
      )}
      {chromeModel.mentions && (
        <ComposerMentionChips
          isSubmitting={view.isSubmitting}
          mentions={chromeModel.mentions}
          onRemove={(id) => dispatchComposer(removeMentionAction(id))}
        />
      )}
      {chromeModel.mainchain && (
        <ComposerMainchainStrip {...chromeModel.mainchain} />
      )}
      {chromeModel.attachment && (
        <ComposerAttachmentBar
          attachments={chromeModel.attachment.attachments}
          isSubmitting={view.isSubmitting}
          onRemove={(id) => dispatchComposer(removeAttachmentAction(id))}
          uploadProgresses={chromeModel.attachment.uploadProgresses}
        />
      )}
      <div className={styles.composerRow}>
        <textarea
          aria-label={t('aria.composerInput')}
          aria-expanded={popoverOpen}
          aria-controls={popoverOpen ? listboxId : undefined}
          aria-activedescendant={
            popoverOpen && mentionCandidates.length > 0
              ? `${listboxId}-opt-${clampedActiveIndex}`
              : undefined
          }
          data-composer-input
          className={styles.composerInput}
          ref={setTextareaRef}
          onChange={handleTextChange}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={(event) => {
            compositionRef.current = false;
            evaluateTrigger(event.currentTarget);
          }}
          onSelect={(event) => evaluateTrigger(event.currentTarget)}
          onKeyDown={handleKeyDown}
          placeholder={view.inputPlaceholder}
          rows={1}
          value={composer.text}
        />
        <input
          accept={view.fileAccept}
          aria-hidden="true"
          hidden
          onChange={handleFilePick}
          ref={fileInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />
        <ComposerAttachButton isSubmitting={view.isSubmitting} onClick={openFilePicker} />
        {chromeModel.agentOptions && (
          <ComposerAgentPicker
            availableMentionOptions={chromeModel.agentOptions}
            isSubmitting={view.isSubmitting}
            onSelect={selectMention}
          />
        )}
        {chromeModel.targetPicker && (
          <ComposerTargetPicker
            {...chromeModel.targetPicker}
            isSubmitting={view.isSubmitting}
            onChange={(id) => onExecutionTargetChange?.(id)}
          />
        )}
        <ComposerSendButton
          hasMentions={view.hasMentions}
          isRunning={isRunning}
          onCancel={onCancel}
          submitDisabled={view.submitDisabled}
        />
      </div>
      {chromeModel.statusItems && (
        <ComposerStatusStrip statusItems={chromeModel.statusItems} />
      )}
      {popoverOpen && (
        <ComposerMentionPopover
          candidates={mentionCandidates}
          activeIndex={clampedActiveIndex}
          coords={popoverCoords}
          listboxId={listboxId}
          onSelect={selectMentionCandidate}
          onHover={setMentionActiveIndex}
        />
      )}
    </form>
  );
}
