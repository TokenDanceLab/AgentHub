import { beforeAll, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import DeployCard from './DeployCard';

// DeployCard resolves status/action labels via the chatview namespace; opt
// into the zh bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

describe('DeployCard', () => {
  it('renders pending state with label', () => {
    render(<DeployCard status="pending" />);
    expect(screen.getByTestId('deploy-card')).toBeDefined();
    expect(screen.getByText('待部署')).toBeDefined();
  });

  it('renders deployed state', () => {
    render(<DeployCard status="deployed" />);
    expect(screen.getByText('已就绪')).toBeDefined();
  });

  it('renders failed state', () => {
    render(<DeployCard status="failed" />);
    expect(screen.getByText('部署失败')).toBeDefined();
  });

  it('renders building state with spinning icon', () => {
    render(<DeployCard status="building" />);
    expect(screen.getByText('构建中')).toBeDefined();
    expect(screen.getByTestId('deploy-card').querySelector('[class*="spin"]')).toBeDefined();
  });

  it('defaults to pending when status is undefined', () => {
    render(<DeployCard />);
    expect(screen.getByText('待部署')).toBeDefined();
  });

  it('renders status message in title when provided', () => {
    render(<DeployCard status="building" statusMessage="Compiling assets..." />);
    expect(screen.getByText(/Compiling assets/)).toBeDefined();
  });

  it('renders deploy URL with action buttons', () => {
    render(<DeployCard status="deployed" url="https://deploy.example.com" />);
    expect(screen.getByText('https://deploy.example.com')).toBeDefined();
    const link = screen.getByLabelText('打开');
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain('deploy.example.com');
  });

  it('renders preview button when deployed', () => {
    render(<DeployCard status="deployed" url="https://deploy.example.com" />);
    expect(screen.getByLabelText('预览')).toBeDefined();
  });

  it('does not render URL box when no url provided', () => {
    render(<DeployCard status="deployed" />);
    expect(screen.queryByLabelText('打开')).toBeNull();
  });
});
