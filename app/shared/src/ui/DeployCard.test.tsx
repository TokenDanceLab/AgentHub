import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DeployCard from './DeployCard';

describe('DeployCard', () => {
  it('renders pending state with Rocket icon', () => {
    render(<DeployCard status="pending" />);
    expect(screen.getByText('Deploy')).toBeDefined();
    expect(screen.getByText('pending')).toBeDefined();
  });

  it('renders deployed state', () => {
    render(<DeployCard status="deployed" />);
    expect(screen.getByText('deployed')).toBeDefined();
  });

  it('renders failed state', () => {
    render(<DeployCard status="failed" />);
    expect(screen.getByText('failed')).toBeDefined();
  });

  it('renders building state with spinning icon', () => {
    render(<DeployCard status="building" />);
    expect(screen.getByText('building')).toBeDefined();
    expect(screen.getByTestId('deploy-card').querySelector('[class*="spin"]')).toBeDefined();
  });

  it('defaults to pending when status is undefined', () => {
    render(<DeployCard />);
    expect(screen.getByText('pending')).toBeDefined();
  });

  it('renders status message when provided', () => {
    render(<DeployCard status="building" statusMessage="Compiling assets..." />);
    expect(screen.getByText('Compiling assets...')).toBeDefined();
  });

  it('renders deploy URL link', () => {
    render(<DeployCard status="deployed" url="https://deploy.example.com" />);
    const link = screen.getByLabelText('Open deployment');
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain('deploy.example.com');
  });

  it('renders deploy ID in footer', () => {
    render(<DeployCard deployId="dep-abc123" status="deployed" />);
    expect(screen.getByText('dep-abc123')).toBeDefined();
  });
});
