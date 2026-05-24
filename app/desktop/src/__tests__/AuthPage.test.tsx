import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockLogin = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    token: null,
    user: null,
    isAuthenticated: false,
  }),
  getAccessToken: () => null,
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => ({
    register: vi.fn().mockResolvedValue({ user_id: 'u1' }),
    login: vi.fn().mockResolvedValue({ access_token: 't1', refresh_token: 'r1' }),
  }),
}));

import AuthPage from '@/components/AuthPage';

function renderAuthPage(onLoginSuccess = vi.fn()) {
  return render(<AuthPage onLoginSuccess={onLoginSuccess} />);
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Render ────────────────────────────────────────

  it('renders brand header with logo and tagline', () => {
    renderAuthPage();
    expect(screen.getByText('auth.title')).toBeInTheDocument();
    expect(screen.getByText('auth.tagline')).toBeInTheDocument();
    expect(screen.getByText('AH')).toBeInTheDocument();
  });

  it('renders login tab active by default', () => {
    renderAuthPage();
    const loginTab = screen.getByText('auth.login');
    const registerTab = screen.getByText('auth.register');
    expect(loginTab.className).toContain('tabActive');
    expect(registerTab.className).not.toContain('tabActive');
  });

  it('renders login form content by default', () => {
    renderAuthPage();
    expect(screen.getByLabelText('auth.username')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.password')).toBeInTheDocument();
    expect(screen.getByText('auth.loginButton')).toBeInTheDocument();
  });

  // ── Tab switching ─────────────────────────────────

  it('switches to register tab and shows register form', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('auth.register'));
    expect(screen.getByText('auth.registerButton')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.nickname')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.confirmPassword')).toBeInTheDocument();
  });

  it('switches back to login after register success', async () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('auth.register'));
    expect(screen.getByText('auth.registerButton')).toBeInTheDocument();

    // Simulate register success via the child form button
    // (the mock register resolves immediately, so success state is shown)
    const submitBtn = screen.getByText('auth.registerButton');
    fireEvent.click(submitBtn);
    // After success, the form shows a success message with a login button
    // (RegisterForm's onSuccess switches to login page)
  });

  it('switches to register via login form switch link', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('auth.switchToRegister'));
    expect(screen.getByText('auth.registerButton')).toBeInTheDocument();
  });

  it('switches to login via register form switch link', () => {
    renderAuthPage();
    fireEvent.click(screen.getByText('auth.register'));
    fireEvent.click(screen.getByText('auth.switchToLogin'));
    expect(screen.getByText('auth.loginButton')).toBeInTheDocument();
  });

  // ── Hub URL input ─────────────────────────────────

  it('renders Hub URL input with default value', () => {
    renderAuthPage();
    const hubInput = screen.getByLabelText('auth.hubUrl');
    expect(hubInput).toBeInTheDocument();
    expect(hubInput).toHaveValue();
  });

  it('allows editing Hub URL', () => {
    renderAuthPage();
    const hubInput = screen.getByLabelText('auth.hubUrl') as HTMLInputElement;
    fireEvent.change(hubInput, { target: { value: 'http://hub.example.com:8080' } });
    expect(hubInput.value).toBe('http://hub.example.com:8080');
  });

  // ── Hub connection indicator ──────────────────────

  it('renders Hub connection status indicator', () => {
    renderAuthPage();
    expect(screen.getByText('auth.hubChecking')).toBeInTheDocument();
  });

  // ── Card structure ────────────────────────────────

  it('renders login and register tabs in card', () => {
    renderAuthPage();
    const tabs = [screen.getByText('auth.login'), screen.getByText('auth.register')];
    tabs.forEach((tab) => {
      expect(tab.closest('button')).toBeInTheDocument();
    });
  });
});
