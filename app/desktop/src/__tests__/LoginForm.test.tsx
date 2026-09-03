import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LoginForm from '@/components/LoginForm';

const mockLoginWithTokenDance = vi.fn();
let mockUser: { id: string; username: string; nickname: string; avatar_url: string } | null = null;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithTokenDance: mockLoginWithTokenDance,
    user: mockUser,
    token: null,
    refreshToken: null,
    isAuthenticated: !!mockUser,
    logout: vi.fn(),
    tryAutoLogin: vi.fn(),
  }),
}));

describe('LoginForm', () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
  });

  function renderForm() {
    return render(<LoginForm onSuccess={onSuccess} />);
  }

  it('renders the TokenDance ID primary login only', () => {
    renderForm();
    expect(screen.getByText('auth.tokenDanceLogin')).toBeInTheDocument();
    expect(screen.getByText('auth.tokenDanceLogin').closest('button')?.querySelector('img')).toBeInTheDocument();
    expect(screen.getByText('auth.tokenDancePrimary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeInTheDocument();
    expect(screen.queryByText('auth.devLogin')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('auth.username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('auth.password')).not.toBeInTheDocument();
  });

  it('shows a pending notice after opening the TokenDance login shell', async () => {
    mockLoginWithTokenDance.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      expect(mockLoginWithTokenDance).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent('auth.tokenDanceCallbackPending');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the login button while TokenDance login is starting', async () => {
    mockLoginWithTokenDance.mockImplementationOnce(() => new Promise(() => {}));
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeDisabled();
    });
  });

  // #2154 P2-10 (backported from web LoginForm): the banner must carry localized
  // copy, never err.message. The test i18next instance echoes keys / honors
  // defaultValue, so the assertions pin the resolved key instead of the raw
  // transport string.
  it('falls back to the localized generic failure instead of echoing err.message', async () => {
    mockLoginWithTokenDance.mockRejectedValueOnce(new Error('Hub login unavailable'));
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('auth.error.oidc.default');
      expect(alert.textContent).not.toContain('Hub login unavailable');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('resolves known OidcError codes through auth.error.oidc.<code>', async () => {
    const { OidcError } = await import('@/api/hubAuth');
    mockLoginWithTokenDance.mockRejectedValueOnce(
      new OidcError('startFailed', 'Failed to start OIDC login: fetch failed', 'fetch failed'),
    );
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('auth.error.oidc');
      expect(alert.textContent).not.toContain('fetch failed');
      expect(alert.textContent).not.toContain('Failed to start OIDC login');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls onSuccess and renders nothing when a Hub user is already authenticated', () => {
    mockUser = { id: 'u1', username: 'alice', nickname: 'Alice', avatar_url: '' };

    const { container } = renderForm();

    expect(onSuccess).toHaveBeenCalledWith(mockUser);
    expect(container).toBeEmptyDOMElement();
  });
});
