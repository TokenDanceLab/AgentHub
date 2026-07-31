import { createElement } from 'react';
import type { ComposerAction } from '../composer';
import type { WorkbenchConversation } from '../platform';
import type { ApprovalDecisionAction, TranscriptBlock } from '../transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
import { EmojiPicker } from './floating/EmojiPicker';
import { ForwardConversationPicker } from './floating/ForwardConversationPicker';
import {
  blockTitle,
  buildPermissionApprovalDecision,
  buildQuoteComposerText,
  cardActionLabel,
  cardLinkForBlock,
  multiActionLabel,
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

export type TranscriptChromeSideEffect =
  | { type: 'copy'; text: string }
  | { type: 'softHide'; blockIds: string[] }
  | {
    type: 'composer';
    actions: ComposerAction[];
    focusComposer?: true;
  }
  | { type: 'regenerate'; blockId: string }
  | { type: 'approval'; decision: ApprovalDecisionAction }
  | { type: 'pulse'; blockId: string }
  | { type: 'toast'; message: string }
  | { type: 'exitSelection' }
  // Hub REST message actions (#1383). Planned only when a session id is
  // available; applied via the optional `on*Message` effect handlers.
  | { type: 'pin'; messageId: string; sessionId: string }
  | { type: 'unpin'; messageId: string; sessionId: string }
  | { type: 'forward'; messageId: string; targetSessionIds: string[] }
  | { type: 'recall'; messageId: string }
  | { type: 'react'; messageId: string; sessionId: string; emoji: string };

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
    // TODO(copyLink): `agenthub://card/<blockId>` is a custom scheme with no
    // registered handler — copying it yields a dead link. Needs a product
    // decision (scheme handler registration or a real shareable URL) before
    // this copy can be useful; see cardLinkForBlock in
    // workbenchTranscriptChromeLabels.ts.
    effects.push({ type: 'copy', text: cardLinkForBlock(blockId) });
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
        { type: 'setText', text: buildQuoteComposerText(quoteText) },
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
    effects.push(
      { type: 'softHide', blockIds: [block.id] },
      { type: 'regenerate', blockId },
      { type: 'pulse', blockId },
      { type: 'toast', message: cardActionLabel(action, title, t) },
    );
    return effects;
  }

  // Hub REST message actions (#1383). With a session id these replace the
  // placeholder toast; without one (Desktop/demo) the old toast stays.
  const reactAction = isReactEmojiAction(action);
  if ((action === 'pin' || action === 'unpin' || reactAction) && sessionId) {
    if (action === 'pin') {
      effects.push(
        { type: 'pin', messageId: blockId, sessionId },
        { type: 'pulse', blockId },
        { type: 'toast', message: t('toast.pinUpdated') },
      );
    }
    if (action === 'unpin') {
      effects.push(
        { type: 'unpin', messageId: blockId, sessionId },
        { type: 'pulse', blockId },
        { type: 'toast', message: t('toast.unpinned') },
      );
    }
    if (reactAction) {
      // #1384: the emoji comes from the picker submenu (`react:<emoji>`);
      // plain `react` keeps the fixed default 👍.
      effects.push(
        { type: 'react', messageId: blockId, sessionId, emoji: reactEmojiForAction(action) },
        { type: 'pulse', blockId },
        { type: 'toast', message: t('toast.reactionAdded') },
      );
    }
    return effects;
  }
  if (action === 'recall') {
    effects.push(
      { type: 'recall', messageId: blockId },
      { type: 'pulse', blockId },
      { type: 'toast', message: t('toast.recalled') },
    );
    return effects;
  }
  if (action === 'forward' || isForwardTargetsAction(action)) {
    if (isForwardTargetsAction(action)) {
      // #1385: targets chosen in the picker submenu ride the action string
      // (`forward:<encoded>`); plan the real forward effect so the REST
      // port runs onForwardMessage(messageId, targetSessionIds).
      effects.push(
        { type: 'forward', messageId: blockId, targetSessionIds: forwardTargetsForAction(action) },
        { type: 'pulse', blockId },
        { type: 'toast', message: t('toast.forwardQueued') },
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

  effects.push(
    { type: 'pulse', blockId },
    { type: 'toast', message: cardActionLabel(reactAction ? 'react' : action, title, t) },
  );
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
      effects.push(
        { type: 'approval', decision: buildPermissionApprovalDecision(block, action) },
        { type: 'pulse', blockId },
        {
          type: 'toast',
          message: action === 'approve' ? t('action.approved') : t('action.denied'),
        },
      );
    }
  }

  if (action === 'retry' || action === 'regenerate') {
    if (block.kind === 'text' && block.author.role === 'agent') {
      effects.push(
        { type: 'softHide', blockIds: [block.id] },
        { type: 'regenerate', blockId },
        { type: 'pulse', blockId },
        { type: 'toast', message: t('action.regenerating') },
      );
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
  }
  if (action === 'delete') {
    effects.push(
      { type: 'softHide', blockIds: selectedBlockIds },
      { type: 'exitSelection' },
    );
  }
  effects.push({ type: 'toast', message: multiActionLabel(action, count, t) });
  return effects;
}

export interface TranscriptChromeEffectHandlers {
  copyText: (text: string) => void;
  softHideBlocks: (blockIds: string[]) => void;
  dispatchComposer: (action: ComposerAction) => void;
  focusComposer: () => void;
  onRegenerate?: ((blockId: string) => void) | undefined;
  onApprovalDecision?: ((decision: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  pulseBlock: (blockId: string) => void;
  showWorkbenchToast: (message: string) => void;
  exitSelection: () => void;
  // Hub REST message actions (#1383) — optional; without them the side
  // effects are no-ops and the planner keeps the placeholder toast.
  onPinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onUnpinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined;
  onRecallMessage?: ((messageId: string) => Promise<void> | void) | undefined;
  onAddMessageReaction?: ((messageId: string, sessionId: string, emoji: string) => Promise<void> | void) | undefined;
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
      case 'regenerate':
        handlers.onRegenerate?.(effect.blockId);
        break;
      case 'approval':
        handlers.onApprovalDecision?.(effect.decision);
        break;
      case 'pulse':
        handlers.pulseBlock(effect.blockId);
        break;
      case 'toast':
        handlers.showWorkbenchToast(effect.message);
        break;
      case 'exitSelection':
        handlers.exitSelection();
        break;
      case 'pin':
        handlers.onPinMessage?.(effect.messageId, effect.sessionId);
        break;
      case 'unpin':
        handlers.onUnpinMessage?.(effect.messageId, effect.sessionId);
        break;
      case 'forward':
        handlers.onForwardMessage?.(effect.messageId, effect.targetSessionIds);
        break;
      case 'recall':
        handlers.onRecallMessage?.(effect.messageId);
        break;
      case 'react':
        handlers.onAddMessageReaction?.(effect.messageId, effect.sessionId, effect.emoji);
        break;
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
   * Forward target candidates (#1385). When provided, the forward menu item
   * gets a target-conversation picker submenu; absent (Desktop/demo shells)
   * keeps the old plain-forward placeholder toast.
   */
  conversations?: WorkbenchConversation[] | undefined;
}

export function buildTranscriptContextMenuGroups({
  blockId,
  transcript,
  t,
  onAction,
  onEnterSelection,
  conversations,
}: BuildTranscriptContextMenuGroupsOptions): Array<Array<ContextMenuItem>> {
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
      {
        label: t('context.react'),
        icon: 'star',
        chevron: true,
        // Plain click path (default 👍) is kept for direct callers; the menu
        // click/Enter opens the picker submenu instead (#1384).
        onClick: () => onAction('react', blockId),
        submenu: (close) => createElement(EmojiPicker, {
          ariaLabel: t('aria.emojiPicker'),
          autoFocus: true,
          onSelect: (emoji: string) => {
            // The chosen emoji rides the action string (`react:<emoji>`);
            // planContextAction decodes it back into the react effect.
            onAction(`react:${emoji}`, blockId);
            close();
          },
        }),
      },
      { label: t('context.reply'), icon: 'notes', onClick: () => onAction('reply', blockId) },
      ...(isTextBlock ? [{ label: t('context.quote'), icon: 'copy' as const, onClick: () => onAction('quote', blockId) }] : []),
      ...(isUserText ? [{ label: t('context.edit'), icon: 'edit' as const, onClick: () => onAction('edit', blockId) }] : []),
      {
        label: t('context.forward'),
        icon: 'external',
        // #1385: with a conversation list the item opens the target picker
        // submenu (chevron); without one it stays a plain action that keeps
        // the placeholder toast.
        chevron: conversations !== undefined,
        onClick: () => onAction('forward', blockId),
        ...(conversations !== undefined
          ? {
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
            })
          }
          : {}),
      },
    ],
    [
      { label: t('context.createTopic'), icon: 'groups', onClick: () => onAction('topic', blockId) },
      { label: t('context.multiSelect'), icon: 'grid', shortcut: 'Shift', onClick: () => onEnterSelection(blockId) },
      // #1449: the pin entry toggles — pinned blocks show the unpin action
      // (`context.unpin` i18n pre-seeded with the J-planner unpin branch:
      // effect + toast + pulse). `block.pinned` is written by the adapter
      // from message-level pin state; until the pinMap store lands (see
      // TODO(pinMap) in normalizeHubMessages.ts) it stays false and the
      // item pins as before.
      {
        label: block?.pinned ? t('context.unpin') : t('context.pinMessage'),
        icon: 'bell',
        onClick: () => onAction(block?.pinned ? 'unpin' : 'pin', blockId),
      },
      { label: t('context.copyLink'), icon: 'external', onClick: () => onAction('link', blockId) },
      { label: t('context.translate'), icon: 'library', onClick: () => onAction('translate', blockId) },
    ],
    [
      ...(isAgentText ? [{ label: t('context.regenerate'), icon: 'refresh' as const, onClick: () => onAction('regenerate', blockId) }] : []),
      { label: t('context.addTask'), icon: 'running', onClick: () => onAction('task', blockId) },
      { label: t('context.exportDoc'), icon: 'download', onClick: () => onAction('export', blockId) },
      { label: t('context.apps'), icon: 'tools', chevron: true, onClick: () => onAction('apps', blockId) },
      // Recall (#1383) only makes sense for the user's own messages — the
      // Hub REST planner already supports it; the menu entry was missing.
      // Danger-styled like delete.
      ...(isUserMessage
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
    { label: t('context.forward'), icon: 'external', onClick: () => onMultiAction('forward') },
    { label: t('context.addTask'), icon: 'running', onClick: () => onMultiAction('task') },
    { label: t('context.exportDoc'), icon: 'download', onClick: () => onMultiAction('export') },
    { label: t('context.delete'), icon: 'archive', danger: true, onClick: () => onMultiAction('delete') },
    {
      label: t('bar.exit'),
      icon: 'close',
      ghost: true,
      onClick: onExit,
    },
  ];
}
