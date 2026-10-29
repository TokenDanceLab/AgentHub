import type { ComposerIntent } from '@shared/composer';
import type { ExecutionTarget } from '@/api/hubClient';
import { getI18n } from 'react-i18next';

function targetCapabilities(target: ExecutionTarget): Record<string, unknown> {
  if (typeof target.capabilities === 'string') {
    try {
      const parsed: unknown = JSON.parse(target.capabilities);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return target.capabilities ?? {};
}

export function isPairedEdgeTarget(target: ExecutionTarget): boolean {
  const capabilities = targetCapabilities(target);
  return target.target_type === 'cloud_edge' && capabilities.pairedDevice === true && capabilities.runtimeId === 'openai-sdk';
}

export function isSupportedWebTarget(target: ExecutionTarget): boolean {
  return target.target_type === 'local_edge' || isPairedEdgeTarget(target);
}

export function validatePairedEdgeIntent(target: ExecutionTarget, intent: ComposerIntent): void {
  if (!isPairedEdgeTarget(target)) return;
  const mention = intent.mentions.find((item) => item.dispatchRole !== 'context');
  if (mention?.runtimeId?.trim() !== 'openai-sdk') {
    throw new Error(getI18n().t('edgePairing.runtimeMismatch', { ns: 'common' }));
  }
  if (!mention.model?.trim()) {
    throw new Error(getI18n().t('edgePairing.modelRequired', { ns: 'common' }));
  }
  if (intent.attachments.length > 0) {
    throw new Error(getI18n().t('edgePairing.textAttachmentsUnsupported', { ns: 'common' }));
  }
}

export function buildPairedEdgeModelParams(intent: ComposerIntent): Record<string, string> {
  // Paired SDK dispatch accepts a deliberately narrow execution contract, not
  // composer metadata, provider credentials or browser workspace overrides.
  const mention = intent.mentions.find((item) => item.dispatchRole !== 'context');
  return { runtime_id: 'openai-sdk', model: mention?.model?.trim() ?? '' };
}

export function isDispatchableWebTarget(target: ExecutionTarget): boolean {
  return (
    isSupportedWebTarget(target) &&
    target.is_online === true &&
    (target.health_state === 'online' || target.health_state === 'healthy')
  );
}

export function targetDispatchBlockerLabel(target: ExecutionTarget): string {
  if (!isSupportedWebTarget(target)) return `target type ${target.target_type}`;
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
