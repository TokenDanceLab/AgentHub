import { describe, expect, it } from 'vitest';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';

describe('isRuntimeDiagnosticText', () => {
  it('matches runtime and data-mode diagnostics that do not belong in chat bubbles', () => {
    const diagnostics = [
      'Warning: no stdin data received in 3s, proceeding without it.',
      'Data: approved-real',
      'Hub replay: no active Hub session',
      'Hub replay: task task-web-smoke',
      'Hub replay: 0 runtime events observed',
      'Mode: mock',
      'Runtime: mock replay',
      'mock (auto fallback)',
      'demo+edge',
    ];

    for (const diagnostic of diagnostics) {
      expect(isRuntimeDiagnosticText(diagnostic), diagnostic).toBe(true);
    }
  });

  it('does not hide normal agent content that happens to discuss modes or runtimes', () => {
    expect(isRuntimeDiagnosticText('The runtime boundary is documented in the table below.')).toBe(false);
    expect(isRuntimeDiagnosticText('Use mock data only inside the fixture test harness.')).toBe(false);
    expect(isRuntimeDiagnosticText('| Mode | Status |\n| --- | --- |\n| demo | isolated |')).toBe(false);
  });
});
