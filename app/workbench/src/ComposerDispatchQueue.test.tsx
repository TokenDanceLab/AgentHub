// ComposerDispatchQueue behavior (#1965, UX F7): the visible dispatch-only
// queue for already-persisted Hub messages. Asserts order/target/preview/
// retry-state visibility, undo/reorder/retarget/retry wiring, the disabled
// controls around dispatching rows, and honest rendering per status.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ComposerMention } from '@shared/composer';
import { useTestI18nLanguage } from '@shared/testing/i18n';

import { ComposerDispatchQueue } from './ComposerDispatchQueue';
import type {
  PendingDispatchQueueItemView,
  PendingIntentMove,
} from './composer/pendingIntents';

// Queue copy assertions use the zh chatview literals (integration-suite
// parity); opt into the zh bundle of the shared test i18next instance.
beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function item(overrides: Partial<PendingDispatchQueueItemView> = {}): PendingDispatchQueueItemView {
  return {
    messageId: 'm-1',
    agentId: 'builder',
    agentLabel: 'Builder',
    text: '第一条消息',
    attempt: 0,
    status: 'queued',
    ...overrides,
  };
}

function renderQueue(
  items: PendingDispatchQueueItemView[],
  handlers: {
    onUndo?: (messageId: string) => void;
    onMove?: (messageId: string, move: PendingIntentMove) => void;
    onRetarget?: (messageId: string, targetId: string) => void;
    onRetry?: (messageId: string) => void;
    onClearAll?: () => void;
  } = {},
  options: { isRunning?: boolean; retargetOptions?: ComposerMention[] } = {},
) {
  return render(
    <ComposerDispatchQueue
      isRunning={options.isRunning ?? false}
      items={items}
      onClearAll={handlers.onClearAll ?? vi.fn()}
      onMove={handlers.onMove ?? vi.fn()}
      onRetarget={handlers.onRetarget ?? vi.fn()}
      onRetry={handlers.onRetry ?? vi.fn()}
      onUndo={handlers.onUndo ?? vi.fn()}
      {...(options.retargetOptions ? { retargetOptions: options.retargetOptions } : {})}
    />,
  );
}

