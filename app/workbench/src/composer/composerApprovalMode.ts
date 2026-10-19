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
 *
 * `APPROVAL_MODE_ROWS` is the single source for the mode → picker-value →
 * label-key mapping, and every function below is a lookup on it, so a mode
 * can no longer be present in one mapping and missing from another.
 */

interface ApprovalModeRow {
  readonly mode: ApprovalMode;
  /** Edge permission-mode vocabulary (see the note above). */
  readonly pickerValue: string;
  readonly labelKey: string;
}

const SUGGEST_ROW: ApprovalModeRow = {
  mode: 'suggest',
  pickerValue: 'suggest',
  labelKey: 'composer.approvalMode.suggest',
};

const APPROVAL_MODE_ROWS: readonly ApprovalModeRow[] = [
  SUGGEST_ROW,
  {
    mode: 'workspace-write',
    pickerValue: 'acceptEdits',
    labelKey: 'composer.approvalMode.workspaceWrite',
  },
  { mode: 'read-only', pickerValue: 'plan', labelKey: 'composer.approvalMode.readOnly' },
];

export function approvalModeToPickerValue(mode: ApprovalMode): string {
  return (APPROVAL_MODE_ROWS.find((row) => row.mode === mode) ?? SUGGEST_ROW).pickerValue;
}

export function pickerValueToApprovalMode(value: string): ApprovalMode | null {
  // Unknown value (e.g. a future Edge mode wired by another consumer) — the
  // composer keeps its current mode instead of silently coercing.
  return APPROVAL_MODE_ROWS.find((row) => row.pickerValue === value)?.mode ?? null;
}

export function buildComposerApprovalModeOptions(t: (key: string) => string): PermissionModeOption[] {
  return APPROVAL_MODE_ROWS.map((row) => ({ value: row.pickerValue, label: t(row.labelKey) }));
}

export function activeComposerApprovalModeLabel(
  mode: ApprovalMode,
  t: (key: string) => string,
): string {
  return t((APPROVAL_MODE_ROWS.find((row) => row.mode === mode) ?? SUGGEST_ROW).labelKey);
}
