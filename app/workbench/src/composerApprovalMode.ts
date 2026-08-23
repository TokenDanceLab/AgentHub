import type { ApprovalMode } from '@shared/composer';
import type { PermissionModeOption } from '@shared/ui';

/**
 * #1816 — composer approval-mode picker mapping.
 *
 * Semantics (documented, matching both platform dispatchers):
 * - 'suggest' (default): no override — the agent applies its own permission
 *   policy. Web sends approval_mode: "suggest"; desktop's edgePermissionMode
 *   returns no permissionMode override.
 * - 'workspace-write': desktop maps to Edge permissionMode 'acceptEdits'.
 * - 'read-only': desktop maps to Edge permissionMode 'plan'.
 *
 * The shared PermissionModePicker uses Edge permission-mode vocabulary for
 * its option values ('acceptEdits' / 'plan') so the option icons stay
 * meaningful; 'suggest' keeps a Settings glyph.
 */
export const COMPOSER_APPROVAL_MODES: ApprovalMode[] = [
  'suggest',
  'workspace-write',
  'read-only',
];

export function approvalModeToPickerValue(mode: ApprovalMode): string {
  if (mode === 'workspace-write') return 'acceptEdits';
  if (mode === 'read-only') return 'plan';
  return 'suggest';
}

export function pickerValueToApprovalMode(value: string): ApprovalMode | null {
  if (value === 'acceptEdits') return 'workspace-write';
  if (value === 'plan') return 'read-only';
  if (value === 'suggest') return 'suggest';
  // Unknown value (e.g. a future Edge mode wired by another consumer) — the
  // composer keeps its current mode instead of silently coercing.
  return null;
}

export function buildComposerApprovalModeOptions(t: (key: string) => string): PermissionModeOption[] {
  return [
    { value: 'suggest', label: t('composer.approvalMode.suggest') },
    { value: 'acceptEdits', label: t('composer.approvalMode.workspaceWrite') },
    { value: 'plan', label: t('composer.approvalMode.readOnly') },
  ];
}

export function activeComposerApprovalModeLabel(
  mode: ApprovalMode,
  t: (key: string) => string,
): string {
  if (mode === 'workspace-write') return t('composer.approvalMode.workspaceWrite');
  if (mode === 'read-only') return t('composer.approvalMode.readOnly');
  return t('composer.approvalMode.suggest');
}
