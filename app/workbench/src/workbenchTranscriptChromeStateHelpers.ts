import type { TranscriptBlock } from '@shared/transcript';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
  isNestedInteractiveTarget,
  resolveSelectionHotkey,
  type SelectionHotkeyCommand,
} from './workbenchTranscriptChromeLabels';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeStateHelpers — pure residual selection / hold /
   timer / snapshot slices from workbenchTranscriptChromeHelpers (#755).

   Id-list math, hold/pointer planners, selection hotkey plans, toast/pulse
   disposers. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

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

export function selectBarRectFromWorkspace(
  rect: Pick<DOMRect, 'left' | 'width'> | null | undefined,
): { left: number; width: number } | null {
  if (!rect) return null;
  return {
    left: rect.left,
    width: rect.width,
  };
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

export function deferFocus(focus: () => void): void {
  // Mirrors the prior window.setTimeout(..., 0) composer focus behavior.
  window.setTimeout(focus, 0);
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
