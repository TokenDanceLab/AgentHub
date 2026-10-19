import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browserFilesToComposerAttachments, clearDraft, loadDraft, saveDraft, serializeDraft } from '@shared/composer';
import type { ComposerAttachment, ComposerMention, QuoteContext, ReplyToContext } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@shared/shadcn/ui/input-group';
import { cn } from '@shared/lib/utils';
import {
  buildAttachmentOversizeToast,
  filterAvailableMentionOptions,
  partitionAttachmentsBySize,
} from './unifiedComposerHelpers';
import styles from './AgentHubWorkbench.module.css';
import {
  ComposerAgentPicker,
  ComposerApprovalModePicker,
  ComposerAttachButton as ComposerAttachButtonBase,
  ComposerAttachmentBar as ComposerAttachmentBarBase,
  ComposerEditBar as ComposerEditBarBase,
  ComposerMainchainStrip as ComposerMainchainStripBase,
  ComposerMentionChips as ComposerMentionChipsBase,
  ComposerQuoteBar as ComposerQuoteBarBase,
  ComposerReplyBar as ComposerReplyBarBase,
  ComposerSendButton as ComposerSendButtonBase,
  ComposerStatusStrip,
  ComposerTargetPicker as ComposerTargetPickerBase,
} from './UnifiedComposerParts';

/* #21 性能：composer 状态每次击键都变（textarea 值必要更新），UnifiedComposer
   自身每击键重渲染不可避免；但子面板的 props 在击键时大多保持稳定（数据来自
   composer 状态的稳定引用 + useCallback 稳定的回调），包一层 React.memo 跳过
   不必要的子树重渲染。
   ─ ComposerAgentPicker / ComposerStatusStrip 未包：availableMentionOptions /
     statusItems 每次渲染由纯函数重建（新引用），memo 无效。 */
