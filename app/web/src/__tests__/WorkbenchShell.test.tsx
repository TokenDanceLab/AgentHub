import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WorkbenchShell from '@/components/WorkbenchShell';
import { createWorkbenchState } from '@/state/workbenchState';

describe('WorkbenchShell', () => {
  it('renders the P0 three-pane command center against current client data', () => {
    render(
      <WorkbenchShell
        online
        connected
        error={null}
        health={{ status: 'ok', version: 'v1', edgeId: 'local' }}
        runners={[{ id: 'runner_local_1', name: 'Mock Runner', status: 'online' }]}
        state={createWorkbenchState()}
        onStartRun={() => undefined}
        onClearEvents={() => undefined}
      />,
    );

    expect(screen.getByRole('navigation', { name: '项目和线程' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '线程工作区' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '产物和检查面板' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Mock Runner')).toBeInTheDocument();
  });
});
