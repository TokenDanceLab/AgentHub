import type { ComposerAction } from '../composer';
import type { ApprovalDecisionAction, TranscriptBlock } from '../transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
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
  | { type: 'exitSelection' };

export function planContextAction(options: {
  action: string;
  blockId: string;
  transcript: TranscriptBlock[];
  t: TranscriptChromeTranslate;
  selectedText?: string | null;
}): TranscriptChromeSideEffect[] {
  const { action, blockId, transcript, t, selectedText } = options;
  const title = resolveBlockTitleById(transcript, blockId, t);
  const block = transcript.find((item) => item.id === blockId);
  const effects: TranscriptChromeSideEffect[] = [];

  if (action === 'copy') {
    effects.push({ type: 'copy', text: title });
  }
  if (action === 'link') {
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

  effects.push(
    { type: 'pulse', blockId },
    { type: 'toast', message: cardActionLabel(action, title, t) },
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
}

export function buildTranscriptContextMenuGroups({
  blockId,
  transcript,
  t,
  onAction,
  onEnterSelection,
}: BuildTranscriptContextMenuGroupsOptions): Array<Array<ContextMenuItem>> {
  const block = transcript.find((item) => item.id === blockId);
  const isAgentText = block?.kind === 'text' && block.author.role === 'agent';
  const isUserText = block?.kind === 'text' && block.author.role === 'human';
  const isTextBlock = block?.kind === 'text';
  return [
    [
      { label: t('context.copy'), icon: 'fileText', shortcut: 'Ctrl C', onClick: () => onAction('copy', blockId) },
      { label: t('context.react'), icon: 'star', chevron: true, onClick: () => onAction('react', blockId) },
      { label: t('context.reply'), icon: 'notes', onClick: () => onAction('reply', blockId) },
      ...(isTextBlock ? [{ label: t('context.quote'), icon: 'copy' as const, onClick: () => onAction('quote', blockId) }] : []),
      ...(isUserText ? [{ label: t('context.edit'), icon: 'edit' as const, onClick: () => onAction('edit', blockId) }] : []),
      { label: t('context.forward'), icon: 'external', onClick: () => onAction('forward', blockId) },
    ],
    [
      { label: t('context.createTopic'), icon: 'groups', onClick: () => onAction('topic', blockId) },
      { label: t('context.multiSelect'), icon: 'grid', shortcut: 'Shift', onClick: () => onEnterSelection(blockId) },
      { label: t('context.pinMessage'), icon: 'bell', onClick: () => onAction('pin', blockId) },
      { label: t('context.copyLink'), icon: 'external', onClick: () => onAction('link', blockId) },
      { label: t('context.translate'), icon: 'library', onClick: () => onAction('translate', blockId) },
    ],
    [
      ...(isAgentText ? [{ label: t('context.regenerate'), icon: 'refresh' as const, onClick: () => onAction('regenerate', blockId) }] : []),
      { label: t('context.addTask'), icon: 'running', onClick: () => onAction('task', blockId) },
      { label: t('context.exportDoc'), icon: 'download', onClick: () => onAction('export', blockId) },
      { label: t('context.apps'), icon: 'tools', chevron: true, onClick: () => onAction('apps', blockId) },
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