const ComposerReplyBar = React.memo(ComposerReplyBarBase);
const ComposerQuoteBar = React.memo(ComposerQuoteBarBase);
const ComposerEditBar = React.memo(ComposerEditBarBase);
const ComposerMentionChips = React.memo(ComposerMentionChipsBase);
const ComposerMainchainStrip = React.memo(ComposerMainchainStripBase);
const ComposerAttachmentBar = React.memo(ComposerAttachmentBarBase);
const ComposerTargetPicker = React.memo(ComposerTargetPickerBase);
const ComposerSendButton = React.memo(ComposerSendButtonBase);
const ComposerAttachButton = React.memo(ComposerAttachButtonBase);
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
  onRetryAttachmentUpload,
  isRunning,
  onCancel,
  onToast,
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

  /* #21 性能：稳定回调（依赖仅 dispatchComposer —— useReducer dispatch 跨渲染
     稳定），配合上方子组件 React.memo，跳过击键时子面板的不必要重渲染。 */
  const handleCancelReply = useCallback(() => dispatchComposer(cancelReplyAction()), [dispatchComposer]);
  const handleCancelQuote = useCallback(() => dispatchComposer(cancelQuoteAction()), [dispatchComposer]);
  const handleCancelEdit = useCallback(() => dispatchComposer(cancelEditAction()), [dispatchComposer]);
  const handleRemoveMention = useCallback(
    (id: string) => dispatchComposer(removeMentionAction(id)),
    [dispatchComposer],
  );
  const handleRemoveAttachment = useCallback(
    (id: string) => dispatchComposer(removeAttachmentAction(id)),
    [dispatchComposer],
  );
  const handleExecutionTargetChange = useCallback(
    (id: string) => onExecutionTargetChange?.(id),
    [onExecutionTargetChange],
  );

  /**
   * Uploads currently in flight, for the progress line shown while the
   * composer is submitting (the attachment chips are cleared optimistically,
   * so the bar would otherwise vanish mid-upload, #1821).
   */
  const inFlightUploadSummaries = useMemo(() => {
    if (!uploadProgresses) return [];
    return Object.entries(uploadProgresses).flatMap(([attachmentId, progress]) => {
      if (progress.phase !== 'hashing' && progress.phase !== 'uploading') return [];
      const attachment = composer.attachments.find((a) => a.id === attachmentId);
      return [{
        attachmentId,
        name: attachment?.name ?? attachmentId,
        percent: progress.percent,
      }];
    });
  }, [uploadProgresses, composer.attachments]);

  useEffect(() => {
    if (!shouldClearExecutionTarget(executionTargets, runtime.executionTargetId)) return;
    onExecutionTargetChange?.('');
  }, [runtime.executionTargetId, executionTargets, onExecutionTargetChange]);

  /* ═══════════════ @mention inline popover ═══════════════
     The textarea reports every text/cursor change to evaluateTrigger; an
     active '@' before the caret (preceded by whitespace, no whitespace in
     the query segment) opens the popover. The popover reuses the existing
     mentionableAgents data + planAddMentionAction so dispatchRole ('context'
     vs 'dispatch') semantics flow through unchanged. IME composition is
     guarded via compositionRef so '@' detection never fires mid-composition. */

  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [popoverCoords, setPopoverCoords] = useState<MentionPopoverCoords | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const compositionRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();

  /* ═══════════════ Draft persistence ═══════════════
     Save composer draft per conversationId via requestIdleCallback
     batching, load on mount, flush on hidden, clear on submit (empty
     state). #1822: the persisted payload now also carries uploaded
     attachment refs and the reply/quote context; in-flight attachments
     are additionally kept in a memory cache so a same-session
     conversation switch restores them fully.                    */

  const draftLoadedRef = useRef<string | null>(null);
  const pendingDraftRef = useRef<{
    conversationId: string;
    text: string;
    mentions: ComposerMention[];
    // #1822: full snapshot — in-memory only for File-bearing attachments.
    attachments: ComposerAttachment[];
    replyTo: ReplyToContext | null;
    quote: QuoteContext | null;
  } | null>(null);
  // #1822: same-session draft cache — keeps File objects alive across a
  // conversation switch (localStorage cannot). localStorage stays the
  // cross-reload fallback (text + mentions + ref'd attachments + reply/quote).
  const memoryDraftCacheRef = useRef<Map<string, {
    text: string;
    mentions: ComposerMention[];
    attachments: ComposerAttachment[];
    replyTo: ReplyToContext | null;
    quote: QuoteContext | null;
  }>>(new Map());
  const ricIdRef = useRef<number | null>(null);

  /** Flush any pending draft to localStorage immediately. */
  function flushDraft(): void {
    if (ricIdRef.current !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(ricIdRef.current);
      }
      ricIdRef.current = null;
    }
    const pending = pendingDraftRef.current;
    pendingDraftRef.current = null;
    if (!pending) return;
    saveDraft(pending.conversationId, serializeDraft(pending));
    memoryDraftCacheRef.current.set(pending.conversationId, {
      text: pending.text,
      mentions: pending.mentions,
      attachments: pending.attachments,
      replyTo: pending.replyTo,
      quote: pending.quote,
    });
  }

  // Load + Save draft in a single effect to avoid a race between the load
  // phase (reads draft, dispatches setText/addMention) and the save phase
  // (clears empty-state draft) in the same commit.
  useEffect(() => {
    const cid = composer.conversationId;
    if (!cid) return;

    // Conversation switch with a draft still pending its idle-callback flush:
    // persist it for the OLD conversation before touching the new one, so
    // switching never drops un-saved draft content.
    const pending = pendingDraftRef.current;
    if (pending && pending.conversationId !== cid) {
      flushDraft();
    }

    // ══ Load draft (first time per conversationId) ══
    if (draftLoadedRef.current !== cid) {
      draftLoadedRef.current = cid;
      // Only load when the composer is empty (fresh mount / conversation switch).
      if (
        composer.text === '' &&
        composer.mentions.length === 0 &&
        composer.attachments.length === 0 &&
        composer.replyTo === null &&
        composer.quote === null
      ) {
        // #1822: same-session cache first (keeps File attachments), then
        // localStorage (cross-reload). Mentions are validated against the
        // current roster so stale agent ids never become ghost chips.
        const rosterIds = new Set(runtime.mentionableAgents.map((m) => m.id));
        const memoryDraft = memoryDraftCacheRef.current.get(cid);
        const draft = memoryDraft ?? loadDraft(cid);
        if (draft) {
          const validMentions = draft.mentions.filter((m) => rosterIds.has(m.id));
          dispatchComposer({ type: 'setText', text: draft.text });
          for (const m of validMentions) {
            dispatchComposer({ type: 'addMention', mention: m });
          }
          if (memoryDraft) {
            for (const attachment of memoryDraft.attachments) {
              dispatchComposer({ type: 'addAttachment', attachment });
            }
          } else if (draft.attachments) {
            for (const attachment of draft.attachments) {
              // Restored from localStorage: only ref'd attachments survive
              // serialization, so rehydrate the chip with its ref (no File).
              // Conditional spread: `draft` is a union of the memory-cache
              // shape (ComposerAttachment[], optional ref) and the serialized
              // draft, so the element ref reads `AttachmentRef | undefined`;
              // writing the property only when present keeps the literal
              // valid under exactOptionalPropertyTypes (typescript 6).
              const restoredRef = attachment.attachmentRef;
              dispatchComposer({
                type: 'addAttachment',
                attachment: {
                  id: attachment.id,
                  name: attachment.name,
                  ...(attachment.size !== undefined ? { size: attachment.size } : {}),
                  ...(attachment.mime !== undefined ? { mime: attachment.mime } : {}),
                  ...(restoredRef ? { attachmentRef: restoredRef } : {}),
                  source: 'browser',
                },
              });
            }
          }
          if (draft.replyTo) {
            dispatchComposer({ type: 'setReplyTo', replyTo: draft.replyTo });
          }
          if (draft.quote) {
            dispatchComposer({ type: 'setQuote', quote: draft.quote });
          }
          return; // Don't save/clear this cycle — let the re-render handle it.
        }
      }
    }

    // ══ Save / clear draft ══
    if (
      composer.text === '' &&
      composer.mentions.length === 0 &&
      composer.attachments.length === 0 &&
      composer.replyTo === null &&
      composer.quote === null
    ) {
      // Flush any draft still pending for the PREVIOUS conversation first:
      // switching conversations within the idle-callback window used to drop
      // the old draft silently.
      flushDraft();
      // Empty state after user interaction or submit → clear draft.
      clearDraft(cid);
      memoryDraftCacheRef.current.delete(cid);
      if (ricIdRef.current !== null) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(ricIdRef.current);
        }
        ricIdRef.current = null;
      }
      pendingDraftRef.current = null;
      return;
    }
    // Non-empty state → schedule a batch save via requestIdleCallback.
    pendingDraftRef.current = {
      conversationId: cid,
      text: composer.text,
      mentions: composer.mentions,
      attachments: composer.attachments,
      replyTo: composer.replyTo,
      quote: composer.quote,
    };
    if (ricIdRef.current !== null) return; // already scheduled
    ricIdRef.current =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(flushDraft, { timeout: 500 })
        : window.setTimeout(flushDraft, 200);
  }, [composer.text, composer.mentions, composer.attachments, composer.replyTo, composer.quote,
    composer.conversationId, dispatchComposer, runtime.mentionableAgents]);

  // Force-flush pending draft when the page is hidden; flush on unmount.
  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.hidden) flushDraft();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushDraft();
    };
  }, []);

  /* ═══════════════ Auto-grow (#1822) ═══════════════
     The composer textarea is rows=1; grow it to fit the content up to
     the CSS max-height instead of scrolling forever at one line. */

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    if (textarea.scrollHeight > 0) {
      textarea.style.height = `${textarea.scrollHeight}px`;
    } else {
      textarea.style.height = '';
    }
  }, [composer.text]);

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
      isRunning: Boolean(isRunning),
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

  /* ═══════════════ onPaste / onDrop attachment ═══════════════
     Extract File objects from clipboard paste or file drag-and-drop, convert
     to ComposerAttachment (via browserFilesToComposerAttachments for content
     preview + hash), and dispatch into the composer store. Upload is deferred
     to ConversationHost on submit.  Orthogonal to @mention popover — no
     interaction with evaluateTrigger / compositionRef.
     Size gate: files over MAX_ATTACHMENT_BYTES are
     rejected up front with a toast instead of failing mid-upload.            */

  async function handleAttachFiles(files: File[]): Promise<void> {
    if (files.length === 0 || view.isSubmitting) return;
    const { accepted, rejected } = partitionAttachmentsBySize(files);
    const oversizeToast = buildAttachmentOversizeToast(rejected);
    if (oversizeToast) onToast?.(oversizeToast);
    if (accepted.length === 0) return;
    const attachments = await browserFilesToComposerAttachments(accepted);
    dispatchComposerAttachmentAdds(dispatchComposer, attachments);
  }

  function handleTextareaPaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void handleAttachFiles(files);
  }

  function handleFormDragEnter(event: React.DragEvent<HTMLFormElement>): void {
    if (event.dataTransfer.types?.includes('Files')) {
      event.preventDefault();
      setDragOver(true);
    }
  }

  function handleFormDragOver(event: React.DragEvent<HTMLFormElement>): void {
    if (event.dataTransfer.types?.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleFormDragLeave(event: React.DragEvent<HTMLFormElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOver(false);
    }
  }

  function handleFormDrop(event: React.DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void handleAttachFiles(files);
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
      browserFilesToAttachments: (files) => {
        const { accepted, rejected } = partitionAttachmentsBySize(files);
        const oversizeToast = buildAttachmentOversizeToast(rejected);
        if (oversizeToast) onToast?.(oversizeToast);
        return browserFilesToComposerAttachments(accepted);
      },
    });
    if (result.kind === 'noop') return;
    dispatchComposerAttachmentAdds(dispatchComposer, result.attachments);
    if (result.resetInput && fileInputRef.current) fileInputRef.current.value = '';
  }, [dispatchComposer, onPickLocalAttachments, onToast, runtime.hasNativePicker]);

  const openFilePicker = useCallback((): void => {
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
  }, [dispatchComposer, onPickLocalAttachments, runtime.hasNativePicker]);

  return (
    <form
      className={cn(styles.composer, 'bg-transparent')}
      data-composer-form=""
      onSubmit={onSubmit}
      onDragEnter={handleFormDragEnter}
      onDragOver={handleFormDragOver}
      onDragLeave={handleFormDragLeave}
      onDrop={handleFormDrop}
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2">
      <InputGroup
        className={cn(
          'relative flex-col items-stretch rounded-2xl border-line bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-20px_rgb(0_0_0/0.22)] transition-[border-color,box-shadow]',
          'has-[[data-slot=input-group-control]:focus-visible]:border-primary/35 has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-primary/10',
          dragOver && 'border-primary/60 ring-4 ring-primary/10',
        )}
      >
        {dragOver && (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 text-xs font-medium text-primary"
          >
            {t('composer.dropToAttach', { defaultValue: '松开鼠标以添加附件' })}
          </div>
        )}
        {(chromeModel.replyTo
          || chromeModel.quote
          || composer.editingMessageId
          || chromeModel.mentions
          || chromeModel.mainchain
          || chromeModel.attachment
          || (view.isSubmitting && inFlightUploadSummaries.length > 0)) && (
          <InputGroupAddon
            align="block-start"
            className="w-full cursor-default select-auto flex-col items-stretch gap-2 border-b border-line/60 px-3 pb-2.5 pt-2.5"
          >
            {chromeModel.replyTo && (
              <ComposerReplyBar
                isSubmitting={view.isSubmitting}
                onCancel={handleCancelReply}
                replyTo={chromeModel.replyTo}
              />
            )}
            {chromeModel.quote && (
              <ComposerQuoteBar
                isSubmitting={view.isSubmitting}
                onCancel={handleCancelQuote}
                quote={chromeModel.quote}
              />
            )}
            {composer.editingMessageId && (
              <ComposerEditBar
                isSubmitting={view.isSubmitting}
                onCancel={handleCancelEdit}
              />
            )}
            {chromeModel.mentions && (
              <ComposerMentionChips
                isSubmitting={view.isSubmitting}
                mentions={chromeModel.mentions}
                onRemove={handleRemoveMention}
              />
            )}
            {chromeModel.mainchain && (
              <ComposerMainchainStrip
                mainchainTask={chromeModel.mainchain.mainchainTask}
                selectedAgentLabel={chromeModel.mainchain.selectedAgentLabel}
                selectedTargetLabel={chromeModel.mainchain.selectedTargetLabel}
                targetSelected={chromeModel.mainchain.targetSelected}
              />
            )}
            {chromeModel.attachment && (
              <ComposerAttachmentBar
                attachments={chromeModel.attachment.attachments}
                isSubmitting={view.isSubmitting}
                onRemove={handleRemoveAttachment}
                uploadProgresses={chromeModel.attachment.uploadProgresses}
                {...(onRetryAttachmentUpload ? { onRetryUpload: onRetryAttachmentUpload } : {})}
              />
            )}
            {view.isSubmitting && inFlightUploadSummaries.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-4 text-muted-foreground"
                role="status"
              >
                {inFlightUploadSummaries.map((summary) => (
                  <span key={summary.attachmentId}>
                    {t('composer.uploadingAttachment', {
                      name: summary.name,
                      percent: String(summary.percent),
                      defaultValue: `上传中 ${summary.name} ${summary.percent}%`,
                    })}
                  </span>
                ))}
              </div>
            )}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          aria-label={t('aria.composerInput')}
          aria-expanded={popoverOpen}
          aria-controls={popoverOpen ? listboxId : undefined}
          aria-activedescendant={
            popoverOpen && mentionCandidates.length > 0
              ? `${listboxId}-opt-${clampedActiveIndex}`
              : undefined
          }
          data-composer-input
          className="max-h-44 min-h-[54px] resize-none rounded-none border-0 bg-transparent px-4 pt-3.5 pb-1.5 text-[0.9375rem] leading-6 text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
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
          onPaste={handleTextareaPaste}
          placeholder={isRunning ? t('composer.agentResponding', { target: targetLabel ?? 'AgentHub' }) : view.inputPlaceholder}
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
        <InputGroupAddon
          align="block-end"
          className="flex-wrap items-center gap-0.5 border-t border-line/70 px-2 py-1.5"
        >
          <ComposerAttachButton isSubmitting={view.isSubmitting} onClick={openFilePicker} />
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
          {chromeModel.agentOptions && (
            <ComposerAgentPicker
              availableMentionOptions={chromeModel.agentOptions}
              isSubmitting={view.isSubmitting}
              onSelect={selectMention}
            />
          )}
          {chromeModel.targetPicker && (
            <ComposerTargetPicker
              executionTargetId={chromeModel.targetPicker.executionTargetId}
              executionTargets={chromeModel.targetPicker.executionTargets}
              isSubmitting={view.isSubmitting}
              onChange={handleExecutionTargetChange}
            />
          )}
          <ComposerApprovalModePicker
            approvalMode={composer.approvalMode}
            isSubmitting={view.isSubmitting}
            onChange={(mode) => dispatchComposer({ type: 'setApprovalMode', approvalMode: mode })}
          />
          <div className="ml-auto flex items-center gap-2 pl-1">
            <kbd className="hidden rounded border border-line bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
              Enter
            </kbd>
            <ComposerSendButton
              hasMentions={view.hasMentions}
              isRunning={isRunning}
              onCancel={onCancel}
              submitDisabled={view.submitDisabled}
            />
          </div>
        </InputGroupAddon>
      </InputGroup>
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
      </div>
    </form>
  );
}
