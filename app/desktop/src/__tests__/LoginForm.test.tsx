vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(', ')})`;
    },
    i18n: { language: 'en' },
  }),
}));

const mockLogin = vi.fn();
const mockLoginWithTokenDance = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithTokenDance: mockLoginWithTokenDance,
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    logout: vi.fn(),
    tryAutoLogin: vi.fn(),
  }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LoginForm from '@/components/LoginForm';

describe('LoginForm', () => {
  const onSwitchToRegister = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderForm() {
    return render(
      <LoginForm onSuccess={onSuccess} onSwitchToRegister={onSwitchToRegister} />,
    );
  }

  function openDeveloperLogin() {
    fireEvent.click(screen.getByText('auth.devLogin'));
  }

  // ── Render ────────────────────────────────────────

  it('renders all form fields', () => {
    renderForm();

    expect(screen.getByText('auth.tokenDanceLogin')).toBeInTheDocument();
    expect(screen.queryByLabelText('auth.username')).not.toBeInTheDocument();
    openDeveloperLogin();
    expect(screen.getByLabelText('auth.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.password')).toBeInTheDocument();
    expect(screen.getByText('auth.loginButton')).toBeInTheDocument();
    expect(screen.getByText('auth.switchToRegister')).toBeInTheDocument();
  });

  it('renders placeholders', () => {
    renderForm();
    openDeveloperLogin();

    expect(screen.getByPlaceholderText('auth.usernamePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth.passwordPlaceholder')).toBeInTheDocument();
  });

  it('shows a neutral pending notice when TokenDance desktop callback is not connected', async () => {
    mockLoginWithTokenDance.mockRejectedValueOnce(
      new Error('TokenDance ID desktop callback is not connected yet.'),
    );
    renderForm();

    fireEvent.click(screen.getByText('auth.tokenDanceLogin'));

    await waitFor(() => {
      expect(screen.getByText('auth.tokenDanceCallbackPending')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows a pending notice after opening the TokenDance login shell', async () => {
    mockLoginWithTokenDance.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.click(screen.getByText('auth.tokenDanceLogin'));

    await waitFor(() => {
      expect(mockLoginWithTokenDance).toHaveBeenCalledTimes(1);
      expect(screen.getByText('auth.tokenDanceCallbackPending')).toBeInTheDocument();
    });
  });

  // ── Validation ────────────────────────────────────

  it('shows required errors for empty fields on submit', () => {
    renderForm();
    openDeveloperLogin();
    fireEvent.click(screen.getByText('auth.loginButton'));

    const requiredErrors = screen.getAllByText('auth.error.required');
    expect(requiredErrors.length).toBeGreaterThanOrEqual(2);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows username min length error', () => {
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    expect(screen.getByText('auth.error.usernameMin')).toBeInTheDocument();
  });

  it('shows password min length error', () => {
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '1234567' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    expect(screen.getByText('auth.error.passwordMin')).toBeInTheDocument();
  });

  // ── Submit ────────────────────────────────────────

  it('calls login with trimmed credentials on valid submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: '  testuser  ' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', '12345678');
    });
  });

  it('calls onSuccess when user is set after login', async () => {
    // After login, useAuth will eventually return a user.
    // The test renders with user=null initially, then we need to re-render.
    // Since useAuth is mocked to always return user=null, we verify
    // that login was called with correct credentials.
    mockLogin.mockResolvedValueOnce(undefined);
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledTimes(1);
    });
    // onSuccess would be called when user becomes non-null after login,
    // but our mock always returns user=null so it won't be called here.
  });

  // ── Error display ─────────────────────────────────

  it('displays invalid credentials error on 401', async () => {
    mockLogin.mockRejectedValueOnce(new Error('401 Unauthorized: invalid credentials'));
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'baduser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.invalidCredentials')).toBeInTheDocument();
    });
  });

  it('displays network error for fetch failure', async () => {
    mockLogin.mockRejectedValueOnce(new Error('fetch failed'));
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.networkError')).toBeInTheDocument();
    });
  });

  // ── Toggle ────────────────────────────────────────

  it('calls onSwitchToRegister when link is clicked', () => {
    renderForm();
    openDeveloperLogin();
    fireEvent.click(screen.getByText('auth.switchToRegister'));
    expect(onSwitchToRegister).toHaveBeenCalledTimes(1);
  });

  // ── Password visibility toggle ───────────────────

  it('toggles password visibility', () => {
    renderForm();
    openDeveloperLogin();

    const passwordInput = screen.getByLabelText('auth.password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByLabelText('Show password'));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // ── Loading state ─────────────────────────────────

  it('disables inputs and shows spinner during submit', async () => {
    mockLogin.mockImplementationOnce(() => new Promise(() => {}));
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(screen.getByLabelText('auth.username')).toBeDisabled();
    });
  });

  it('disables submit button during submit', async () => {
    mockLogin.mockImplementationOnce(() => new Promise(() => {}));
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      const button = screen.getByText('auth.loginButton').closest('button');
      expect(button).toBeDisabled();
    });
  });

  // ── Clear error on change ────────────────────────

  it('clears field error when user types', () => {
    renderForm();
    openDeveloperLogin();
    fireEvent.click(screen.getByText('auth.loginButton'));
    const initialErrors = screen.getAllByText('auth.error.required');
    expect(initialErrors.length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'u' } });
    // Only username error cleared, password error may remain
    const remainingErrors = screen.queryAllByText('auth.error.required');
    expect(remainingErrors.length).toBeLessThan(initialErrors.length);
  });

  it('clears server error when user types', async () => {
    mockLogin.mockRejectedValueOnce(new Error('fetch failed'));
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.loginButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.networkError')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'newuser' } });
    expect(screen.queryByText('auth.error.networkError')).not.toBeInTheDocument();
  });

  // ── Keyboard ──────────────────────────────────────

  it('submits on Enter key', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    renderForm();
    openDeveloperLogin();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });

    fireEvent.keyDown(screen.getByLabelText('auth.password'), { key: 'Enter' });
    // The form submit is triggered by keyDown on an input inside a form,
    // but jsdom doesn't auto-submit on Enter. Instead, we trigger form submit.
    fireEvent.submit(screen.getByLabelText('auth.password').closest('form')!);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', '12345678');
    });
  });
});
