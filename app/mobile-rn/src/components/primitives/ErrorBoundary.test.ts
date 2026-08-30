import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const primitivesDir = dirname(fileURLToPath(import.meta.url));

function readPrimitive(name: string): string {
  return readFileSync(join(primitivesDir, name), 'utf8');
}

describe('ErrorBoundary i18n contract', () => {
  it('uses localized strings instead of hardcoded English in default fallback', () => {
    const source = readPrimitive('ErrorBoundary.tsx');

    // Must NOT contain hardcoded English error text
    expect(source).not.toContain('"Something went wrong"');
    expect(source).not.toContain("'Something went wrong'");
    expect(source).not.toContain('"An unexpected error occurred');
    expect(source).not.toContain("'An unexpected error occurred");

    // Must use localized strings via DefaultErrorFallback
    expect(source).toContain('DefaultErrorFallback');
    expect(source).toContain('useStrings');
    expect(source).toContain('t.errorBoundaryTitle');
    expect(source).toContain('t.errorBoundaryDescription');
  });

  it('exports DefaultErrorFallback as a function component for hook usage', () => {
    const source = readPrimitive('ErrorBoundary.tsx');

    expect(source).toContain('export function DefaultErrorFallback');
  });
});

describe('App.tsx ErrorBoundary fallback i18n contract', () => {
  it('uses localized strings in top-level ErrorBoundary fallback', () => {
    const appSource = readFileSync(
      join(primitivesDir, '..', '..', 'App.tsx'),
      'utf8',
    );

    // Must NOT contain hardcoded English error text in ErrorBoundary fallback
    expect(appSource).not.toContain('title="Something went wrong"');
    expect(appSource).not.toContain("description=\"An unexpected error occurred while rendering this section.\"");

    // Must reference localized string keys
    expect(appSource).toContain('t.errorBoundaryTitle');
    expect(appSource).toContain('t.errorBoundaryDescription');
  });
});
