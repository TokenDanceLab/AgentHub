import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// DeployCard uses useTranslation('chatview') + t('deploy.status.*') /
// t('deploy.action.*'). Without a mock, react-i18next's default t returns
// the raw key, so the Chinese-label assertions below fail. Mock the hook
// with the same zh strings the chatview resources bundle ships.
vi.mock('react-i18next', () => ({
  useTranslation: () => {
    const map: Record<string, string> = {
      'deploy.status.pending': '待部署',
      'deploy.status.ready': '就绪',
      'deploy.status.building': '构建中',
      'deploy.status.deploying': '部署中',
      'deploy.status.deployed': '已就绪',
      'deploy.status.failed': '部署失败',
      'deploy.action.preview': '预览',
      'deploy.action.open': '打开',
      'deploy.action.deployToPublic': '部署到公网',
    };
    return {
      t: (key: string, options?: string | Record<string, unknown>) => {
        const base = map[key];
        if (base === undefined) {
          return typeof options === 'string' ? options : key;
        }
        if (options && typeof options === 'object') {
          return base.replace(
            /\{\{(\w+)\}\}/g,
            (_m: string, name: string) => String(options[name] ?? ''),
          );
        }
        return base;
      },
      i18n: { language: 'zh' },
    };
  },
}));

import DeployCard from './DeployCard';

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
