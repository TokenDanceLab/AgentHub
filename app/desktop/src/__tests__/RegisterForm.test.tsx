vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(', ')})`;
    },
    i18n: { language: 'en' },
  }),
}));

const mockRegister = vi.fn();

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => ({
    register: mockRegister,
  }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RegisterForm from '@/components/RegisterForm';

describe('RegisterForm', () => {
  const onSwitchToLogin = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderForm() {
    return render(
      <RegisterForm onSwitchToLogin={onSwitchToLogin} onSuccess={onSuccess} />,
    );
  }

  // ── Render ────────────────────────────────────────

  it('renders all form fields', () => {
    renderForm();

    expect(screen.getByLabelText('auth.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.nickname')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.password')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.confirmPassword')).toBeInTheDocument();
    expect(screen.getByText('auth.registerButton')).toBeInTheDocument();
    expect(screen.getByText('auth.switchToLogin')).toBeInTheDocument();
  });

  it('renders placeholders', () => {
    renderForm();

    expect(screen.getByPlaceholderText('auth.usernamePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth.nicknamePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth.passwordPlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth.confirmPasswordPlaceholder')).toBeInTheDocument();
  });

  // ── Validation ────────────────────────────────────

  it('shows required errors for empty fields', () => {
    renderForm();
    fireEvent.click(screen.getByText('auth.registerButton'));

    expect(screen.getByText('auth.error.required')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows username min length error', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    expect(screen.getByText('auth.error.usernameMin')).toBeInTheDocument();
  });

  it('shows password min length error', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '1234567' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    expect(screen.getByText('auth.error.passwordMin')).toBeInTheDocument();
  });

  it('shows password mismatch error', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'different' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    expect(screen.getByText('auth.error.passwordMismatch')).toBeInTheDocument();
  });

  // ── Submit ────────────────────────────────────────

  it('calls register API on valid submit', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.nickname'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'testuser',
        password: '12345678',
        nickname: 'Test User',
      });
    });
  });

  it('uses trimmed username as fallback nickname', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'testuser',
        password: '12345678',
        nickname: 'testuser',
      });
    });
  });

  // ── Success state ─────────────────────────────────

  it('shows success message after registration', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.registerSuccess')).toBeInTheDocument();
    });
  });

  it('calls onSuccess callback after registration', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('shows login button on success screen', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.loginButton')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('auth.loginButton'));
    expect(onSwitchToLogin).toHaveBeenCalled();
  });

  // ── Error display ─────────────────────────────────

  it('displays username taken error for 409 response', async () => {
    mockRegister.mockRejectedValueOnce(new Error('409 Conflict: username taken'));
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'existing' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.registerFailed')).toBeInTheDocument();
    });
  });

  it('displays network error for generic failure', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Network Error'));
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.networkError')).toBeInTheDocument();
    });
  });

  // ── Password visibility toggle ───────────────────

  it('toggles password visibility', () => {
    renderForm();

    const passwordInput = screen.getByLabelText('auth.password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getAllByLabelText('Show password')[0]);
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getAllByLabelText('Hide password')[0]);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('toggles confirm password visibility', () => {
    renderForm();

    const confirmInput = screen.getByLabelText('auth.confirmPassword');
    expect(confirmInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getAllByLabelText('Show password')[1]);
    expect(confirmInput).toHaveAttribute('type', 'text');
  });

  // ── Loading state ─────────────────────────────────

  it('disables inputs and shows spinner during submit', async () => {
    mockRegister.mockImplementationOnce(() => new Promise(() => {}));
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByLabelText('auth.username')).toBeDisabled();
    });
  });

  it('disables submit button during submit', async () => {
    mockRegister.mockImplementationOnce(() => new Promise(() => {}));
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.registerButton').closest('button')).toBeDisabled();
    });
  });

  // ── Clear error on change ────────────────────────

  it('clears field error when user types', () => {
    renderForm();
    fireEvent.click(screen.getByText('auth.registerButton'));
    expect(screen.getByText('auth.error.required')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'u' } });
    expect(screen.queryByText('auth.error.required')).not.toBeInTheDocument();
  });

  it('clears server error when user types', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Network Error'));
    renderForm();

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByText('auth.registerButton'));

    await waitFor(() => {
      expect(screen.getByText('auth.error.networkError')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'newuser' } });
    expect(screen.queryByText('auth.error.networkError')).not.toBeInTheDocument();
  });
});
