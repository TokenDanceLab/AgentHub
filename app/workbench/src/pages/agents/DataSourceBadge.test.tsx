import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../../__tests__/setup';
import { DataSourceBadge } from './DataSourceBadge';

describe('DataSourceBadge', () => {
  it('renders nothing in real mode', () => {
    const { container } = render(<DataSourceBadge source="real" />);
    expect(container.querySelector('[data-data-source]')).toBeNull();
  });

  it('renders a demo provenance pill in demo mode', () => {
    const { container } = render(<DataSourceBadge source="demo" />);
    const badge = container.querySelector('[data-data-source="demo"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Demo 数据');
    expect(badge?.getAttribute('role')).toBe('status');
  });

  it('renders an unavailable pill in unavailable mode', () => {
    const { container } = render(<DataSourceBadge source="unavailable" />);
    const badge = container.querySelector('[data-data-source="unavailable"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('当前不可用');
  });
});
