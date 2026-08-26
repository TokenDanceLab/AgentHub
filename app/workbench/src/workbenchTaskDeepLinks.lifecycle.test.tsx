import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskItem } from './pages';
import {
  WorkbenchTaskDeepLinkProvider,
  useWorkbenchTaskDeepLinkSnapshot,
  useWorkbenchTaskDeepLinkStore,
} from './workbenchTaskDeepLinks';

const task: TaskItem = {
  id: 'task-052',
  title: '分页任务 52',
  project: '前端重构任务',
  assignee: 'Trump',
  startTime: '刚刚',
  dueDate: '今天 18:00',
  creator: 'demo-user',
  status: '进行中',
};

function LifecycleProbe(): React.ReactElement {
  const store = useWorkbenchTaskDeepLinkStore();
  const snapshot = useWorkbenchTaskDeepLinkSnapshot();
  return (
    <>
      <button type="button" onClick={() => store.openTaskDetailForConversation(task, 'c1')}>
        open
      </button>
      <button type="button" onClick={() => store.consume()}>
        consume
      </button>
      <button type="button" onClick={() => store.back()}>
        back
      </button>
      <output data-testid="deep-link-state">
        {JSON.stringify({
          pending: snapshot.pending?.type ?? null,
          applied: snapshot.applied?.direction ?? null,
          taskFocus: snapshot.taskFocus?.taskId ?? null,
        })}
      </output>
    </>
  );
}

function renderLifecycle(): ReturnType<typeof render> {
  return render(
    <WorkbenchTaskDeepLinkProvider>
      <LifecycleProbe />
    </WorkbenchTaskDeepLinkProvider>,
  );
}

describe('WorkbenchTaskDeepLinkProvider lifecycle', () => {
  it('does not leak pending/applied/taskFocus across Workbench unmount and remount', () => {
    const first = renderLifecycle();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.click(screen.getByRole('button', { name: 'consume' }));
    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(screen.getByTestId('deep-link-state')).toHaveTextContent(
      JSON.stringify({
        pending: 'back',
        applied: 'conversation-to-task',
        taskFocus: 'task-052',
      }),
    );

    first.unmount();
    renderLifecycle();
    expect(screen.getByTestId('deep-link-state')).toHaveTextContent(
      JSON.stringify({ pending: null, applied: null, taskFocus: null }),
    );
  });
});
