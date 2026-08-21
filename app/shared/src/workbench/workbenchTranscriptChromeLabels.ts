import type { ApprovalDecisionAction, TranscriptBlock } from '../transcript';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeLabels — pure residual label / title / quote
   slices from workbenchTranscriptChromeHelpers (#755).

   Timing constants, block title resolution, toast label maps, quote and
   permission decision mappers. No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign optional fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

export const SELECTION_HOLD_DELAY_MS = 520;
export const SELECTION_HOLD_CANCEL_DISTANCE = 36;
export const WORKBENCH_TOAST_MS = 1700;
export const WORKBENCH_PULSE_MS = 900;
export const QUOTE_PREVIEW_MAX_CHARS = 80;

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

export type SelectionHotkeyCommand =
  | { type: 'escape' }
  | { type: 'selectAll'; preventDefault: true }
  | { type: 'multiAction'; action: 'copy' | 'delete'; preventDefault: true };

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
      return block.modelLabel || t('mainchain.contextUsage');
    default:
      return t('mainchain.messageCard');
  }
}

export function resolveBlockTitleById(
  transcript: TranscriptBlock[],
  blockId: string,
  t: TranscriptChromeTranslate,
): string {
  const block = transcript.find((item) => item.id === blockId);
  return block ? blockTitle(block, t) : t('mainchain.selectedCard');
}

export function cardActionLabel(
  action: string,
  title: string,
  t: TranscriptChromeTranslate,
): string {
  const labels: Record<string, string> = {
    copy: t('toast.cardCopied'),
    react: t('toast.reactionAdded'),
    reply: `${t('context.reply')} ${title}`,
    forward: t('toast.forwardQueued'),
    pin: t('toast.pinUpdated'),
    link: t('toast.linkCopied'),
    delete: t('toast.deleteQueued'),
    edit: t('toast.editStarted'),
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
    delete: t('toast.multiDelete', { count }),
  };
  return labels[action] ?? t('toast.multiProcessed', { count });
}

export function cardLinkForBlock(
  blockId: string,
  sessionId?: string | null,
  baseUrl?: string,
): string {
  // #1504: copy a link that opens inside Web/Desktop instead of the dead
  // `agenthub://card/<blockId>` custom scheme (no handler registered on
  // Desktop/Web; native scheme registration is out of frontend scope).
  // The hash route `#/session/<sessionId>?block=<blockId>` is the provisional
  // in-app convention — the backend session route is not finalized yet.
  // Without a session id (Desktop/demo shells) fall back to a block-level
  // hash that still resolves within the app origin.
  const origin = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const blockParam = encodeURIComponent(blockId);
  if (sessionId) {
    return `${origin}/#/session/${encodeURIComponent(sessionId)}?block=${blockParam}`;
  }
  return `${origin}/#/card/${blockParam}`;
}

export function buildContextMenuState(
  block: TranscriptBlock,
  clientX: number,
  clientY: number,
  t: TranscriptChromeTranslate,
): WorkbenchContextMenuState {
  return {
    blockId: block.id,
    title: blockTitle(block, t),
    x: clientX,
    y: clientY,
  };
}

export function resolveSelectionHotkey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): SelectionHotkeyCommand | null {
  if (event.key === 'Escape') {
    return { type: 'escape' };
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    return { type: 'selectAll', preventDefault: true };
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    return { type: 'multiAction', action: 'copy', preventDefault: true };
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return { type: 'multiAction', action: 'delete', preventDefault: true };
  }
  return null;
}

export function resolveQuoteText(
  blockText: string,
  selectedText?: string | null,
  maxChars: number = QUOTE_PREVIEW_MAX_CHARS,
): string {
  const trimmed = selectedText?.trim();
  return trimmed || blockText.slice(0, maxChars);
}

export function buildQuoteComposerText(quoteText: string): string {
  return `> ${quoteText.split('\n').join('\n> ')}\n\n`;
}

export function buildPermissionApprovalDecision(
  block: Extract<TranscriptBlock, { kind: 'permission_request' }>,
  action: 'approve' | 'deny',
): ApprovalDecisionAction {
  // exactOptionalPropertyTypes-safe: only assign defined optional fields.
  const decision: ApprovalDecisionAction = {
    approvalId: block.requestId,
    decision: action === 'approve' ? 'allow' : 'deny',
  };
  if (block.teamId !== undefined) decision.teamId = block.teamId;
  if (block.teamRunId !== undefined) decision.teamRunId = block.teamRunId;
  if (block.agentTaskId !== undefined) decision.agentTaskId = block.agentTaskId;
  if (block.targetId !== undefined) decision.targetId = block.targetId;
  if (block.edgeDeviceId !== undefined) decision.edgeDeviceId = block.edgeDeviceId;
  if (block.correlationId !== undefined) decision.correlationId = block.correlationId;
  return decision;
}
