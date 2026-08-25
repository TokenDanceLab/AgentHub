import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuxPanel } from './AuxPanel';
import type { AuxPanelTab } from './types';

const labels: Record<AuxPanelTab, string> = {
  session_details: '会话详情',
  file_tree: '文件树',
  changes: '变更',
  preview: '预览',
  git_log: 'Git 日志',
};

function renderAux(activeTab: AuxPanelTab = 'session_details'): { onActiveTabChange: ReturnType<typeof vi.fn> } {
  const onActiveTabChange = vi.fn();
  render(
    <AuxPanel
      hasWorkspace
      activeTab={activeTab}
      onActiveTabChange={onActiveTabChange}
      labels={labels}
      children={{
        session_details: <div>details</div>,
        file_tree: <div>tree</div>,
        changes: <div>changes</div>,
        preview: <div>preview</div>,
        git_log: <div>log</div>,
      }}
    />,
  );
  return { onActiveTabChange };
}

describe('AuxPanel tablist roving tabindex (#1823)', () => {
  it('associates tabs with the tabpanel via id/aria-controls/aria-labelledby', () => {
    renderAux();
    const panel = screen.getByRole('tabpanel');
    const activeTab = screen.getByRole('tab', { name: '会话详情' });
    expect(panel.id).not.toBe('');
    expect(activeTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(activeTab.id);
  });

  it('moves focus with Arrow keys without changing the selected tab', () => {
    const { onActiveTabChange } = renderAux();
    const first = screen.getByRole('tab', { name: '会话详情' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    const second = screen.getByRole('tab', { name: '文件树' });
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    // Activation stays on click/Enter — arrows move focus only.
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(onActiveTabChange).not.toHaveBeenCalled();
  });

  it('moves the roving stop to the clicked tab (#1823)', () => {
    const { onActiveTabChange } = renderAux();
    const first = screen.getByRole('tab', { name: '会话详情' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('tab', { name: '文件树' });
    expect(second).toHaveAttribute('tabindex', '0');

    // A click activates another tab — the roving stop must follow it so the
    // next Tab press returns to the clicked tab, not the stale focused one.
    const changesTab = screen.getByRole('tab', { name: '变更' });
    fireEvent.click(changesTab);
    expect(onActiveTabChange).toHaveBeenCalledWith('changes');
    expect(changesTab).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    expect(first).toHaveAttribute('tabindex', '-1');
  });

  it('wraps around with ArrowLeft and supports Home/End', () => {
    renderAux();
    const tabs = screen.getAllByRole('tab');

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    const last = tabs[tabs.length - 1]!;
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'End' });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('leaves focus on the single Tab stop after a click re-selects', () => {
    const { onActiveTabChange } = renderAux();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.click(tabs[1]);
    expect(onActiveTabChange).toHaveBeenCalledWith('file_tree');
  });

  it('falls back to the effective tab when availability shrinks (#1823)', () => {
    const onActiveTabChange = vi.fn();
    const { rerender } = render(
      <AuxPanel
        hasWorkspace
        activeTab="session_details"
        onActiveTabChange={onActiveTabChange}
        labels={labels}
        children={{
          session_details: <div>details</div>,
          file_tree: <div>tree</div>,
          changes: <div>changes</div>,
          preview: <div>preview</div>,
          git_log: <div>log</div>,
        }}
      />,
    );
    const first = screen.getByRole('tab', { name: '会话详情' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('tab', { name: '文件树' });
    expect(second).toHaveAttribute('tabindex', '0');

    // Workspace closes: only 会话详情 stays available. The remembered
    // roving target dangles — the strip must fall back to the effective tab
    // instead of leaving every tab at tabIndex=-1.
    rerender(
      <AuxPanel
        hasWorkspace={false}
        activeTab="session_details"
        onActiveTabChange={onActiveTabChange}
        labels={labels}
        children={{ session_details: <div>details</div> }}
      />,
    );
    const remaining = screen.getAllByRole('tab');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveAttribute('tabindex', '0');
  });
});
