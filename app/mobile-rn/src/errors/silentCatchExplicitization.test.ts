import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('silent catch explicitization contracts', () => {
  it('App.tsx session restore catch sets sessionRestoreError state instead of silently swallowing', () => {
    const source = readFileSync(join(srcDir, 'App.tsx'), 'utf8');

    // Must have sessionRestoreError state
    expect(source).toContain('sessionRestoreError');
    expect(source).toContain('setSessionRestoreError');

    // The restore catch must set the error state (not just a comment)
    expect(source).toMatch(/catch\(\(restoreError/);
    expect(source).toContain('setSessionRestoreError(raw');

    // Successful restore must clear the error
    expect(source).toContain('setSessionRestoreError(undefined)');
  });

  it('AccountScreen accepts and renders sessionRestoreError via ErrorNotice', () => {
    const source = readFileSync(join(srcDir, 'screens', 'AccountScreen.tsx'), 'utf8');

    // Must accept the prop
    expect(source).toContain('sessionRestoreError?: string');

    // Must render ErrorNotice when error is present
    expect(source).toContain('sessionRestoreError ?');
    expect(source).toContain('<ErrorNotice');
    expect(source).toContain('t.sessionRestoreFailedTitle');
  });

  it('push registration catch logs warning instead of being fully silent', () => {
    const source = readFileSync(join(srcDir, 'App.tsx'), 'utf8');

    // Push catch should have console.warn
    expect(source).toMatch(/push registration failed/i);
  });

  it('listSessions catch in hubClient logs warning instead of being fully silent', () => {
    const source = readFileSync(join(srcDir, 'api', 'hubClient.ts'), 'utf8');

    // listSessions catch should have console.warn
    expect(source).toMatch(/listSessions failed/i);
  });
});
