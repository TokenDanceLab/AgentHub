import { describe, expect, it } from 'vitest';
import { projectDraftToHubRequest } from './webWorkbenchProjects';
import { executionTargetLabel, resolveWebExecutionTargetStatus } from './webWorkbenchExecutionTargets';

describe('webWorkbench helper seam', () => {
  it('projectDraftToHubRequest falls back to default name', () => {
    expect(projectDraftToHubRequest({ name: '   ', description: 'x' })).toEqual({
      name: '未命名项目',
      description: 'x',
    });
  });

  it('executionTargetLabel handles missing name', () => {
    expect(executionTargetLabel({ id: 't-1' })).toBe('t-1');
    expect(executionTargetLabel({ id: 't-1', name: 'Edge' })).toBe('Edge (t-1)');
  });

  it('hides execution targets outside real/hub-ready modes', () => {
    expect(resolveWebExecutionTargetStatus({
      hubReady: false,
      dataMode: 'fixture',
      isFetching: false,
      error: null,
      targets: undefined,
    })).toEqual({ state: 'hidden' });
  });
});
