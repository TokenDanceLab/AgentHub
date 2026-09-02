import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AuthPage from '@/components/AuthPage';
import LoginForm from '@/components/LoginForm';
import { ThemeProvider } from '@/contexts/ThemeContext';

// Raw-key visible copy is provided by the key-echo default language of the
// web test i18next instance (Issue #1717) — no react-i18next mock here.

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

  it('renders the TokenDance ID primary login only', () => {
    render(<LoginForm onSuccess={onSuccess} />);
    expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeInTheDocument();
    expect(screen.getByText('auth.tokenDancePrimary')).toBeInTheDocument();
  });

  it('shows a pending notice after opening the TokenDance login shell', async () => {
    mockLoginWithTokenDance.mockResolvedValueOnce(undefined);
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      expect(mockLoginWithTokenDance).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent('auth.tokenDanceCallbackPending');
    });
  });

  // #2154 P2-10: the banner must carry localized copy, never err.message. The
  // web test i18next instance echoes keys / honors defaultValue, so the
  // assertions pin the resolved key instead of the raw transport string.
  it('localizes OidcError codes instead of echoing the transport message', async () => {
    const { OidcError } = await import('@/api/hubAuth');
    mockLoginWithTokenDance.mockRejectedValueOnce(
      new OidcError('startFailed', 'Failed to start OIDC login: fetch failed', 'fetch failed'),
    );
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('auth.error.oidc');
      expect(alert.textContent).not.toContain('fetch failed');
      expect(alert.textContent).not.toContain('Failed to start OIDC login');
    });
  });

  it('falls back to the localized generic failure for non-OIDC and empty rejections', async () => {
    mockLoginWithTokenDance.mockRejectedValueOnce(new Error('Hub login unavailable'));
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('auth.error.oidc.default');
      expect(alert.textContent).not.toContain('Hub login unavailable');
    });

    mockLoginWithTokenDance.mockRejectedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('auth.error.oidc.default');
    });
  });

  it('calls onSuccess and renders nothing when a Hub user is already authenticated', () => {
    mockUser = { id: 'u1', username: 'alice', nickname: 'Alice', avatar_url: '' };

    const { container } = render(<LoginForm onSuccess={onSuccess} />);

    expect(onSuccess).toHaveBeenCalledWith(mockUser);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AuthPage', () => {
  const onLoginSuccess = vi.fn();

  const renderAuthPage = (props: { onClose?: () => void } = {}) =>
    render(
      <ThemeProvider>
        <AuthPage onLoginSuccess={onLoginSuccess} {...props} />
      </ThemeProvider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    localStorage.clear();
  });

  it('renders the login form and advanced settings toggle', () => {
    renderAuthPage();
    expect(screen.getByRole('heading', { name: 'auth.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeInTheDocument();
    expect(screen.getByText('auth.advancedSettings')).toBeInTheDocument();
  });

  it('toggles the advanced settings and persists the Hub URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    renderAuthPage();

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    const input = await screen.findByLabelText('auth.hubUrl');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'http://hub.example:8080' } });
    expect(localStorage.getItem('agenthub_hub_url')).toBe('http://hub.example:8080');
  });

  it('reports the Hub connection status from the health endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    renderAuthPage();

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    await waitFor(() => {
      expect(screen.getByText('auth.hubConnected')).toBeInTheDocument();
    });
  });

  it('reports a disconnected Hub when the health endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('hub down')));
    renderAuthPage();

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    await waitFor(() => {
      expect(screen.getByText('auth.hubDisconnected')).toBeInTheDocument();
    });
  });

  it('switches and resets theme presets from the advanced settings section (#1820)', async () => {
    renderAuthPage();

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    const group = await screen.findByRole('group', { name: 'auth.preset.label' });
    expect(group).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dracula' }));
    expect(localStorage.getItem('agenthub-v4-theme-preset')).toBe('dracula');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('dracula');

    fireEvent.click(screen.getByRole('button', { name: 'auth.preset.default' }));
    expect(localStorage.getItem('agenthub-v4-theme-preset')).toBeNull();
    expect(document.documentElement.getAttribute('data-theme-preset')).toBeNull();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = vi.fn();
    renderAuthPage({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
