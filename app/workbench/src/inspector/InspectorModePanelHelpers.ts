import type { TFunction } from 'i18next';
import type { EvidenceRef, ContextUsageTranscriptBlock } from '@shared/transcript';
import type { PreviewFile } from './FilePreviewRouter';
import type { TaskItem } from './OverviewPanel';

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   InspectorModePanelHelpers \u2014 pure residual slices from
   InspectorModePanels (#731).

   Evidence overview mappers, file-type detection, openability checks,
   context-usage view models, and deploy-status labels. No React hooks /
   no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.

   i18n note (#2023): display labels resolve through the sharedWorkbench
   bundle via a passed-in translator.
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

export type DeployStatus = 'pending' | 'building' | 'deploying' | 'deployed' | 'failed';

/** Translator for the sharedWorkbench bundle (component `t`, #2023). */
export type InspectorTranslator = TFunction<'sharedWorkbench'>;

export function deployStatusLabel(t: InspectorTranslator, status: DeployStatus | string): string {
  switch (status) {
    case 'pending':
      return t('inspector.deployStatus.pending');
    case 'building':
      return t('inspector.deployStatus.building');
    case 'deploying':
      return t('inspector.deployStatus.deploying');
    case 'deployed':
      return t('inspector.deployStatus.deployed');
    case 'failed':
      return t('inspector.deployStatus.failed');
    default:
      return status;
  }
}

export function evidenceOverviewTasks(t: InspectorTranslator, evidence: EvidenceRef[]): TaskItem[] {
  const tasks: TaskItem[] = [];
  const artifactCount = evidence.filter((ref) => ref.kind === 'artifact').length;
  const fileCount = evidence.filter((ref) => ref.kind === 'file').length;
  const toolCount = evidence.filter((ref) => ref.kind === 'tool').length;
  const runRef = evidence.find((ref) => ref.kind === 'run');

  if (runRef) {
    tasks.push({ label: runRef.label || t('inspector.evidenceRun', { id: runRef.id }), status: runRef.status === 'completed' ? 'done' : 'active' });
  }
  if (artifactCount > 0) {
    tasks.push({ label: t('inspector.evidenceArtifacts', { count: artifactCount }), status: 'done' });
  }
  if (fileCount > 0) {
    tasks.push({ label: t('inspector.evidenceChangedFiles', { count: fileCount }), status: 'done' });
  }
  if (toolCount > 0) {
    tasks.push({ label: t('inspector.evidenceToolCalls', { count: toolCount }), status: 'done' });
  }
  return tasks.length > 0
    ? tasks
    : [{ label: t('inspector.waitingEvidence'), status: 'todo' }];
}

export function evidenceOverviewFiles(t: InspectorTranslator, evidence: EvidenceRef[]): PreviewFile[] {
  const files: PreviewFile[] = [];

  for (const ref of evidence) {
    if (ref.kind === 'file') {
      files.push({
        name: ref.label || ref.id,
        type: fileTypeFromName(ref.label || ref.id),
        isPrimary: true,
        owner: 'transcript',
        content: `# ${ref.label || ref.id}\n\n${ref.uri || t('inspector.noFileContentShort')}`,
      });
    } else if (ref.kind === 'artifact') {
      files.push({
        name: ref.label || ref.id,
        type: fileTypeFromName(ref.label || ref.id),
        isPrimary: false,
        owner: 'transcript',
        content: `# ${ref.label || ref.id}\n\n${t('inspector.artifactFromEvidence')}`,
      });
    }
  }

  return files;
}

export function fileTypeFromName(name: string): string {
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'ts';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.gif')) return 'image';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  return 'txt';
}

export function canOpenEvidence(
  evidence: EvidenceRef,
  onOpenPreview: ((evidence: EvidenceRef) => Promise<void>) | undefined,
  canOpenPreview: ((evidence: EvidenceRef) => boolean) | undefined,
): boolean {
  return Boolean(onOpenPreview) && (canOpenPreview?.(evidence) ?? true);
}

export function resolveLatestContextUsage(
  blocks: ContextUsageTranscriptBlock[],
): ContextUsageTranscriptBlock | null {
  const latest = blocks[blocks.length - 1];
  if (!latest || (!latest.inputTokens && !latest.outputTokens)) {
    return null;
  }
  return latest;
}

export function resolveContextUsagePercent(
  latest: ContextUsageTranscriptBlock,
): number | null {
  const totalTokens = latest.inputTokens + latest.outputTokens;
  return latest.usagePercent ?? (
    latest.contextLimit && latest.contextLimit > 0
      ? Math.round((totalTokens / latest.contextLimit) * 100)
      : null
  );
}

export function isContextUsageWarning(usagePercent: number | null): boolean {
  return usagePercent != null && usagePercent >= 70 && usagePercent < 90;
}

export function isContextUsageDanger(usagePercent: number | null): boolean {
  return usagePercent != null && usagePercent >= 90;
}

export function contextBarVariantClass(
  usagePercent: number | null,
  styles: Record<string, string>,
): string {
  if (isContextUsageDanger(usagePercent)) return styles.contextBarDanger ?? '';
  if (isContextUsageWarning(usagePercent)) return styles.contextBarWarning ?? '';
  return '';
}

export function contextBarFillWidth(usagePercent: number): string {
  return `${Math.min(usagePercent, 100)}%`;
}

export function isDeployReady(status: DeployStatus): boolean {
  return status === 'deployed';
}

export function isDeployFailed(status: DeployStatus): boolean {
  return status === 'failed';
}

export function isDeployInProgress(status: DeployStatus): boolean {
  return status === 'building' || status === 'deploying';
}

export function deployDotColor(status: DeployStatus): string {
  if (isDeployReady(status)) return 'var(--td-moss)';
  if (isDeployFailed(status)) return 'var(--td-danger)';
  return 'var(--td-plum)';
}

export function formatDeployUrlDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
