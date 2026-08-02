import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const primitivesDir = dirname(fileURLToPath(import.meta.url));

function readPrimitive(name: string): string {
  return readFileSync(join(primitivesDir, name), 'utf8');
}

describe('mobile primitive press feedback contract', () => {
  it('centralizes press scale, opacity, and reduced-motion handling', () => {
    const source = readPrimitive('MotionPressable.tsx');

    expect(source).toContain('AccessibilityInfo.isReduceMotionEnabled');
    expect(source).toContain('shouldReduceMotion');
    expect(source).toContain('transform');
    expect(source).toContain('opacity');
  });

  it('routes interactive primitives through MotionPressable with accessibility states', () => {
    const button = readPrimitive('Button.tsx');
    const iconButton = readPrimitive('IconButton.tsx');
    const listRow = readPrimitive('ListRow.tsx');

    expect(button).toContain("from './MotionPressable'");
    expect(button).toContain('busy: loading');
    expect(iconButton).toContain("from './MotionPressable'");
    expect(iconButton).toContain('disabled: isDisabled');
    expect(listRow).toContain("from './MotionPressable'");
    expect(listRow).toContain('disabled: isDisabled');
  });
});