describe('ComposerDispatchQueue', () => {
  it('renders nothing for an empty queue', () => {
    const { container } = renderQueue([]);
    expect(container.firstChild).toBeNull();
  });

  it('shows order, text preview, target and status for every row', () => {
    renderQueue([
      item(),
      item({ messageId: 'm-2', text: '第二条消息', agentLabel: 'Reviewer', agentId: 'reviewer' }),
    ]);
    expect(screen.getByRole('region', { name: '待派发队列' })).toBeInTheDocument();
    expect(screen.getByText('待派发队列')).toBeInTheDocument();
    expect(screen.getByText('第一条消息')).toBeInTheDocument();
    expect(screen.getByText('第二条消息')).toBeInTheDocument();
    expect(screen.getByText('@Builder')).toBeInTheDocument();
    expect(screen.getByText('@Reviewer')).toBeInTheDocument();
    // Both rows show the queued status copy.
    expect(screen.getAllByText('排队中')).toHaveLength(2);
    // Idle summary explains that dispatch is about to happen in order.
    expect(screen.getByText('2 条排队中，即将按序派发')).toBeInTheDocument();
    // The boundary notice: next-turn only, transcript survives undo.
    expect(screen.getByText(
      '队列只安排下一轮派单的顺序与目标，不会打断正在运行的任务；撤销只取消派单，已发送的消息保留在聊天记录中。',
    )).toBeInTheDocument();
  });

  it('labels the wait honestly while a run is in progress', () => {
    renderQueue([item()], {}, { isRunning: true });
    expect(screen.getByText('1 条排队中，当前任务结束后按序派发')).toBeInTheDocument();
  });

  it('wires undo / reorder / clear callbacks with the right row id', () => {
    const onUndo = vi.fn();
    const onMove = vi.fn();
    const onClearAll = vi.fn();
    renderQueue(
      [item(), item({ messageId: 'm-2', text: '第二条消息' }), item({ messageId: 'm-3', text: '第三条消息' })],
      { onUndo, onMove, onClearAll },
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销派单：第二条消息' }));
    expect(onUndo).toHaveBeenCalledWith('m-2');
    fireEvent.click(screen.getByRole('button', { name: '置顶：第三条消息' }));
    expect(onMove).toHaveBeenCalledWith('m-3', 'front');
    fireEvent.click(screen.getByRole('button', { name: '上移：第二条消息' }));
    expect(onMove).toHaveBeenCalledWith('m-2', 'up');
    fireEvent.click(screen.getByRole('button', { name: '下移：第一条消息' }));
    expect(onMove).toHaveBeenCalledWith('m-1', 'down');
    fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('disables reorder controls at boundaries', () => {
    renderQueue([item(), item({ messageId: 'm-2', text: '第二条消息' })]);
    expect(screen.getByRole('button', { name: '上移：第一条消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '置顶：第一条消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移：第二条消息' })).toBeDisabled();
  });

  it('locks every control on a dispatching row and blocks moves across it', () => {
    const onMove = vi.fn();
    renderQueue(
      [
        item({ status: 'dispatching' }),
        item({ messageId: 'm-2', text: '第二条消息' }),
        item({ messageId: 'm-3', text: '第三条消息' }),
      ],
      { onMove },
    );
    expect(screen.getByRole('button', { name: '撤销派单：第一条消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '置顶：第一条消息' })).toBeDisabled();
    // The row behind the in-flight one cannot jump over it.
    expect(screen.getByRole('button', { name: '置顶：第二条消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上移：第二条消息' })).toBeDisabled();
    // Local reorder behind the in-flight row still works.
    fireEvent.click(screen.getByRole('button', { name: '下移：第二条消息' }));
    expect(onMove).toHaveBeenCalledWith('m-2', 'down');
  });

  it('disables clear-all while every row is in flight', () => {
    renderQueue([item({ status: 'dispatching' })]);
    expect(screen.getByRole('button', { name: '清空队列' })).toBeDisabled();
  });

  it('shows retry only for failed rows and renders the failure reason', () => {
    const onRetry = vi.fn();
    const { unmount } = renderQueue(
      [
        item({ status: 'failed', failureReason: 'dispatch-error' }),
        item({ messageId: 'm-2', text: '第二条消息', status: 'failed', failureReason: 'retry-exhausted', attempt: 3 }),
      ],
      { onRetry },
    );
    expect(screen.getByText('派发失败')).toBeInTheDocument();
    expect(screen.getByText('重试 3 次仍被拒绝')).toBeInTheDocument();
    const retryButtons = screen.getAllByRole('button', { name: '重试' });
    expect(retryButtons).toHaveLength(2);
    fireEvent.click(retryButtons[1]!);
    expect(onRetry).toHaveBeenCalledWith('m-2');
    unmount();
    // Queued rows never expose a retry control.
    renderQueue([item()]);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('renders the retarget select only with 2+ dispatch targets and wires changes', () => {
    const onRetarget = vi.fn();
    const twoAgents: ComposerMention[] = [
      { id: 'builder', label: 'Builder', dispatchRole: 'dispatch', status: 'available' },
      { id: 'reviewer', label: 'Reviewer', dispatchRole: 'dispatch', status: 'available' },
    ];
    renderQueue([item()], { onRetarget }, { retargetOptions: twoAgents });
    const select = screen.getByRole('combobox', { name: '更改派单目标：第一条消息' });
    fireEvent.change(select, { target: { value: 'reviewer' } });
    expect(onRetarget).toHaveBeenCalledWith('m-1', 'reviewer');
  });

  it('hides the retarget control when there is no alternative target', () => {
    const oneAgent: ComposerMention[] = [
      { id: 'builder', label: 'Builder', dispatchRole: 'dispatch', status: 'available' },
    ];
    renderQueue([item()], {}, { retargetOptions: oneAgent });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('disables retargeting while the row is already dispatching', () => {
    const twoAgents: ComposerMention[] = [
      { id: 'builder', label: 'Builder', dispatchRole: 'dispatch', status: 'available' },
      { id: 'reviewer', label: 'Reviewer', dispatchRole: 'dispatch', status: 'available' },
    ];
    renderQueue([item({ status: 'dispatching' })], {}, { retargetOptions: twoAgents });
    expect(screen.getByRole('combobox', { name: '更改派单目标：第一条消息' })).toBeDisabled();
  });
});
