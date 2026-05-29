import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockLoginWithTokenDance = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithTokenDance: mockLoginWithTokenDance,
    token: null,
    user: null,
    refreshToken: null,
    isAuthenticated: false,
    tokenSource: null,
  }),
  getAccessToken: () => null,
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => ({
    me: vi.fn().mockResolvedValue({ id: 'u1', username: 'test', nickname: 'Test' }),
    refresh: vi.fn().mockResolvedValue({ access_token: 't1', refresh_token: 'r1', expires_in: 900 }),
  }),
}));

import AuthPage from '@/components/AuthPage';

function renderAuthPage(onLoginSuccess = vi.fn(), onClose?: () => void) {
  return render(<AuthPage onLoginSuccess={onLoginSuccess} onClose={onClose} />);
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress fetch errors during Hub health check
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no-op'));
  });

  // ── Render ────────────────────────────────────────

  it('renders brand header with logo and tagline', () => {
    renderAuthPage();
    expect(screen.getByText('auth.title')).toBeInTheDocument();
    expect(screen.getByText('auth.tagline')).toBeInTheDocument();
    expect(screen.getByAltText('TokenDance')).toBeInTheDocument();
    expect(screen.queryByText('AH')).not.toBeInTheDocument();
  });

  it('renders the TokenDance ID login button', () => {
    renderAuthPage();
    expect(screen.getByText('auth.tokenDanceLogin')).toBeInTheDocument();
  });

  it('renders the primary auth hint', () => {
    renderAuthPage();
    expect(screen.getByText('auth.tokenDancePrimary')).toBeInTheDocument();
  });

  // ── Close button ──────────────────────────────────

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    renderAuthPage(vi.fn(), onClose);
    // The close button is rendered as an X icon button
    const closeBtn = document.querySelector('button[title="关闭"]');
    expect(closeBtn).toBeInTheDocument();
  });

  it('does not render close button when onClose is not provided', () => {
    renderAuthPage();
    const closeBtn = document.querySelector('button[title="关闭"]');
    expect(closeBtn).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderAuthPage(vi.fn(), onClose);
    const closeBtn = document.querySelector('button[title="关闭"]')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Hub URL input ─────────────────────────────────

  it('renders advanced settings toggle', () => {
    renderAuthPage();
    expect(screen.getByText('高级设置')).toBeInTheDocument();
  });

  it('shows Hub URL input when advanced settings are expanded', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('高级设置'));
    const hubInput = screen.getByLabelText('auth.hubUrl');
    expect(hubInput).toBeInTheDocument();
    expect(hubInput).toHaveValue();
  });

  it('allows editing Hub URL', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('高级设置'));
    const hubInput = screen.getByLabelText('auth.hubUrl') as HTMLInputElement;
    fireEvent.change(hubInput, { target: { value: 'http://hub.example.com:8080' } });
    expect(hubInput.value).toBe('http://hub.example.com:8080');
  });

  // ── Hub connection indicator ──────────────────────

  it('renders Hub connection status indicator', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('高级设置'));
    expect(screen.getByText('auth.hubChecking')).toBeInTheDocument();
  });
});
