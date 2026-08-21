import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AgentHubPlatform, TerminalPort } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import type { TranscriptContextMenuEvent } from './transcriptEventTypes';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchFrameHelpers — pure residual slices from WorkbenchFrame (#637).

   Shell attrs, resizer handlers, selection set builders, and block event
   adapters. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Demo/fixture BrowserPreview default (#1247).
 * about:blank + BrowserPreview themed empty document — not external white pages.
 * Users can still open real URLs via preview evidence / address navigation.
 */
export const DEFAULT_BROWSER_PREVIEW_URL = 'about:blank';

export type ShellBooleanAttr = 'true' | 'false';

export function shellBooleanAttr(value: boolean): ShellBooleanAttr {
  return value ? 'true' : 'false';
}

export interface WorkbenchShellDataAttrs {
  'data-inspector-collapsed': ShellBooleanAttr;
  'data-inspector-resizing': ShellBooleanAttr;
  'data-page': string;
  'data-selection-mode': ShellBooleanAttr;
  'data-sidebar-collapsed': ShellBooleanAttr;
  'data-sidebar-resizing': ShellBooleanAttr;
  'data-data-mode'?: string;
  'data-testid': 'agenthub-workbench';
}

export function buildWorkbenchShellDataAttrs(input: {
  inspectorCollapsed: boolean;
  inspectorResizing: boolean;
  activePage: string;
  selectionMode: boolean;
  sidebarCollapsed: boolean;
  sidebarResizing: boolean;
  dataMode?: string | undefined;
}): WorkbenchShellDataAttrs {
  const attrs: WorkbenchShellDataAttrs = {
    'data-inspector-collapsed': shellBooleanAttr(input.inspectorCollapsed),
    'data-inspector-resizing': shellBooleanAttr(input.inspectorResizing),
    'data-page': input.activePage,
    'data-selection-mode': shellBooleanAttr(input.selectionMode),
    'data-sidebar-collapsed': shellBooleanAttr(input.sidebarCollapsed),
    'data-sidebar-resizing': shellBooleanAttr(input.sidebarResizing),
    'data-testid': 'agenthub-workbench',
  };
  // exactOptionalPropertyTypes: only assign when defined
  if (input.dataMode !== undefined) {
    attrs['data-data-mode'] = input.dataMode;
  }
  return attrs;
}

export interface WorkspaceMainDataAttrs {
  'data-mainchain': ShellBooleanAttr;
  'data-mode': 'chat' | 'workbench';
  'data-surface': string;
  'data-workspace-main': true;
}

export function buildWorkspaceMainDataAttrs(input: {
  showMainchainStatus: boolean;
  isChatPage: boolean;
  surface: string;
}): WorkspaceMainDataAttrs {
  return {
    'data-mainchain': shellBooleanAttr(input.showMainchainStatus),
    'data-mode': input.isChatPage ? 'chat' : 'workbench',
    'data-surface': input.surface,
    'data-workspace-main': true,
  };
}

/** Keyboard handler for vertical panel resizers (sidebar / inspector pattern). */
export function createVerticalResizerKeyDownHandler(
  resizeBy: (delta: number) => void,
): (event: ReactKeyboardEvent) => void {
  return (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    resizeBy(event.key === 'ArrowLeft' ? -step : step);
  };
}

/** Pointer-down handler that begins a horizontal resize when not collapsed. */
export function createVerticalResizerPointerDownHandler(
  collapsed: boolean,
  beginResize: (clientX: number) => void,
): (event: ReactPointerEvent<HTMLDivElement>) => void {
  return (event) => {
    if (collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginResize(event.clientX);
  };
}

export function toIdSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

export function createTranscriptBlockContextMenuHandler(
  transcript: readonly TranscriptBlock[],
  openBlockContextMenu: (block: TranscriptBlock, event: TranscriptContextMenuEvent) => void,
): (blockId: string, event: unknown) => void {
  return (blockId, event) => {
    const block = transcript.find((b) => b.id === blockId);
    if (block) openBlockContextMenu(block, event as unknown as TranscriptContextMenuEvent);
  };
}

export function createTranscriptBlockSelectHandler(
  handleBlockSelect: (blockId: string, options: { shiftKey: boolean }) => void,
): (blockId: string, shiftKey?: boolean) => void {
  return (blockId, shiftKey) => handleBlockSelect(blockId, { shiftKey: shiftKey ?? false });
}

export function resolveComposerWorkDir(
  workDir: string | null | undefined,
): string | undefined {
  const trimmed = workDir?.trim();
  return trimmed ? trimmed : undefined;
}

/** exactOptionalPropertyTypes-safe optional field assign. */
export function assignIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

/**
 * Terminal bottom dock is Desktop/chat-only and strictly capability-gated.
 * Web / missing / false never renders the dock (#1182).
 */
export function shouldRenderTerminalDock(input: {
  isChatPage: boolean;
  localTerminal?: boolean | undefined;
}): boolean {
  return input.isChatPage && input.localTerminal === true;
}

export interface TerminalPanelDockProps {
  localTerminal: true;
  terminal?: TerminalPort | undefined;
}

/** exactOptionalPropertyTypes-safe TerminalPanel props for the workbench dock. */
export function buildTerminalPanelDockProps(
  platform: Pick<AgentHubPlatform, 'terminal'>,
): TerminalPanelDockProps {
  const props: TerminalPanelDockProps = {
    localTerminal: true,
  };
  if (platform.terminal) {
    props.terminal = platform.terminal;
  }
  return props;
}
