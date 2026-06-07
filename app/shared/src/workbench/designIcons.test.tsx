import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DesignFileIcon,
  DesignNavIcon,
  getDesignFileIconColor,
  getDesignFileIconType,
} from './designIcons';

describe('design icon registry', () => {
  it('normalizes file icons through the design source rules', () => {
    expect(getDesignFileIconType(undefined, '.gitignore')).toBe('git');
    expect(getDesignFileIconType(undefined, 'src/workbench/RightInspector.tsx')).toBe('tsx');
    expect(getDesignFileIconType('markdown', 'README')).toBe('markdown');
    expect(getDesignFileIconType('unknown-kind', 'README.unknown')).toBe('file');
  });

  it('keeps file icon colors aligned to agenthub-design/desktop', () => {
    expect(getDesignFileIconColor('md')).toBe('var(--text-2)');
    expect(getDesignFileIconColor('css')).toBe('#1572b6');
    expect(getDesignFileIconColor('html')).toBe('#e34f26');
    expect(getDesignFileIconColor('js')).toBe('#f7df1e');
    expect(getDesignFileIconColor('ts')).toBe('#3178c6');
    expect(getDesignFileIconColor('sql')).toBe('var(--info, var(--state-running))');
    expect(getDesignFileIconColor('git')).toBe('#f05032');
    expect(getDesignFileIconColor('xlsx')).toBe('#217346');
  });

  it('lets CSS own file icon SVG sizing like the design demo', () => {
    const markup = renderToStaticMarkup(
      <DesignFileIcon className="file-icon" name="hooks/useThreadNavigation.ts" />,
    );

    expect(markup).toContain('data-design-file-icon="ts"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).not.toContain('width="17"');
    expect(markup).not.toContain('height="17"');
  });

  it('renders nav icons from the same local registry', () => {
    const markup = renderToStaticMarkup(<DesignNavIcon name="browser" />);

    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.9"');
  });
});
