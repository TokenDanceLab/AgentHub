import type { WorkbenchDataMode } from '@shared/demo';
import { isWorkbenchRealDataMode } from '@shared/demo';
import type { TranscriptBlock } from '@shared/transcript';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
import { errorMessage } from './webWorkbenchError';

export type WebExecutionTargetStatusState =
  | 'hidden'
  | 'signed-out'
  | 'loading'
  | 'error'
  | 'no-target'
  | 'offline'
  | 'degraded'
  | 'mismatch'
  | 'stale'
  | 'wrong-profile'
  | 'ready';

export interface WebExecutionTargetStatus {
  state: WebExecutionTargetStatusState;
  selectedTarget?: ExecutionTargetInventoryItem | undefined;
  block?: TranscriptBlock | undefined;
}

export function resolveWebExecutionTargetStatus(input: {
  hubReady: boolean;
  dataMode: WorkbenchDataMode;
  isFetching: boolean;
  error: unknown;
  targets: ExecutionTargetInventoryItem[] | undefined;
}): WebExecutionTargetStatus {
  const visibleRealMode = input.hubReady || isWorkbenchRealDataMode(input.dataMode);
  if (!visibleRealMode) return { state: 'hidden' };
  if (!input.hubReady) {
    return targetStatus('signed-out', 'Sign in to Hub before Web can select a local_edge execution target.');
  }
  if (input.isFetching && !input.targets) {
    return targetStatus('loading', 'Loading Hub execution targets before Web dispatch.');
  }
  if (input.error) {
    return targetStatus('error', `Hub execution targets unavailable: ${errorMessage(input.error, 'Hub target inventory failed')}`);
  }

  const targets = input.targets ?? [];
  if (targets.length === 0) {
    return targetStatus(
      'no-target',
      'No online local_edge execution target is available. Web real Hub mode will not dispatch agent tasks to mock targets.',
    );
  }

  const localEdgeTargets = targets.filter((target) => target.target_type === 'local_edge');
  if (localEdgeTargets.length === 0) {
    return targetStatus(
      'wrong-profile',
      'Hub reported execution targets, but none are local_edge Desktop/Edge targets for Web agent dispatch.',
    );
  }

  const selectedTarget = localEdgeTargets.find((target) =>
    target.is_online === true && (target.health_state === 'online' || target.health_state === 'healthy')
  );
  if (!selectedTarget) {
    const mismatchTarget = localEdgeTargets.find((target) => target.health_state === 'mismatch');
    if (mismatchTarget) {
      return targetStatus(
        'mismatch',
        `Desktop/Edge target binding mismatch: ${executionTargetLabel(mismatchTarget)}. Web will not dispatch until Hub target and Desktop Edge identity match.`,
      );
    }
    const staleTarget = localEdgeTargets.find((target) => target.health_state === 'stale');
    if (staleTarget) {
      return targetStatus(
        'stale',
        `Desktop/Edge target health is stale: ${executionTargetLabel(staleTarget)}. Web will wait for a fresh Desktop check-in before dispatch.`,
      );
    }
    const degradedTarget = localEdgeTargets.find((target) =>
      target.is_online === true && target.health_state === 'degraded'
    );
    if (degradedTarget) {
      return targetStatus(
        'degraded',
        `Desktop/Edge target is degraded: ${executionTargetLabel(degradedTarget)}. Web will wait for a healthy target before dispatch.`,
      );
    }
    return targetStatus(
      'offline',
      'Desktop/Edge local_edge targets are offline or unavailable. Web real Hub mode will not dispatch agent tasks to mock targets.',
    );
  }

  return {
    state: 'ready',
    selectedTarget,
    block: targetStatusBlock(
      'ready',
      `Selected local_edge execution target: ${selectedTarget.name || selectedTarget.id} (${selectedTarget.id}).`,
    ),
  };
}

function targetStatus(state: Exclude<WebExecutionTargetStatusState, 'hidden' | 'ready'>, text: string): WebExecutionTargetStatus {
  return {
    state,
    selectedTarget: undefined,
    block: targetStatusBlock(state, text),
  };
}

export function executionTargetLabel(target: { id?: string; name?: string }): string {
  const id = target.id ?? '';
  return target.name ? `${target.name} (${id})` : id;
}

function targetStatusBlock(state: WebExecutionTargetStatusState, text: string): TranscriptBlock {
  return {
    id: `web-hub-execution-target-${state}`,
    kind: 'text',
    author: { id: 'hub-targets', name: 'Hub targets', role: 'system' },
    text,
  };
}
