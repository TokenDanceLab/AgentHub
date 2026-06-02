import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenDanceMark } from './TokenDanceMark';

describe('TokenDanceMark', () => {
  it('renders the TokenDance logo with default alt text', () => {
    const { getByAltText } = render(<TokenDanceMark />);
    expect(getByAltText('TokenDance')).toBeInstanceOf(HTMLImageElement);
  });

  it('supports decorative usage', () => {
    const { container } = render(<TokenDanceMark alt="" aria-hidden="true" className="brand" />);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-hidden')).toBe('true');
    expect(image.className).toContain('brand');
  });
});
