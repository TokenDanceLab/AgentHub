import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '@/App';

describe('Desktop App v4 root', () => {
  it('renders the shared v4 workbench as the active desktop route', () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Inspector tabs' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Composer modes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浏览器预览' })).not.toBeDisabled();
    expect(screen.getByText('Desktop 已切入 shared v4 workbench。旧 Desktop 主 UI 不再控制 active route。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地 Agent 协作群' })).toBeInTheDocument();
  });
});
