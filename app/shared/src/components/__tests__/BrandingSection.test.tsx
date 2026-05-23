import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import BrandingSection from '../BrandingSection/BrandingSection';

describe('BrandingSection', () => {
  // ── Basic render ──────────────────────────────

  it('renders the title as a heading and the brand mark', () => {
    render(<BrandingSection title="AgentHub" subtitle="Your agent command center" />);

    expect(screen.getByRole('heading', { name: 'AgentHub' })).toBeInTheDocument();
    expect(screen.getByText('Your agent command center')).toBeInTheDocument();
    expect(screen.getByText('AH')).toBeInTheDocument();
  });

  // ── Props variants ────────────────────────────

  it('omits subtitle paragraph when subtitle is not provided', () => {
    render(<BrandingSection title="AgentHub" />);

    expect(screen.getByRole('heading', { name: 'AgentHub' })).toBeInTheDocument();
    // The subtitle <p> should not exist
    const heading = screen.getByRole('heading');
    const container = heading.closest('div')?.parentElement;
    expect(container?.querySelector('p')).toBeNull();
  });

  it('renders custom title text', () => {
    render(<BrandingSection title="My Workspace" />);

    expect(screen.getByRole('heading', { name: 'My Workspace' })).toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────

  it('hides the brand mark from assistive technology', () => {
    render(<BrandingSection title="AgentHub" />);

    const mark = screen.getByText('AH');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses h2 for the title heading', () => {
    render(<BrandingSection title="AgentHub" />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('AgentHub');
  });

  // ── CSS interactions ──────────────────────────

  it('applies custom className when provided', () => {
    const { container } = render(
      <BrandingSection title="AgentHub" className="my-custom-class" />,
    );

    expect(container.firstElementChild).toHaveClass('my-custom-class');
  });

  it('applies custom gradient style when gradient prop is set', () => {
    const { container } = render(
      <BrandingSection title="AgentHub" gradient="linear-gradient(135deg, #667eea, #764ba2)" />,
    );

    const mark = container.querySelector('[aria-hidden="true"]');
    expect(mark).toHaveStyle({ background: 'linear-gradient(135deg, #667eea, #764ba2)' });
  });
});
