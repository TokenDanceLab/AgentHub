import type { ComposerAction } from '../composer';
import type { ApprovalDecisionAction, TranscriptBlock } from '../transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeHelpers — pure residual slices from
   useWorkbenchTranscriptChrome (#615, #627, #650).

   Constants, title/label resolution, menu builders, selection math,
   action planners, timer/hold disposers, and pointer/hotkey residual
   planners. No React hooks / no intentional UX change.
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

export function cardLinkForBlock(blockId: string): string {
  return `agenthub://card/${blockId}`;
}

export function toggleIdInList(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export function addIdIfMissing(current: string[], id: string): string[] {
  return current.includes(id) ? current : [...current, id];
}

export function mergeUniqueIds(current: string[], next: string[]): string[] {
  return Array.from(new Set([...current, ...next]));
}

export function removeIdFromList(current: string[], id: string): string[] {
  return current.filter((item) => item !== id);
}

export function resolveSelectionRangeIds(
  transcript: TranscriptBlock[],
  selectedBlockIds: string[],
  targetBlockId: string,
): string[] | null {
  const selectedIndexes = selectedBlockIds
    .map((id) => transcript.findIndex((block) => block.id === id))
    .filter((index) => index >= 0);
  const anchorIndex = selectedIndexes.length
    ? selectedIndexes[selectedIndexes.length - 1]!
    : transcript.findIndex((block) => block.id === targetBlockId);
  const targetIndex = transcript.findIndex((block) => block.id === targetBlockId);

  if (anchorIndex < 0 || targetIndex < 0) {
    return null;
  }

  const [from, to] = anchorIndex < targetIndex
    ? [anchorIndex, targetIndex]
    : [targetIndex, anchorIndex];
  return transcript.slice(from, to + 1).map((block) => block.id);
}

export function shouldCancelSelectionHold(
  hold: { x: number; y: number },
  clientX: number,
  clientY: number,
  cancelDistance: number = SELECTION_HOLD_CANCEL_DISTANCE,
): boolean {
  const dx = Math.abs(clientX - hold.x);
  const dy = Math.abs(clientY - hold.y);
  return dx > cancelDistance || dy > cancelDistance;
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

export function selectBarRectFromWorkspace(
  rect: Pick<DOMRect, 'left' | 'width'> | null | undefined,
): { left: number; width: number } | null {
  if (!rect) return null;
  return {
    left: rect.left,
    width: rect.width,
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

export interface TranscriptPointerLike {
  button: number;
  target: EventTarget | null;
  currentTarget: HTMLElement;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
}

export function shouldBeginHoldSelection(event: TranscriptPointerLike): boolean {
  return event.button === 0 && !isNestedInteractiveTarget(event.target, event.currentTarget);
}

export function shouldHandleSelectionPointerUp(
  selectionMode: boolean,
  event: TranscriptPointerLike,
): boolean {
  return (
    selectionMode
    && event.button === 0
    && !isNestedInteractiveTarget(event.target, event.currentTarget)
  );
}

export function selectionHotkeyPreventsDefault(
  command: SelectionHotkeyCommand,
): command is Exclude<SelectionHotkeyCommand, { type: 'escape' }> {
  return command.type !== 'escape';
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

export interface SelectionHoldState {
  blockId: string;
  timer: number | null;
  x: number;
  y: number;
}

export function createSelectionHoldState(
  blockId: string,
  clientX: number,
  clientY: number,
  timer: number | null,
): SelectionHoldState {
  return {
    blockId,
    timer,
    x: clientX,
    y: clientY,
  };
}

export function transcriptBlockIds(transcript: TranscriptBlock[]): string[] {
  return transcript.map((block) => block.id);
}

/* ── residual pure planners / timer helpers (#650) ───────────────────── */

export interface SelectBarRect {
  left: number;
  width: number;
}

export interface ExitSelectionSnapshot {
  selectionMode: false;
  selectedBlockIds: string[];
}

export interface EnterSelectionSnapshot {
  selectionMode: true;
  selectedBlockIds: string[];
}

export interface ResetSelectionSnapshot {
  contextMenu: null;
  selectionMode: false;
  selectedBlockIds: string[];
  actionedBlockIds: string[];
  softHiddenBlockIds: string[];
}

export function createExitSelectionSnapshot(): ExitSelectionSnapshot {
  return {
    selectionMode: false,
    selectedBlockIds: [],
  };
}

export function createEnterSelectionSnapshot(blockId: string): EnterSelectionSnapshot {
  return {
    selectionMode: true,
    selectedBlockIds: [blockId],
  };
}

export function createResetSelectionSnapshot(): ResetSelectionSnapshot {
  return {
    contextMenu: null,
    selectionMode: false,
    selectedBlockIds: [],
    actionedBlockIds: [],
    softHiddenBlockIds: [],
  };
}

export function writeClipboardText(text: string): void {
  try {
    navigator.clipboard?.writeText?.(text)?.catch?.(() => {});
  } catch {
    // Clipboard is optional in local preview and test environments.
  }
}

export function clearTimeoutIfSet(timerId: number | null | undefined): void {
  if (timerId === null || timerId === undefined) return;
  window.clearTimeout(timerId);
}

export function clearSelectionHoldTimer(hold: SelectionHoldState | null | undefined): void {
  clearTimeoutIfSet(hold?.timer ?? null);
}

export function clearPulseTimers(timers: Map<string, number>): void {
  timers.forEach((id) => window.clearTimeout(id));
  timers.clear();
}

export function disposeSelectionHoldRef(
  holdRef: { current: SelectionHoldState | null },
): void {
  clearSelectionHoldTimer(holdRef.current);
  holdRef.current = null;
}

export function disposeToastAndPulseTimers(
  toastTimerRef: { current: number | null },
  pulseTimersRef: { current: Map<string, number> },
): void {
  clearTimeoutIfSet(toastTimerRef.current);
  toastTimerRef.current = null;
  clearPulseTimers(pulseTimersRef.current);
}

export function scheduleWorkbenchToastTimer(
  toastTimerRef: { current: number | null },
  onHide: () => void,
  durationMs: number = WORKBENCH_TOAST_MS,
): void {
  clearTimeoutIfSet(toastTimerRef.current);
  toastTimerRef.current = window.setTimeout(onHide, durationMs);
}

export function schedulePulseTimer(
  pulseTimers: Map<string, number>,
  blockId: string,
  onEnd: () => void,
  durationMs: number = WORKBENCH_PULSE_MS,
): void {
  const existing = pulseTimers.get(blockId);
  clearTimeoutIfSet(existing);
  const timerId = window.setTimeout(() => {
    onEnd();
    pulseTimers.delete(blockId);
  }, durationMs);
  pulseTimers.set(blockId, timerId);
}

export type BeginHoldSelectionPlan =
  | { type: 'ignore' }
  | {
    type: 'begin';
    blockId: string;
    clientX: number;
    clientY: number;
    delayMs: number;
  };

export function planBeginHoldSelection(
  blockId: string,
  event: TranscriptPointerLike,
): BeginHoldSelectionPlan {
  if (!shouldBeginHoldSelection(event)) {
    return { type: 'ignore' };
  }
  return {
    type: 'begin',
    blockId,
    clientX: event.clientX,
    clientY: event.clientY,
    delayMs: SELECTION_HOLD_DELAY_MS,
  };
}

export function beginSelectionHold(
  holdRef: { current: SelectionHoldState | null },
  plan: Extract<BeginHoldSelectionPlan, { type: 'begin' }>,
  onHold: () => void,
): void {
  disposeSelectionHoldRef(holdRef);
  holdRef.current = createSelectionHoldState(
    plan.blockId,
    plan.clientX,
    plan.clientY,
    window.setTimeout(() => {
      onHold();
      holdRef.current = null;
    }, plan.delayMs),
  );
}

export type UpdateHoldSelectionPlan =
  | { type: 'noop' }
  | { type: 'cancel' };

export function planUpdateHoldSelection(
  hold: Pick<SelectionHoldState, 'x' | 'y'> | null | undefined,
  clientX: number,
  clientY: number,
): UpdateHoldSelectionPlan {
  if (!hold) return { type: 'noop' };
  return shouldCancelSelectionHold(hold, clientX, clientY)
    ? { type: 'cancel' }
    : { type: 'noop' };
}

export type BlockPointerUpPlan =
  | { type: 'noop' }
  | { type: 'consumeSuppress' }
  | { type: 'select'; blockId: string; shiftKey: boolean };

export function planBlockPointerUp(
  blockId: string,
  options: {
    suppressPointerUp: boolean;
    selectionMode: boolean;
    event: TranscriptPointerLike;
  },
): BlockPointerUpPlan {
  if (options.suppressPointerUp) {
    return { type: 'consumeSuppress' };
  }
  if (!shouldHandleSelectionPointerUp(options.selectionMode, options.event)) {
    return { type: 'noop' };
  }
  return {
    type: 'select',
    blockId,
    shiftKey: options.event.shiftKey,
  };
}

export type BlockSelectPlan =
  | { type: 'toggle'; blockId: string }
  | { type: 'range'; rangeIds: string[] };

export function planBlockSelect(
  blockId: string,
  shiftKey: boolean | undefined,
  transcript: TranscriptBlock[],
  selectedBlockIds: string[],
): BlockSelectPlan {
  if (!shiftKey) {
    return { type: 'toggle', blockId };
  }
  const plan = resolveShiftSelectRange(transcript, selectedBlockIds, blockId);
  if (plan.mode === 'toggle') {
    return { type: 'toggle', blockId: plan.blockId };
  }
  return { type: 'range', rangeIds: plan.rangeIds };
}

export function applySelectionHotkeyPlan(
  plan: SelectionHotkeyPlan,
  handlers: {
    clearSelection: () => void;
    selectAll: (selectedBlockIds: string[]) => void;
    runMultiAction: (action: 'copy' | 'delete') => void;
  },
): void {
  if (plan.type === 'clearSelection') {
    handlers.clearSelection();
    return;
  }
  if (plan.type === 'selectAll') {
    handlers.selectAll(plan.selectedBlockIds);
    return;
  }
  handlers.runMultiAction(plan.action);
}

export function focusComposerInput(
  composerInputRef: { current: { focus: () => void } | null },
): void {
  deferFocus(() => composerInputRef.current?.focus());
}

export function resolveSelectBarRectFromElement(
  element: { getBoundingClientRect: () => DOMRect } | null | undefined,
): SelectBarRect | null {
  return selectBarRectFromWorkspace(element?.getBoundingClientRect());
}

export type SelectionHotkeyPlan =
  | { type: 'clearSelection'; preventDefault: false }
  | { type: 'selectAll'; preventDefault: true; selectedBlockIds: string[] }
  | { type: 'multiAction'; preventDefault: true; action: 'copy' | 'delete' };

export function planSelectionHotkeyEffect(
  event: { key: string; ctrlKey: boolean; metaKey: boolean },
  transcript: TranscriptBlock[],
): SelectionHotkeyPlan | null {
  const command = resolveSelectionHotkey(event);
  if (!command) return null;
  if (command.type === 'escape') {
    return { type: 'clearSelection', preventDefault: false };
  }
  if (command.type === 'selectAll') {
    return {
      type: 'selectAll',
      preventDefault: true,
      selectedBlockIds: transcriptBlockIds(transcript),
    };
  }
  return {
    type: 'multiAction',
    preventDefault: true,
    action: command.action,
  };
}

export function mergeSoftHiddenBlockIds(
  current: string[],
  blockIds: string[],
): string[] {
  return mergeUniqueIds(current, blockIds);
}

export function nextActionedBlockIdsOnPulseStart(
  current: string[],
  blockId: string,
): string[] {
  return addIdIfMissing(current, blockId);
}

export function nextActionedBlockIdsOnPulseEnd(
  current: string[],
  blockId: string,
): string[] {
  return removeIdFromList(current, blockId);
}

export function nextSelectedBlockIdsOnToggle(
  current: string[],
  blockId: string,
): string[] {
  return toggleIdInList(current, blockId);
}

export function nextSelectedBlockIdsOnRange(
  current: string[],
  rangeIds: string[],
): string[] {
  return mergeUniqueIds(current, rangeIds);
}

export function resolveShiftSelectRange(
  transcript: TranscriptBlock[],
  selectedBlockIds: string[],
  blockId: string,
): { mode: 'toggle'; blockId: string } | { mode: 'range'; rangeIds: string[] } {
  const rangeIds = resolveSelectionRangeIds(transcript, selectedBlockIds, blockId);
  if (!rangeIds) {
    return { mode: 'toggle', blockId };
  }
  return { mode: 'range', rangeIds };
}

export function deferFocus(focus: () => void): void {
  // Mirrors the prior window.setTimeout(..., 0) composer focus behavior.
  window.setTimeout(focus, 0);
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

/* ── residual controller factory (#650) ──────────────────────────────── */

export interface TranscriptChromeMutableRefs {
  selectionModeRef: { current: boolean };
  selectionHoldRef: { current: SelectionHoldState | null };
  suppressSelectionPointerUpRef: { current: boolean };
  runMultiActionRef: { current: ((action: string) => void) | null };
  toastTimerRef: { current: number | null };
  pulseTimersRef: { current: Map<string, number> };
}

export interface TranscriptChromeStateWriters {
  setContextMenu: (value: WorkbenchContextMenuState | null) => void;
  setSelectionMode: (value: boolean) => void;
  setSelectedBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setActionedBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setSoftHiddenBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setSelectBarRect: (value: SelectBarRect | null) => void;
  setToastMessage: (value: string) => void;
  setToastVisible: (value: boolean) => void;
}

export interface TranscriptChromeControllerDeps {
  refs: TranscriptChromeMutableRefs;
  writers: TranscriptChromeStateWriters;
  getTranscript: () => TranscriptBlock[];
  getSelectedBlockIds: () => string[];
  t: TranscriptChromeTranslate;
  dispatchComposer: (action: ComposerAction) => void;
  composerInputRef: { current: { focus: () => void } | null };
  onRegenerate?: ((blockId: string) => void) | undefined;
  onApprovalDecision?: ((decision: ApprovalDecisionAction) => Promise<void> | void) | undefined;
}

export interface TranscriptChromeController {
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
  pulseBlock: (blockId: string) => void;
  softHideBlocks: (blockIds: string[]) => void;
  exitSelection: () => void;
  enterSelection: (blockId: string) => void;
  resetSelection: () => void;
  openBlockContextMenu: (
    block: TranscriptBlock,
    event: { preventDefault: () => void; clientX: number; clientY: number },
  ) => void;
  handleBlockSelect: (blockId: string, event?: { shiftKey?: boolean }) => void;
  beginBlockHoldSelection: (block: TranscriptBlock, event: TranscriptPointerLike) => void;
  updateBlockHoldSelection: (event: TranscriptPointerLike) => void;
  handleBlockPointerUp: (block: TranscriptBlock, event: TranscriptPointerLike) => void;
  handleTranscriptBlockAction: (
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ) => void;
  runContextAction: (action: string, blockId: string) => void;
  runMultiAction: (action: string) => void;
  handleSelectionHotkey: (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }) => void;
  updateSelectBarRect: (
    element: { getBoundingClientRect: () => DOMRect } | null | undefined,
  ) => void;
  disposeSelectionHold: () => void;
  disposeTimers: () => void;
  contextMenuGroups: (blockId: string) => Array<Array<ContextMenuItem>>;
  multiSelectActions: () => Array<MultiSelectBarAction>;
  effectHandlers: () => TranscriptChromeEffectHandlers;
}

export function createTranscriptChromeController(
  deps: TranscriptChromeControllerDeps,
): TranscriptChromeController {
  const { refs, writers, getTranscript, getSelectedBlockIds, t } = deps;

  const showWorkbenchToast = (message: string): void => {
    writers.setToastMessage(message);
    writers.setToastVisible(true);
    scheduleWorkbenchToastTimer(refs.toastTimerRef, () => writers.setToastVisible(false));
  };

  const copyText = (text: string): void => {
    writeClipboardText(text);
  };

  const pulseBlock = (blockId: string): void => {
    writers.setActionedBlockIds((current) => nextActionedBlockIdsOnPulseStart(current, blockId));
    schedulePulseTimer(refs.pulseTimersRef.current, blockId, () => {
      writers.setActionedBlockIds((current) => nextActionedBlockIdsOnPulseEnd(current, blockId));
    });
  };

  const softHideBlocks = (blockIds: string[]): void => {
    writers.setSoftHiddenBlockIds((current) => mergeSoftHiddenBlockIds(current, blockIds));
  };

  const exitSelection = (): void => {
    const snapshot = createExitSelectionSnapshot();
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
  };

  const enterSelection = (blockId: string): void => {
    const snapshot = createEnterSelectionSnapshot(blockId);
    refs.selectionModeRef.current = snapshot.selectionMode;
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
  };

  const resetSelection = (): void => {
    const snapshot = createResetSelectionSnapshot();
    writers.setContextMenu(snapshot.contextMenu);
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
    writers.setActionedBlockIds(snapshot.actionedBlockIds);
    writers.setSoftHiddenBlockIds(snapshot.softHiddenBlockIds);
  };

  const effectHandlers = (): TranscriptChromeEffectHandlers => createTranscriptChromeEffectHandlers({
    copyText,
    softHideBlocks,
    dispatchComposer: deps.dispatchComposer,
    focusComposer: () => focusComposerInput(deps.composerInputRef),
    onRegenerate: deps.onRegenerate,
    onApprovalDecision: deps.onApprovalDecision,
    pulseBlock,
    showWorkbenchToast,
    exitSelection,
  });

  const openBlockContextMenu = (
    block: TranscriptBlock,
    event: { preventDefault: () => void; clientX: number; clientY: number },
  ): void => {
    event.preventDefault();
    writers.setContextMenu(buildContextMenuState(block, event.clientX, event.clientY, t));
  };

  const handleBlockSelect = (blockId: string, event?: { shiftKey?: boolean }): void => {
    const plan = planBlockSelect(
      blockId,
      event?.shiftKey,
      getTranscript(),
      getSelectedBlockIds(),
    );
    if (plan.type === 'toggle') {
      writers.setSelectedBlockIds((current) => nextSelectedBlockIdsOnToggle(current, plan.blockId));
      return;
    }
    writers.setSelectionMode(true);
    writers.setSelectedBlockIds((current) => nextSelectedBlockIdsOnRange(current, plan.rangeIds));
  };

  const beginBlockHoldSelection = (
    block: TranscriptBlock,
    event: TranscriptPointerLike,
  ): void => {
    const plan = planBeginHoldSelection(block.id, event);
    if (plan.type === 'ignore') return;
    beginSelectionHold(refs.selectionHoldRef, plan, () => {
      enterSelection(block.id);
      refs.suppressSelectionPointerUpRef.current = true;
    });
  };

  const updateBlockHoldSelection = (event: TranscriptPointerLike): void => {
    const plan = planUpdateHoldSelection(
      refs.selectionHoldRef.current,
      event.clientX,
      event.clientY,
    );
    if (plan.type === 'cancel') disposeSelectionHoldRef(refs.selectionHoldRef);
  };

  const handleBlockPointerUp = (
    block: TranscriptBlock,
    event: TranscriptPointerLike,
  ): void => {
    disposeSelectionHoldRef(refs.selectionHoldRef);
    const plan = planBlockPointerUp(block.id, {
      suppressPointerUp: refs.suppressSelectionPointerUpRef.current,
      selectionMode: refs.selectionModeRef.current,
      event,
    });
    if (plan.type === 'consumeSuppress') {
      refs.suppressSelectionPointerUpRef.current = false;
      return;
    }
    if (plan.type === 'select') {
      handleBlockSelect(plan.blockId, { shiftKey: plan.shiftKey });
    }
  };

  const runContextAction = (action: string, blockId: string): void => {
    applyTranscriptChromeSideEffects(planContextAction({
      action,
      blockId,
      transcript: getTranscript(),
      t,
      selectedText: window.getSelection()?.toString() ?? null,
    }), effectHandlers());
  };

  const handleTranscriptBlockAction = (
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ): void => {
    applyTranscriptChromeSideEffects(planTranscriptBlockAction({
      action,
      blockId,
      transcript: getTranscript(),
      t,
      ...(metadata !== undefined ? { metadata } : {}),
    }), effectHandlers());
  };

  const runMultiAction = (action: string): void => {
    applyTranscriptChromeSideEffects(planMultiAction({
      action,
      selectedBlockIds: getSelectedBlockIds(),
      transcript: getTranscript(),
      t,
    }), effectHandlers());
  };

  const handleSelectionHotkey = (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }): void => {
    const plan = planSelectionHotkeyEffect(event, getTranscript());
    if (!plan) return;
    if (plan.preventDefault) event.preventDefault();
    applySelectionHotkeyPlan(plan, {
      clearSelection: exitSelection,
      selectAll: (ids) => writers.setSelectedBlockIds(ids),
      runMultiAction: (action) => refs.runMultiActionRef.current?.(action),
    });
  };

  const updateSelectBarRect = (
    element: { getBoundingClientRect: () => DOMRect } | null | undefined,
  ): void => {
    const next = resolveSelectBarRectFromElement(element);
    if (!next) return;
    writers.setSelectBarRect(next);
  };

  return {
    showWorkbenchToast,
    copyText,
    pulseBlock,
    softHideBlocks,
    exitSelection,
    enterSelection,
    resetSelection,
    openBlockContextMenu,
    handleBlockSelect,
    beginBlockHoldSelection,
    updateBlockHoldSelection,
    handleBlockPointerUp,
    handleTranscriptBlockAction,
    runContextAction,
    runMultiAction,
    handleSelectionHotkey,
    updateSelectBarRect,
    disposeSelectionHold: () => disposeSelectionHoldRef(refs.selectionHoldRef),
    disposeTimers: () => disposeToastAndPulseTimers(refs.toastTimerRef, refs.pulseTimersRef),
    contextMenuGroups: (blockId: string) => buildTranscriptContextMenuGroups({
      blockId,
      transcript: getTranscript(),
      t,
      onAction: runContextAction,
      onEnterSelection: enterSelection,
    }),
    multiSelectActions: () => buildTranscriptMultiSelectActions({
      t,
      onSelectAll: () => writers.setSelectedBlockIds(transcriptBlockIds(getTranscript())),
      onClear: () => writers.setSelectedBlockIds([]),
      onMultiAction: runMultiAction,
      onExit: exitSelection,
    }),
    effectHandlers,
  };
}
