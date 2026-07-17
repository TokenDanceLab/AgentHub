import type { TranscriptBlock } from '../transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeHelpers — pure residual slice from
   useWorkbenchTranscriptChrome (#615).

   Constants, title resolution, toast labels, and menu/action builders.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export const SELECTION_HOLD_DELAY_MS = 520;
export const SELECTION_HOLD_CANCEL_DISTANCE = 36;

export interface WorkbenchContextMenuState {
  blockId: string;
  title: string;
  x: number;
  y: number;
}

export type TranscriptChromeTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function isNestedInteractiveTarget(target: EventTarget | null, card: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest('button, a, input, textarea, select, label, [contenteditable="true"]');
  return Boolean(interactive && interactive !== card && !interactive.hasAttribute('data-selectable-card'));
}

export function blockTitle(
  block: TranscriptBlock,
  t: TranscriptChromeTranslate,
): string {
  switch (block.kind) {
    case 'text':
      return block.text.slice(0, 28) || block.author.name;
    case 'tool_call':
      return block.toolName;
    case 'tool_result':
      return `${block.toolName} result`;
    case 'file_change':
      return block.path;
    case 'permission_request':
    case 'permission_result':
    case 'failure':
    case 'finished':
      return block.title;
    case 'preview':
      return block.url ?? block.previewId;
    case 'diff':
    case 'approval':
    case 'artifact':
    case 'subagent':
    case 'subtask':
    case 'child_agent':
    case 'run_session':
    case 'run_step_group':
      return block.title;
    case 'agent_timeline':
      return block.title ?? t('mainchain.timeline');
    case 'result':
      return block.summary || (block.success ? t('mainchain.result') : t('mainchain.fail'));
    case 'thinking':
      return t('mainchain.thinking');
    case 'route_decision':
      return block.targetAgent || block.action;
    case 'context_usage':
      return block.modelLabel || '上下文用量';
    default:
      return '消息卡片';
  }
}

export function cardActionLabel(
  action: string,
  title: string,
  t: TranscriptChromeTranslate,
): string {
  const labels: Record<string, string> = {
    copy: t('toast.cardCopied'),
    react: t('toast.reactOpened'),
    reply: `${t('context.reply')} ${title}`,
    forward: t('toast.forwardQueued'),
    topic: t('toast.topicDraft'),
    pin: t('toast.pinUpdated'),
    link: t('toast.linkCopied'),
    translate: t('toast.translateQueued'),
    task: t('toast.taskDraft'),
    export: t('toast.exportDraft'),
    apps: t('toast.appsOpened'),
    delete: t('toast.deleteQueued'),
  };
  return labels[action] ?? t('toast.actionRecorded');
}

export function multiActionLabel(
  action: string,
  count: number,
  t: TranscriptChromeTranslate,
): string {
  const labels: Record<string, string> = {
    copy: t('toast.multiCopy', { count }),
    forward: t('toast.multiForward', { count }),
    task: t('toast.multiTaskDraft', { count }),
    export: t('toast.multiExport', { count }),
    delete: t('toast.multiDelete', { count }),
  };
  return labels[action] ?? t('toast.multiProcessed', { count });
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
  const isTextBlock = block?.kind === 'text';
  return [
    [
      { label: t('context.copy'), icon: 'fileText', shortcut: 'Ctrl C', onClick: () => onAction('copy', blockId) },
      { label: t('context.react'), icon: 'star', chevron: true, onClick: () => onAction('react', blockId) },
      { label: t('context.reply'), icon: 'notes', onClick: () => onAction('reply', blockId) },
      ...(isTextBlock ? [{ label: t('context.quote'), icon: 'copy' as const, onClick: () => onAction('quote', blockId) }] : []),
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
