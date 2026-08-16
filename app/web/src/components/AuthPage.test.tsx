import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AuthPage from '@/components/AuthPage';
import LoginForm from '@/components/LoginForm';

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

  it('shows TokenDance errors from the auth hook and falls back for empty rejections', async () => {
    mockLoginWithTokenDance.mockRejectedValueOnce(new Error('Hub login unavailable'));
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Hub login unavailable');
    });

    mockLoginWithTokenDance.mockRejectedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('auth.error.tokenDanceUnavailable');
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    localStorage.clear();
  });

  it('renders the login form and advanced settings toggle', () => {
    render(<AuthPage onLoginSuccess={onLoginSuccess} />);
    expect(screen.getByRole('heading', { name: 'auth.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeInTheDocument();
    expect(screen.getByText('auth.advancedSettings')).toBeInTheDocument();
  });

  it('toggles the advanced settings and persists the Hub URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    render(<AuthPage onLoginSuccess={onLoginSuccess} />);

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
    render(<AuthPage onLoginSuccess={onLoginSuccess} />);

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    await waitFor(() => {
      expect(screen.getByText('auth.hubConnected')).toBeInTheDocument();
    });
  });

  it('reports a disconnected Hub when the health endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('hub down')));
    render(<AuthPage onLoginSuccess={onLoginSuccess} />);

    fireEvent.click(screen.getByText('auth.advancedSettings'));

    await waitFor(() => {
      expect(screen.getByText('auth.hubDisconnected')).toBeInTheDocument();
    });
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = vi.fn();
    render(<AuthPage onLoginSuccess={onLoginSuccess} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
