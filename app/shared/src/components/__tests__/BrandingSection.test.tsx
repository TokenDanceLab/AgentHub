vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import BrandingSection from '../BrandingSection';

describe('BrandingSection', () => {
  // ── Basic render ──────────────────────────────

  it('renders app name and tagline', () => {
    render(<BrandingSection />);

    expect(screen.getByText('AgentHub')).toBeInTheDocument();
    expect(screen.getByText('branding.tagline')).toBeInTheDocument();
  });

  // ── Props variants ────────────────────────────

  it('renders compact variant without description when compact=true', () => {
    render(<BrandingSection compact />);

    expect(screen.getByText('AgentHub')).toBeInTheDocument();
    expect(screen.queryByText('branding.description')).not.toBeInTheDocument();
  });

  it('renders description in default (expanded) variant', () => {
    render(<BrandingSection />);

    expect(screen.getByText('branding.description')).toBeInTheDocument();
  });

  it('accepts custom title via prop', () => {
    render(<BrandingSection title="MyHub" />);

    expect(screen.getByText('MyHub')).toBeInTheDocument();
    expect(screen.queryByText('AgentHub')).not.toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────

  it('renders heading at the correct level', () => {
    render(<BrandingSection />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('AgentHub');
  });
});
