import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiskBadge } from './RiskBadge';

describe('RiskBadge', () => {
  it('renders label text for low risk', () => {
    const { container } = render(<RiskBadge level="low">Low Risk</RiskBadge>);
    expect(container.textContent).toContain('Low Risk');
  });

  it('renders label text for medium risk', () => {
    const { container } = render(<RiskBadge level="medium">Medium Risk</RiskBadge>);
    expect(container.textContent).toContain('Medium Risk');
  });

  it('renders label text for high risk', () => {
    const { container } = render(<RiskBadge level="high">High Risk</RiskBadge>);
    expect(container.textContent).toContain('High Risk');
  });

  it('renders label text for critical risk', () => {
    const { container } = render(<RiskBadge level="critical">Critical Risk</RiskBadge>);
    expect(container.textContent).toContain('Critical Risk');
  });

  it('applies level class for low', () => {
    const { container } = render(<RiskBadge level="low">Low</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('low');
  });

  it('applies level class for medium', () => {
    const { container } = render(<RiskBadge level="medium">Medium</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('medium');
  });

  it('applies level class for high', () => {
    const { container } = render(<RiskBadge level="high">High</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('high');
  });

  it('applies level class for critical', () => {
    const { container } = render(<RiskBadge level="critical">Critical</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('critical');
  });

  it('accepts custom className', () => {
    const { container } = render(<RiskBadge level="low" className="extra-class">Low</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('extra-class');
  });

  it('has badge base class', () => {
    const { container } = render(<RiskBadge level="low">Low</RiskBadge>);
    expect(container.firstElementChild!.className).toContain('badge');
  });
});
