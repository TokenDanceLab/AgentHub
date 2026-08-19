// real_tested=true
import { describe, expect, it } from 'vitest';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';

const STDIN_WARNING =
  'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.';

describe('isRuntimeDiagnosticText', () => {
  it('matches the canonical no-stdin warning', () => {
    expect(isRuntimeDiagnosticText(STDIN_WARNING)).toBe(true);
  });

  it('trims surrounding whitespace and newlines', () => {
    expect(isRuntimeDiagnosticText(`\n  ${STDIN_WARNING}\n  `)).toBe(true);
  });

  it('matches warnings with different timing values', () => {
    expect(
      isRuntimeDiagnosticText(
        'Warning: no stdin data received in 10s, proceeding without it.',
      ),
    ).toBe(true);
  });

  it('matches the warning case-insensitively', () => {
    expect(
      isRuntimeDiagnosticText(
        'warning: NO STDIN DATA RECEIVED in 3s, PROCEEDING WITHOUT IT.',
      ),
    ).toBe(true);
  });

  it('requires the proceeding-without-it phrase', () => {
    expect(
      isRuntimeDiagnosticText('Warning: no stdin data received in 3s, aborting.'),
    ).toBe(false);
  });

  it('rejects unrelated warning text', () => {
    expect(isRuntimeDiagnosticText('Warning: dependency cycle detected')).toBe(false);
    expect(isRuntimeDiagnosticText('stdout: proceeding without it')).toBe(false);
  });

  it('matches warnings whose phrases span multiple lines', () => {
    expect(
      isRuntimeDiagnosticText(
        'Warning: no stdin data received in 3s,\nproceeding without it.',
      ),
    ).toBe(true);
  });

  it('returns false for empty or blank input', () => {
    expect(isRuntimeDiagnosticText('')).toBe(false);
    expect(isRuntimeDiagnosticText('   ')).toBe(false);
    expect(isRuntimeDiagnosticText(undefined)).toBe(false);
  });
});
