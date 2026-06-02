import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BottomNav } from '../components/BottomNav';
import type { MobileView } from '../App';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.primary': 'Primary navigation',
        'nav.activeThreads': 'active threads',
        'nav.pendingReviews': 'pending reviews',
        'surface.mobile.threads.label': 'Threads',
        'surface.mobile.threads.description': 'Thread list',
        'surface.mobile.chat.label': 'Chat',
        'surface.mobile.chat.description': 'Chat view',
        'surface.mobile.runs.label': 'Runs',
        'surface.mobile.runs.description': 'Run list',
        'surface.mobile.account.label': 'Account',
        'surface.mobile.account.description': 'Account settings',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@agenthub/shared', () => ({
  getSurfaceMetadata: (surfaceId: string) => {
    const map: Record<string, { labelKey: string; descriptionKey: string }> = {
      'mobile.threads': { labelKey: 'surface.mobile.threads.label', descriptionKey: 'surface.mobile.threads.description' },
      'mobile.chat': { labelKey: 'surface.mobile.chat.label', descriptionKey: 'surface.mobile.chat.description' },
      'mobile.runs': { labelKey: 'surface.mobile.runs.label', descriptionKey: 'surface.mobile.runs.description' },
      'mobile.account': { labelKey: 'surface.mobile.account.label', descriptionKey: 'surface.mobile.account.description' },
    };
    return map[surfaceId] ?? { labelKey: surfaceId, descriptionKey: `${surfaceId}.desc` };
  },
}));

describe('BottomNav', () => {
  const defaultProps = {
    activeView: 'threads' as MobileView,
    onNavigate: vi.fn(),
  };

  it('renders all four navigation items', () => {
    render(<BottomNav {...defaultProps} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Threads')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('calls onNavigate with correct view when a nav item is clicked', () => {
    const onNavigate = vi.fn();
    render(<BottomNav activeView="threads" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Chat'));
    expect(onNavigate).toHaveBeenCalledWith('chat');
    fireEvent.click(screen.getByText('Runs'));
    expect(onNavigate).toHaveBeenCalledWith('runs');
    fireEvent.click(screen.getByText('Account'));
    expect(onNavigate).toHaveBeenCalledWith('account');
  });

  it('marks the active view with aria-current="page"', () => {
    render(<BottomNav activeView="runs" onNavigate={vi.fn()} />);

    const buttons = screen.getAllByRole('button');

    const chatBtn = buttons.find((b) => b.textContent?.includes('Chat'));
    const runsBtn = buttons.find((b) => b.textContent?.includes('Runs'));

    expect(chatBtn).not.toHaveAttribute('aria-current');
    expect(runsBtn).toHaveAttribute('aria-current', 'page');
  });

  it('shows a badge for active thread count when on threads view', () => {
    render(<BottomNav activeView="threads" onNavigate={vi.fn()} activeThreadCount={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows a badge for pending review count when on runs view', () => {
    render(<BottomNav activeView="runs" onNavigate={vi.fn()} pendingReviewCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show a badge when count is zero', () => {
    render(<BottomNav activeView="threads" onNavigate={vi.fn()} activeThreadCount={0} />);
    // No badge elements should be present
    const badges = document.querySelectorAll('.mobileNavBadge');
    expect(badges.length).toBe(0);
  });
});
