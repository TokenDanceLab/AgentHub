import type { ComposerIntent } from '@shared/composer';
import type { ExecutionTarget } from '@/api/hubClient';

export function isDispatchableLocalEdgeTarget(target: ExecutionTarget): boolean {
  return (
    target.target_type === 'local_edge' &&
    target.is_online === true &&
    (target.health_state === 'online' || target.health_state === 'healthy')
  );
}

export function targetDispatchBlockerLabel(target: ExecutionTarget): string {
  if (target.target_type !== 'local_edge') return `target type ${target.target_type}`;
  const healthState = target.health_state;
  if (healthState === 'online' || healthState === 'healthy') return target.is_online ? 'online' : 'offline';
  return healthState || (target.is_online ? 'unknown' : 'offline');
}

export function buildHubAgentTaskModelParams(intent: ComposerIntent): Record<string, unknown> {
  return {
    source: 'web-v4-workbench',
    mode: intent.mode,
    approval_mode: intent.approvalMode,
    ...(intent.workDir ? { work_dir: intent.workDir } : {}),
    mentions: intent.mentions.map((mention) => ({
      id: mention.id,
      label: mention.label,
      ...(mention.runtimeId ? { runtime_id: mention.runtimeId } : {}),
      ...(mention.model ? { model: mention.model } : {}),
      ...(mention.dispatchRole ? { dispatch_role: mention.dispatchRole } : {}),
    })),
    attachments: intent.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      ...(attachment.source ? { source: attachment.source } : {}),
      ...(attachment.kind ? { kind: attachment.kind } : {}),
      ...(attachment.mime ? { mime: attachment.mime } : {}),
      ...(attachment.truncated != null ? { truncated: attachment.truncated } : {}),
    })),
  };
}
