import { createElement } from 'react';
import type { ComposerAction } from '@shared/composer';
import type { WorkbenchConversation } from '@shared/platform';
import type { ApprovalDecisionAction, TranscriptBlock } from '@shared/transcript';
import { AppError } from '@shared/errors';
import { resolveFailedToastKey } from '@shared/chatview/failedToastKey';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
import { ForwardConversationPicker } from './floating/ForwardConversationPicker';
import {
  blockTitle,
  buildPermissionApprovalDecision,
  buildQuoteComposerText,
  cardActionLabel,
  cardLinkForBlock,
  resolveBlockTitleById,
  resolveQuoteText,
  type TranscriptChromeTranslate,
} from './workbenchTranscriptChromeLabels';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeActionMappers — pure residual action / menu /
   side-effect slices from workbenchTranscriptChromeHelpers (#755).

   Context/multi/block action planners, menu and multi-select view models,
   and side-effect application. No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign optional fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * #1823: pending destructive multi-delete request. `blockIds` is the
 * selection snapshot captured when the confirm gate was raised — the
 * confirmed delete acts on this snapshot, never on the live selection
 * (which the user can still mutate while the dialog is open).
 */
export interface DeleteConfirmRequest {
  count: number;
  blockIds: string[];
}



export type TranscriptChromeSideEffect =
  | { type: 'copy'; text: string }
  | { type: 'softHide'; blockIds: string[] }
  | {
    type: 'composer';
    actions: ComposerAction[];
    focusComposer?: true;
  }
  | {
    type: 'regenerate';
    blockId: string;
    /**
     * #2274 B-1: the producing agent task id — the only identity
     * POST /web/agent-tasks/:id/regenerate accepts. Planned only when the
     * block actually carries it (hub-stamped `agent_task.task_id`).
     */
    taskId: string;
    /** Shown only after the regenerate request resolves successfully (#1821). */
    successMessage: string;
    /** Shown when the regenerate request rejects (#1821). */
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  }
  | {
    type: 'approval';
    decision: ApprovalDecisionAction;
    /** Shown only after the decision request resolves successfully (#1821). */
    successMessage: string;
    /** Shown when the decision request rejects (#1821). */
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  }
  | { type: 'pulse'; blockId: string }
  | { type: 'toast'; message: string }
  // #1823: multi-delete is destructive with no undo — the Delete hotkey and
  // the bar button both gate on an explicit confirm step before softHide.
  // blockIds is a snapshot cloned when the gate was requested: the user can
  // keep changing the live selection (e.g. Ctrl/⌘+A) while the confirm is
  // open, and the confirmed delete must remove exactly what the dialog
  // promised, not whatever is selected at confirm time.
  | { type: 'confirmDelete'; request: DeleteConfirmRequest }
  | { type: 'exitSelection' }
  // Hub REST message actions (#1383). Planned only when a session id is
  // available; applied via the optional `on*Message` effect handlers. The
  // success toast rides the resolved request — a rejected request shows the
  // failure message instead of a fake optimistic success (#1821).
  | {
    type: 'pin';
    messageId: string;
    sessionId: string;
    successMessage: string;
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  }
  | {
    type: 'unpin';
    messageId: string;
    sessionId: string;
    successMessage: string;
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  }
  | {
    type: 'forward';
    messageId: string;
    targetSessionIds: string[];
    successMessage: string;
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  }
  | { type: 'recall'; messageId: string; successMessage: string; failureMessage: string; failureFallbackKey?: string }
  | {
    type: 'react';
    messageId: string;
    sessionId: string;
    emoji: string;
    successMessage: string;
    failureMessage: string;
    /** #2072 P3: i18n key for errcode-based resolution at error time. */
    failureFallbackKey?: string;
  };

// #1384: the emoji picker submenu carries the chosen emoji on the menu
// action string (`react:<emoji>`); plain `react` keeps the default 👍.
// The menu channel only carries (action, blockId), so the emoji rides the
// string and is decoded here — no protocol / plumbing changes needed.
const REACT_EMOJI_ACTION_PREFIX = 'react:';

// #1385: the forward picker submenu rides the chosen target session ids on
// the menu action string (`forward:<encoded>`), same channel trick as the
// emoji picker — no protocol / plumbing changes. Ids are URI-encoded and
// comma-joined so any session id shape survives the round trip.
const FORWARD_TARGETS_ACTION_PREFIX = 'forward:';

function isReactEmojiAction(action: string): boolean {
  return action === 'react' || action.startsWith(REACT_EMOJI_ACTION_PREFIX);
}

function reactEmojiForAction(action: string): string {
  if (action.startsWith(REACT_EMOJI_ACTION_PREFIX)) {
    return action.slice(REACT_EMOJI_ACTION_PREFIX.length) || '👍';
  }
  return '👍';
}

/** Build the menu action string carrying the chosen forward targets. */
export function forwardActionForTargets(targetSessionIds: string[]): string {
  return `${FORWARD_TARGETS_ACTION_PREFIX}${targetSessionIds
    .map((id) => encodeURIComponent(id))
    .join(',')}`;
}

function isForwardTargetsAction(action: string): boolean {
  return action.startsWith(FORWARD_TARGETS_ACTION_PREFIX);
}

function forwardTargetsForAction(action: string): string[] {
  const raw = action.slice(FORWARD_TARGETS_ACTION_PREFIX.length);
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map((id) => decodeURIComponent(id));
}

export function planContextAction(options: {
  action: string;
  blockId: string;
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
  selectedText?: string | null;
  sessionId?: string | null;
}): TranscriptChromeSideEffect[] {
  const { action, blockId, transcript, t, selectedText, sessionId } = options;
  const title = resolveBlockTitleById(transcript, blockId, t);
  const block = transcript.find((item) => item.id === blockId);
  const effects: TranscriptChromeSideEffect[] = [];

  if (action === 'copy') {
    // Copy the full text of text blocks (not the 28-char truncated title);
    // non-text blocks keep the short blockTitle.
    const copyText = block?.kind === 'text' ? block.text : title;
    effects.push({ type: 'copy', text: copyText });
  }
  if (action === 'link') {
    // #1504: copy an in-app URL that opens on Web/Desktop (session hash
    // route, `#/session/<sessionId>?block=<blockId>`) instead of the dead
    // `agenthub://card/<blockId>` custom scheme; see cardLinkForBlock.
    effects.push({ type: 'copy', text: cardLinkForBlock(blockId, sessionId) });
  }
  if (action === 'delete') {
    effects.push({ type: 'softHide', blockIds: [blockId] });
  }
  if (action === 'reply' && block) {
    effects.push({
      type: 'composer',
      actions: [{
        type: 'setReplyTo',
        replyTo: {
          messageId: blockId,
          author: block.author.name,
          preview: title,
        },
      }],
      focusComposer: true,
    });
  }
  if (action === 'quote' && block && block.kind === 'text') {
    const quoteText = resolveQuoteText(block.text, selectedText);
    effects.push({
      type: 'composer',
      actions: [
        // #1821: insert the quote ahead of the existing draft instead of
        // replacing it (prependText, not setText).
        { type: 'prependText', text: buildQuoteComposerText(quoteText) },
        {
          type: 'setQuote',
          quote: {
            text: quoteText,
            author: block.author.name,
            messageId: block.id,
          },
        },
      ],
      focusComposer: true,
    });
  }
  // Edit an already-sent user message (#1462 CF16): backfill the composer with
  // the message text and mark it as editing so submit routes to `editMessage`
  // instead of sending a new message.
  if (action === 'edit' && block && block.kind === 'text' && block.author.role === 'human') {
    effects.push({
      type: 'composer',
      actions: [
        { type: 'setText', text: block.text },
        { type: 'setEditingMessage', messageId: block.id },
      ],
      focusComposer: true,
    });
  }
  if (action === 'regenerate' && block && block.kind === 'text' && block.author.role === 'agent') {
    // #2274 B-1: regenerate's identity is the producing TASK id; the endpoint
    // answers 404 to anything else (message id / client_msg id — the pre-fix
    // web behaviour). Without block.agentTaskId there is no server-truthful
    // identity to send, so plan nothing: a soft-hide + success toast here
    // would claim an effect that cannot run (#1818 / #2154 honesty rule).
    if (!block.agentTaskId) return effects;
    // #1821: the soft-hide + success toast only land after the regenerate
    // request resolves; on rejection the block stays visible and the failure
    // toast surfaces (no fake "regenerating" state).
    effects.push({
      type: 'regenerate',
      blockId,
      taskId: block.agentTaskId,
      successMessage: t('action.regenerating'),
      failureMessage: t('toast.regenerateFailed'),
      failureFallbackKey: 'toast.regenerateFailed',
    });
    return effects;
  }

  // Hub REST message actions (#1383) require a session id. Without one
  // (Desktop/demo shells) the menu no longer offers them, and any stray
  // direct call plans nothing — a fake success toast would claim an effect
  // that never runs (#1818).
  const reactAction = isReactEmojiAction(action);
  const hubMessageAction = action === 'pin' || action === 'unpin' || reactAction;
  if (hubMessageAction && !sessionId) {
    return [];
  }
  if ((action === 'pin' || action === 'unpin' || reactAction) && sessionId) {
    if (action === 'pin') {
      effects.push(
        {
          type: 'pin',
          messageId: blockId,
          sessionId,
          successMessage: t('toast.pinUpdated'),
          failureMessage: t('toast.pinFailed'),
          failureFallbackKey: 'toast.pinFailed',
        },
        { type: 'pulse', blockId },
      );
    }
    if (action === 'unpin') {
      effects.push(
        {
          type: 'unpin',
          messageId: blockId,
          sessionId,
          successMessage: t('toast.unpinned'),
          failureMessage: t('toast.unpinFailed'),
          failureFallbackKey: 'toast.unpinFailed',
        },
        { type: 'pulse', blockId },
      );
    }
    if (reactAction) {
      // #1384: the emoji comes from the picker submenu (`react:<emoji>`);
      // plain `react` keeps the fixed default 👍.
      effects.push(
        {
          type: 'react',
          messageId: blockId,
          sessionId,
          emoji: reactEmojiForAction(action),
          successMessage: t('toast.reactionAdded'),
          failureMessage: t('toast.reactionFailed'),
          failureFallbackKey: 'toast.reactionFailed',
        },
        { type: 'pulse', blockId },
      );
    }
    return effects;
  }
  if (action === 'recall') {
    // Recall is a Hub REST action; without a session id there is nothing to
    // run, so plan nothing instead of a fake "recalled" toast (#1818).
    if (!sessionId) {
      return [];
    }
    effects.push(
      {
        type: 'recall',
        messageId: blockId,
        successMessage: t('toast.recalled'),
        failureMessage: t('toast.recallFailed'),
        failureFallbackKey: 'toast.recallFailed',
      },
      { type: 'pulse', blockId },
    );
    return effects;
  }
  if (action === 'forward' || isForwardTargetsAction(action)) {
    if (isForwardTargetsAction(action)) {
      // #1385: targets chosen in the picker submenu ride the action string
      // (`forward:<encoded>`); plan the real forward effect so the REST
      // port runs onForwardMessage(messageId, targetSessionIds).
      effects.push(
        {
          type: 'forward',
          messageId: blockId,
          targetSessionIds: forwardTargetsForAction(action),
          successMessage: t('toast.forwardQueued'),
          failureMessage: t('toast.forwardFailed'),
          failureFallbackKey: 'toast.forwardFailed',
        },
        { type: 'pulse', blockId },
      );
      return effects;
    }
    // Plain forward (no picker wired, e.g. direct callers): keep the
    // placeholder toast until a target is chosen.
    effects.push(
      { type: 'pulse', blockId },
      { type: 'toast', message: t('toast.forwardSelectTarget') },
    );
    return effects;
  }

  // Known actions with real effects get a confirmation toast; unknown or
  // unwired actions plan nothing — a generic "已记录" toast would claim an
  // effect that never runs (#1818, #1821).
  if (action === 'copy' || action === 'link' || action === 'delete') {
    effects.push(
      { type: 'pulse', blockId },
      { type: 'toast', message: cardActionLabel(action, title, t) },
    );
  }
  return effects;
}

export function planTranscriptBlockAction(options: {
  action: string;
  blockId: string;
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
  metadata?: Record<string, unknown>;
}): TranscriptChromeSideEffect[] {
  const { action, blockId, transcript, t, metadata } = options;
  const block = transcript.find((item) => item.id === blockId);
  if (!block) return [];

  const effects: TranscriptChromeSideEffect[] = [];

  if (action === 'approve' || action === 'deny') {
    if (block.kind === 'permission_request') {
      // #1821: the success toast must not fire before the request resolves —
      // the decision is awaited in applyTranscriptChromeSideEffects and only
      // then reports success (or the failure message on rejection).
      effects.push(
        {
          type: 'approval',
          decision: buildPermissionApprovalDecision(block, action),
          successMessage: action === 'approve' ? t('action.approved') : t('action.denied'),
          failureMessage: t('toast.approvalFailed', { defaultValue: '审批失败，请重试' }),
        },
        { type: 'pulse', blockId },
      );
    }
  }

  if (action === 'retry' || action === 'regenerate') {
    // #2274 B-1: same identity gate as the context-menu path — no stamped
    // task id means no honest regenerate to plan.
    if (block.kind === 'text' && block.author.role === 'agent' && block.agentTaskId) {
      // #1821: same honest contract as the context-menu regenerate path — the
      // soft-hide + success toast ride the resolved request.
      effects.push({
        type: 'regenerate',
        blockId,
        taskId: block.agentTaskId,
        successMessage: t('action.regenerating'),
        failureMessage: t('toast.regenerateFailed'),
        failureFallbackKey: 'toast.regenerateFailed',
      });
    }
  }

  if (action === 'copy') {
    const title = (metadata?.text as string) || blockTitle(block, t);
    effects.push(
      { type: 'copy', text: title },
      { type: 'pulse', blockId },
      { type: 'toast', message: cardActionLabel('copy', title, t) },
    );
  }

  return effects;
}

export function planMultiAction(options: {
  action: string;
  selectedBlockIds: string[];
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
}): TranscriptChromeSideEffect[] {
  const { action, selectedBlockIds, transcript, t } = options;
  const count = selectedBlockIds.length;
  if (!count) {
    return [{ type: 'toast', message: t('toast.noCardSelected') }];
  }

  const effects: TranscriptChromeSideEffect[] = [];
  if (action === 'copy') {
    effects.push({
      type: 'copy',
      text: selectedBlockIds
        .map((blockId) => resolveBlockTitleById(transcript, blockId, t))
        .join('\n'),
    });
    // Success toast only rides real effects; unknown multi-actions plan
    // nothing instead of a fake "已处理 N 项" success (#1818, #1821).
    effects.push({ type: 'toast', message: t('toast.multiCopy', { count }) });
  }
  if (action === 'delete') {
    // #1823: destructive multi-delete is gated on an explicit confirm step.
    // The actual softHide/exit/toast effects run only after the user
    // confirms (planConfirmMultiDelete). The selection is cloned into the
    // request so later selection changes cannot alter what gets deleted.
    effects.push({
      type: 'confirmDelete',
      request: { count, blockIds: [...selectedBlockIds] },
    });
  }
  return effects;
}

/**
 * Delete plan applied after the user confirms the destructive multi-delete
 * (#1823): soft-hide the selected blocks, leave selection, toast the count.
 */
export function planConfirmMultiDelete(options: {
  selectedBlockIds: string[];
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
}): TranscriptChromeSideEffect[] {
  const { selectedBlockIds, t } = options;
  const count = selectedBlockIds.length;
  if (!count) return [];
  return [
    { type: 'softHide', blockIds: selectedBlockIds },
    { type: 'exitSelection' },
    { type: 'toast', message: t('toast.multiDelete', { count }) },
  ];
}

export interface TranscriptChromeEffectHandlers {
  copyText: (text: string) => void;
  softHideBlocks: (blockIds: string[]) => void;
  dispatchComposer: (action: ComposerAction) => void;
  focusComposer: () => void;
  /**
   * Regenerate port (#1821). May return a Promise: when it does, the
   * soft-hide + success toast wait for resolution and a rejection surfaces
   * the failure toast instead (the block stays visible).
   */
  onRegenerate?: ((blockId: string, taskId: string) => Promise<void> | void) | undefined;
  onApprovalDecision?: ((decision: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  pulseBlock: (blockId: string) => void;
  showWorkbenchToast: (message: string) => void;
  /** #1823: destructive multi-delete gate. Received before softHide runs. */
  onRequestDeleteConfirm?: ((request: DeleteConfirmRequest) => void) | undefined;
  exitSelection: () => void;
  // Hub REST message actions (#1383) — optional; without them the side
  // effects are no-ops and no success toast is shown (#1821).
  onPinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onUnpinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined;
  onRecallMessage?: ((messageId: string) => Promise<void> | void) | undefined;
  onAddMessageReaction?: ((messageId: string, sessionId: string, emoji: string) => Promise<void> | void) | undefined;
}

/** True when the value is a thenable (awaitable handler result, #1821). */
function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof (value as Promise<unknown>).then === 'function';
}

/**
 * Await a handler result when it is a Promise (#1821): the success toast
 * fires only after resolution, and a rejection shows the failure message
 * (or the error's own message when present). Synchronous handlers keep the
 * immediate success toast.
 */
function announceSettledAction(
  outcome: Promise<void> | void,
  successMessage: string,
  failureMessage: string,
  showWorkbenchToast: (message: string) => void,
  t?: TranscriptChromeTranslate,
  failureFallbackKey?: string,
): void {
  if (!isThenable(outcome)) {
    showWorkbenchToast(successMessage);
    return;
  }
  void Promise.resolve(outcome).then(
    () => showWorkbenchToast(successMessage),
    (err: unknown) => {
      // #2072 P3: prefer errcode-based i18n resolution when available;
      // fall back to raw err.message or the pre-translated failureMessage.
      if (t && failureFallbackKey) {
        showWorkbenchToast(t(resolveFailedToastKey(err, failureFallbackKey)));
      } else {
        showWorkbenchToast(err instanceof Error && err.message ? err.message : failureMessage);
      }
    },
  );
}

/**
 * #2154: i18n key for the "this shell never wired that action" announcement.
 * The key is not in the locale bundle yet (i18n resources are owned outside
 * this change and the missing key is only registered in the PR) —
 * `announceUnavailableAction` falls back to the effect's own failure copy
 * until it lands, so the feedback is never a raw key and never silence.
 */
export const UNAVAILABLE_ACTION_TOAST_KEY = 'toast.actionUnavailable';

/**
 * Announce a planned action whose port handler is not wired (#2154).
 *
 * Every handler gate in the dispatcher below used to `break` silently: the
 * menu entry was visible (it gated on the session id, not on the handler) and
 * the click evaporated. The menu is fail-closed now, so this is a defensive
 * path — but it stays loud by contract: exactly one toast, never the success
 * copy, and no fake side effect.
 */
function announceUnavailableAction(
  effect: { failureMessage: string },
  handlers: Pick<TranscriptChromeEffectHandlers, 'showWorkbenchToast'>,
  t?: TranscriptChromeTranslate,
): void {
  const resolved = t ? t(UNAVAILABLE_ACTION_TOAST_KEY) : '';
  // A translate function that cannot resolve the key echoes it back (i18next
  // returns the key itself for a missing entry) — prefer the effect's own
  // localized failure copy over surfacing a raw key.
  handlers.showWorkbenchToast(
    resolved && resolved !== UNAVAILABLE_ACTION_TOAST_KEY ? resolved : effect.failureMessage,
  );
}

export function createTranscriptChromeEffectHandlers(
  handlers: TranscriptChromeEffectHandlers,
): TranscriptChromeEffectHandlers {
  // Identity factory keeps hook wiring declarative and exactOptional-safe.
  const next: TranscriptChromeEffectHandlers = {
    copyText: handlers.copyText,
    softHideBlocks: handlers.softHideBlocks,
    dispatchComposer: handlers.dispatchComposer,
    focusComposer: handlers.focusComposer,
    pulseBlock: handlers.pulseBlock,
    showWorkbenchToast: handlers.showWorkbenchToast,
    exitSelection: handlers.exitSelection,
  };
  if (handlers.onRegenerate !== undefined) next.onRegenerate = handlers.onRegenerate;
  if (handlers.onApprovalDecision !== undefined) {
    next.onApprovalDecision = handlers.onApprovalDecision;
  }
  if (handlers.onRequestDeleteConfirm !== undefined) {
    next.onRequestDeleteConfirm = handlers.onRequestDeleteConfirm;
  }
  if (handlers.onPinMessage !== undefined) next.onPinMessage = handlers.onPinMessage;
  if (handlers.onUnpinMessage !== undefined) next.onUnpinMessage = handlers.onUnpinMessage;
  if (handlers.onForwardMessage !== undefined) next.onForwardMessage = handlers.onForwardMessage;
  if (handlers.onRecallMessage !== undefined) next.onRecallMessage = handlers.onRecallMessage;
  if (handlers.onAddMessageReaction !== undefined) {
    next.onAddMessageReaction = handlers.onAddMessageReaction;
  }
  return next;
}

export function applyTranscriptChromeSideEffects(
  effects: TranscriptChromeSideEffect[],
  handlers: TranscriptChromeEffectHandlers,
  t?: TranscriptChromeTranslate,
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'copy':
        handlers.copyText(effect.text);
        break;
      case 'softHide':
        handlers.softHideBlocks(effect.blockIds);
        break;
      case 'composer':
        effect.actions.forEach((action) => handlers.dispatchComposer(action));
        if (effect.focusComposer) {
          handlers.focusComposer();
        }
        break;
      case 'regenerate': {
        // #1821: when the port returns a Promise, the soft-hide + success
        // toast wait for resolution and a rejection keeps the block visible
        // with the failure toast (no fake "regenerating" empty state).
        const regenerateHandler = handlers.onRegenerate;
        if (!regenerateHandler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        const outcome = regenerateHandler(effect.blockId, effect.taskId);
        if (isThenable(outcome)) {
          void Promise.resolve(outcome).then(
            () => {
              handlers.softHideBlocks([effect.blockId]);
              handlers.pulseBlock(effect.blockId);
              handlers.showWorkbenchToast(effect.successMessage);
            },
            (err: unknown) => {
              // #2072 P3: prefer errcode-based i18n resolution when available.
              if (t && effect.failureFallbackKey) {
                handlers.showWorkbenchToast(t(resolveFailedToastKey(err, effect.failureFallbackKey)));
              } else {
                handlers.showWorkbenchToast(
                  err instanceof Error && err.message ? err.message : effect.failureMessage,
                );
              }
            },
          );
        } else {
          handlers.softHideBlocks([effect.blockId]);
          handlers.pulseBlock(effect.blockId);
          handlers.showWorkbenchToast(effect.successMessage);
        }
        break;
      }
      case 'approval': {
        // #1821: wait for the decision request instead of fire-and-forget —
        // the success toast only fires after it resolves; a rejection shows
        // the failure message so a failed approval is never silent.
        const handler = handlers.onApprovalDecision;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        void Promise.resolve(handler(effect.decision)).then(
          () => handlers.showWorkbenchToast(effect.successMessage),
          (err: unknown) => {
            // #2072 P3: prefer errcode-based i18n resolution when available.
            if (t && effect.failureFallbackKey) {
              handlers.showWorkbenchToast(t(resolveFailedToastKey(err, effect.failureFallbackKey)));
            } else {
              handlers.showWorkbenchToast(
                err instanceof Error ? err.message : effect.failureMessage,
              );
            }
          },
        );
        break;
      }
      case 'pulse':
        handlers.pulseBlock(effect.blockId);
        break;
      case 'toast':
        handlers.showWorkbenchToast(effect.message);
        break;
      case 'confirmDelete':
        handlers.onRequestDeleteConfirm?.({ count: effect.request.count, blockIds: [...effect.request.blockIds] });
        break;
      case 'exitSelection':
        handlers.exitSelection();
        break;
      case 'pin': {
        const handler = handlers.onPinMessage;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        announceSettledAction(
          handler(effect.messageId, effect.sessionId),
          effect.successMessage,
          effect.failureMessage,
          handlers.showWorkbenchToast,
          t,
          effect.failureFallbackKey,
        );
        break;
      }
      case 'unpin': {
        const handler = handlers.onUnpinMessage;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        announceSettledAction(
          handler(effect.messageId, effect.sessionId),
          effect.successMessage,
          effect.failureMessage,
          handlers.showWorkbenchToast,
          t,
          effect.failureFallbackKey,
        );
        break;
      }
      case 'forward': {
        const handler = handlers.onForwardMessage;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        announceSettledAction(
          handler(effect.messageId, effect.targetSessionIds),
          effect.successMessage,
          effect.failureMessage,
          handlers.showWorkbenchToast,
          t,
          effect.failureFallbackKey,
        );
        break;
      }
      case 'recall': {
        const handler = handlers.onRecallMessage;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        announceSettledAction(
          handler(effect.messageId),
          effect.successMessage,
          effect.failureMessage,
          handlers.showWorkbenchToast,
          t,
          effect.failureFallbackKey,
        );
        break;
      }
      case 'react': {
        const handler = handlers.onAddMessageReaction;
        if (!handler) {
          announceUnavailableAction(effect, handlers, t);
          break;
        }
        announceSettledAction(
          handler(effect.messageId, effect.sessionId, effect.emoji),
          effect.successMessage,
          effect.failureMessage,
          handlers.showWorkbenchToast,
          t,
          effect.failureFallbackKey,
        );
        break;
      }
      default:
        break;
    }
  }
}

export interface BuildTranscriptContextMenuGroupsOptions {
  blockId: string;
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
  onAction: (action: string, blockId: string) => void;
  onEnterSelection: (blockId: string) => void;
  /**
   * Forward target candidates (#1385). The forward menu item only renders
   * when a conversation list is available — the picker submenu is the only
   * real forward path, so shells without candidates get no forward entry
   * instead of a fake success toast (#1818).
   */
  conversations?: WorkbenchConversation[] | undefined;
  /**
   * Handler-backed entries this shell can actually run (#2154). Every field
   * defaults to `false`, so an entry renders only when the port behind it is
   * wired — the previous session-id-only gate rendered pin/unpin/recall on
   * Desktop (session id present, no Hub message ports) and the dispatcher then
   * dropped each click without a word.
   */
  capabilities?: TranscriptMenuActionCapabilities | undefined;
}

/**
 * Per-action render gates for the transcript context menu (#2154).
 *
 * Fail-closed by construction: an unset field means "do not render". Pin and
 * unpin are separate capabilities because the entry toggles off `block.pinned`
 * — a shell that wired only one direction must not render the dead half.
 */
export interface TranscriptMenuActionCapabilities {
  /** Pin entry on an unpinned block — requires `onPinMessage`. */
  pin?: boolean | undefined;
  /** Unpin entry on a pinned block — requires `onUnpinMessage`. */
  unpin?: boolean | undefined;
  /** Recall entry on the user's own message — requires `onRecallMessage`. */
  recall?: boolean | undefined;
  /** Forward entry — requires `onForwardMessage` *and* `conversations`. */
  forward?: boolean | undefined;
  /** Regenerate entry on an agent text block — requires `onRegenerate`. */
  regenerate?: boolean | undefined;
}

export function buildTranscriptContextMenuGroups({
  blockId,
  transcript,
  t,
  onAction,
  onEnterSelection,
  conversations,
  capabilities,
}: BuildTranscriptContextMenuGroupsOptions): Array<Array<ContextMenuItem>> {
  const caps = capabilities ?? {};
  const block = transcript.find((item) => item.id === blockId);
  const isAgentText = block?.kind === 'text' && block.author.role === 'agent';
  const isUserText = block?.kind === 'text' && block.author.role === 'human';
  const isTextBlock = block?.kind === 'text';
  // Recall (撤回) is a message-level Hub REST action (#1383): only the user's
  // own messages can be recalled (author.role === 'human'). Unlike edit
  // (composer backfill) recall is not text-kind specific — any user-authored
  // block id round-trips through the recall effect.
  const isUserMessage = block?.author.role === 'human';
  return [
    [
      { label: t('context.copy'), icon: 'fileText', shortcut: 'Ctrl C', onClick: () => onAction('copy', blockId) },
      // #1822: the react submenu was write-only (POST fires but nothing in
      // the transcript ever renders or cancels a reaction) — entry removed
      // until a real reaction display exists.
      { label: t('context.reply'), icon: 'notes', onClick: () => onAction('reply', blockId) },
      ...(isTextBlock ? [{ label: t('context.quote'), icon: 'copy' as const, onClick: () => onAction('quote', blockId) }] : []),
      ...(isUserText ? [{ label: t('context.edit'), icon: 'edit' as const, onClick: () => onAction('edit', blockId) }] : []),
      // Forward only renders with the target picker submenu (#1385) *and* a
      // wired forward port (#2154); without either there is no real forward
      // path, so no entry (#1818).
      ...(conversations !== undefined && caps.forward === true
        ? [{
            label: t('context.forward'),
            icon: 'external' as const,
            chevron: true,
            onClick: () => onAction('forward', blockId),
            submenu: (close: () => void) => createElement(ForwardConversationPicker, {
              conversations,
              ariaLabel: t('aria.forwardPicker'),
              confirmLabel: t('forward.confirm'),
              cancelLabel: t('forward.cancel'),
              emptyLabel: t('forward.empty'),
              onConfirm: (targetSessionIds: string[]) => {
                // The chosen targets ride the action string (`forward:<ids>`);
                // planContextAction decodes them into the forward effect.
                onAction(forwardActionForTargets(targetSessionIds), blockId);
                close();
              },
              onCancel: close,
            }),
          }]
        : []),
    ],
    [
      { label: t('context.multiSelect'), icon: 'grid', shortcut: 'Shift', onClick: () => onEnterSelection(blockId) },
      // #1449: the pin entry toggles — pinned blocks show the unpin action
      // (`context.unpin` i18n + effect + toast + pulse). `block.pinned` is
      // written by the adapter from message-level pin state, which the
      // pinMap store provides (getPinMapStore → withPinnedState merged in
      // web/desktop workbench model, see pinMap.ts).
      // #2154: gated per half of the toggle — only the direction whose port is
      // actually wired renders, so no shell offers a click it cannot run.
      ...((block?.pinned ? caps.unpin : caps.pin) === true
        ? [{
            label: block?.pinned ? t('context.unpin') : t('context.pinMessage'),
            icon: 'bell' as const,
            onClick: () => onAction(block?.pinned ? 'unpin' : 'pin', blockId),
          }]
        : []),
      { label: t('context.copyLink'), icon: 'external', onClick: () => onAction('link', blockId) },
    ],
    [
      // #2154: regenerate needs the shell's regenerate port — Desktop has
      // none, so the entry stays hidden instead of doing nothing on click.
      // #2274 B-1: the entry also needs the block's stamped task id — the
      // shell's port is necessary but not sufficient: without a task id the
      // click can only fail (pre-fix web sent a message id and got 404).
      ...(isAgentText && caps.regenerate === true && Boolean(block?.agentTaskId)
        ? [{ label: t('context.regenerate'), icon: 'refresh' as const, onClick: () => onAction('regenerate', blockId) }]
        : []),
      // Recall (#1383) only makes sense for the user's own messages — the
      // Hub REST planner already supports it; the menu entry was missing.
      // Danger-styled like delete. Renders only with a wired recall port
      // (#2154; was Hub-only #1818).
      ...(isUserMessage && caps.recall === true
        ? [{ label: t('context.recall'), icon: 'back' as const, danger: true, onClick: () => onAction('recall', blockId) }]
        : []),
      { label: t('context.delete'), icon: 'archive', danger: true, onClick: () => onAction('delete', blockId) },
    ],
  ];
}

export interface BuildTranscriptMultiSelectActionsOptions {
  t: TranscriptChromeTranslate;
  onSelectAll: () => void;
  onClear: () => void;
  onMultiAction: (action: string) => void;
  onExit: () => void;
}

export function buildTranscriptMultiSelectActions({
  t,
  onSelectAll,
  onClear,
  onMultiAction,
  onExit,
}: BuildTranscriptMultiSelectActionsOptions): Array<MultiSelectBarAction> {
  // Only actions with real effects stay: copy (clipboard) and delete
  // (soft-hide). Forward/task/export multi-actions had no backing effects —
  // they only toasted — and were removed (#1818).
  return [
    {
      label: t('bar.selectAll'),
      icon: 'done',
      onClick: onSelectAll,
    },
    {
      label: t('bar.clear'),
      icon: 'filter',
      onClick: onClear,
    },
    { label: t('context.copy'), icon: 'fileText', onClick: () => onMultiAction('copy') },
    { label: t('context.delete'), icon: 'archive', danger: true, onClick: () => onMultiAction('delete') },
    {
      label: t('bar.exit'),
      icon: 'close',
      ghost: true,
      onClick: onExit,
    },
  ];
}
