import { describe, expect, it } from 'vitest';
import {
  activeComposerApprovalModeLabel,
  approvalModeToPickerValue,
  buildComposerApprovalModeOptions,
  pickerValueToApprovalMode,
} from './composerApprovalMode';

const t = (key: string): string => key;

describe('composerApprovalMode (#1816)', () => {
  it('maps composer ApprovalMode to picker values with Edge vocabulary', () => {
    expect(approvalModeToPickerValue('suggest')).toBe('suggest');
    expect(approvalModeToPickerValue('workspace-write')).toBe('acceptEdits');
    expect(approvalModeToPickerValue('read-only')).toBe('plan');
  });

  it('round-trips picker values back to composer ApprovalMode', () => {
    expect(pickerValueToApprovalMode('acceptEdits')).toBe('workspace-write');
    expect(pickerValueToApprovalMode('plan')).toBe('read-only');
    expect(pickerValueToApprovalMode('suggest')).toBe('suggest');
  });

  it('returns null for unknown picker values so the composer keeps its mode', () => {
    expect(pickerValueToApprovalMode('bypassPermissions')).toBeNull();
    expect(pickerValueToApprovalMode('')).toBeNull();
  });

  it('covers exactly the three composer ApprovalMode values', () => {
    for (const mode of ['suggest', 'workspace-write', 'read-only'] as const) {
      expect(approvalModeToPickerValue(mode)).not.toBe('unmapped');
      expect(pickerValueToApprovalMode(approvalModeToPickerValue(mode))).toBe(mode);
    }
  });

  it('builds the three picker options with localized labels', () => {
    const options = buildComposerApprovalModeOptions(t);
    expect(options).toEqual([
      { value: 'suggest', label: 'composer.approvalMode.suggest' },
      { value: 'acceptEdits', label: 'composer.approvalMode.workspaceWrite' },
      { value: 'plan', label: 'composer.approvalMode.readOnly' },
    ]);
  });

  it('resolves the active mode label', () => {
    expect(activeComposerApprovalModeLabel('suggest', t)).toBe('composer.approvalMode.suggest');
    expect(activeComposerApprovalModeLabel('workspace-write', t)).toBe(
      'composer.approvalMode.workspaceWrite',
    );
    expect(activeComposerApprovalModeLabel('read-only', t)).toBe('composer.approvalMode.readOnly');
  });
});
