import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  assignIfDefined,
  buildTerminalPanelDockProps,
  buildWorkbenchShellDataAttrs,
  buildWorkspaceMainDataAttrs,
  createTranscriptBlockContextMenuHandler,
  createTranscriptBlockSelectHandler,
  createVerticalResizerKeyDownHandler,
  createVerticalResizerPointerDownHandler,
  resolveComposerWorkDir,
  shellBooleanAttr,
  shouldRenderTerminalDock,
  toIdSet,
} from './workbenchFrameHelpers';

function textBlock(id = 'b1'): TranscriptBlock {
  return {
    id,
    kind: 'text',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('workbenchFrameHelpers', () => {
  it('keeps default browser preview URL as themed blank', () => {
    expect(DEFAULT_BROWSER_PREVIEW_URL).toBe('about:blank');
  });

  it('maps booleans to shell data attrs', () => {
    expect(shellBooleanAttr(true)).toBe('true');
    expect(shellBooleanAttr(false)).toBe('false');
  });

  it('builds shell data attrs without undefined optional fields', () => {
    const withoutMode = buildWorkbenchShellDataAttrs({
      inspectorCollapsed: true,
      inspectorResizing: false,
      activePage: 'chat',
      selectionMode: false,
      sidebarCollapsed: true,
      sidebarResizing: false,
    });
    expect(withoutMode).toEqual({
      'data-inspector-collapsed': 'true',
      'data-inspector-resizing': 'false',
      'data-page': 'chat',
      'data-selection-mode': 'false',
      'data-sidebar-collapsed': 'true',
      'data-sidebar-resizing': 'false',
      'data-testid': 'agenthub-workbench',
    });
    expect('data-data-mode' in withoutMode).toBe(false);

    const withMode = buildWorkbenchShellDataAttrs({
      inspectorCollapsed: false,
      inspectorResizing: true,
      activePage: 'agents',
      selectionMode: true,
      sidebarCollapsed: false,
      sidebarResizing: true,
      dataMode: 'live',
    });
    expect(withMode['data-data-mode']).toBe('live');
    expect(withMode['data-page']).toBe('agents');
  });

  it('builds workspace main data attrs for chat and workbench modes', () => {
    expect(
      buildWorkspaceMainDataAttrs({
        isChatPage: true,
        surface: 'web',
      }),
    ).toEqual({
      'data-mode': 'chat',
      'data-surface': 'web',
      'data-workspace-main': true,
    });

    expect(
      buildWorkspaceMainDataAttrs({
        isChatPage: false,
        surface: 'desktop',
      }),
    ).toEqual({
      'data-mode': 'workbench',
      'data-surface': 'desktop',
      'data-workspace-main': true,
    });
  });

  it('handles vertical resizer keyboard steps', () => {
    const resizeBy = vi.fn();
    const onKeyDown = createVerticalResizerKeyDownHandler(resizeBy);

    onKeyDown({
      key: 'ArrowLeft',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    expect(resizeBy).toHaveBeenLastCalledWith(-16);

    onKeyDown({
      key: 'ArrowRight',
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    expect(resizeBy).toHaveBeenLastCalledWith(40);

    onKeyDown({
      key: 'ArrowUp',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    expect(resizeBy).toHaveBeenCalledTimes(2);
  });

  it('begins pointer resize only when not collapsed', () => {
    const beginResize = vi.fn();
    const setPointerCapture = vi.fn();

    const collapsed = createVerticalResizerPointerDownHandler(true, beginResize);
    collapsed({
      clientX: 120,
      preventDefault: vi.fn(),
      currentTarget: { setPointerCapture },
      pointerId: 1,
    } as unknown as React.PointerEvent<HTMLDivElement>);
    expect(beginResize).not.toHaveBeenCalled();

    const open = createVerticalResizerPointerDownHandler(false, beginResize);
    open({
      clientX: 240,
      preventDefault: vi.fn(),
      currentTarget: { setPointerCapture },
      pointerId: 2,
    } as unknown as React.PointerEvent<HTMLDivElement>);
    expect(setPointerCapture).toHaveBeenCalledWith(2);
    expect(beginResize).toHaveBeenCalledWith(240);
  });

  it('builds id sets and block event adapters', () => {
    expect([...toIdSet(['a', 'b', 'a'])]).toEqual(['a', 'b']);

    const openMenu = vi.fn();
    const onContextMenu = createTranscriptBlockContextMenuHandler(
      [textBlock('b1'), textBlock('b2')],
      openMenu,
    );
    const event = { clientX: 1, clientY: 2 };
    onContextMenu('b2', event);
    expect(openMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b2' }),
      event,
    );
    onContextMenu('missing', event);
    expect(openMenu).toHaveBeenCalledTimes(1);

    const handleSelect = vi.fn();
    const onSelect = createTranscriptBlockSelectHandler(handleSelect);
    onSelect('b1');
    onSelect('b2', true);
    expect(handleSelect).toHaveBeenNthCalledWith(1, 'b1', { shiftKey: false });
    expect(handleSelect).toHaveBeenNthCalledWith(2, 'b2', { shiftKey: true });
  });

  it('resolves composer workDir and assigns optional fields safely', () => {
    expect(resolveComposerWorkDir(undefined)).toBeUndefined();
    expect(resolveComposerWorkDir(null)).toBeUndefined();
    expect(resolveComposerWorkDir('   ')).toBeUndefined();
    expect(resolveComposerWorkDir('/repo ')).toBe('/repo');

    const target: { label?: string; count?: number } = {};
    assignIfDefined(target, 'label', undefined);
    assignIfDefined(target, 'label', 'ok');
    assignIfDefined(target, 'count', 3);
    expect(target).toEqual({ label: 'ok', count: 3 });
  });

  it('gates terminal dock on chat page + localTerminal === true only', () => {
    expect(shouldRenderTerminalDock({ isChatPage: true, localTerminal: true })).toBe(true);
    expect(shouldRenderTerminalDock({ isChatPage: true, localTerminal: false })).toBe(false);
    expect(shouldRenderTerminalDock({ isChatPage: true, localTerminal: undefined })).toBe(false);
    expect(shouldRenderTerminalDock({ isChatPage: false, localTerminal: true })).toBe(false);
    expect(shouldRenderTerminalDock({ isChatPage: false })).toBe(false);
  });

  it('builds TerminalPanel dock props without undefined optional fields', () => {
    const withoutPort = buildTerminalPanelDockProps({});
    expect(withoutPort).toEqual({ localTerminal: true });
    expect('terminal' in withoutPort).toBe(false);

    const terminal = {
      list: vi.fn(),
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    const withPort = buildTerminalPanelDockProps({ terminal });
    expect(withPort.localTerminal).toBe(true);
    expect(withPort.terminal).toBe(terminal);
  });
});
