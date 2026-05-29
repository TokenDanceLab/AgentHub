import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';

const mockLoginWithTokenDance = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    loginWithTokenDance: mockLoginWithTokenDance,
    token: null,
    user: null,
    isAuthenticated: false,
    tokenSource: null,
  }),
  getAccessToken: () => null,
}));

import AuthPage from '@/components/AuthPage';

function renderAuthPage(props: Partial<ComponentProps<typeof AuthPage>> = {}) {
  return render(<AuthPage onLoginSuccess={vi.fn()} {...props} />);
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders brand header and TokenDance login entry', () => {
    renderAuthPage();

    expect(screen.getByText('auth.title')).toBeInTheDocument();
    expect(screen.getByText('auth.tagline')).toBeInTheDocument();
<<<<<<< HEAD
    expect(screen.getByText('AH')).toBeInTheDocument();
=======
    expect(screen.getByAltText('TokenDance')).toBeInTheDocument();
    expect(screen.queryByText('AH')).not.toBeInTheDocument();
  });

  it('renders the TokenDance ID login button', () => {
    renderAuthPage();
    expect(screen.getByText('auth.tokenDanceLogin')).toBeInTheDocument();
  });

  it('renders the primary auth hint', () => {
    renderAuthPage();
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    expect(screen.getByText('auth.tokenDancePrimary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.tokenDanceLogin' })).toBeInTheDocument();
  });

  it('does not render legacy developer login or register controls', () => {
    renderAuthPage();

    expect(screen.queryByText('auth.devLogin')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('auth.username')).not.toBeInTheDocument();
    expect(screen.queryByText('auth.switchToRegister')).not.toBeInTheDocument();
  });

  it('starts TokenDance login from the primary button', async () => {
    mockLoginWithTokenDance.mockResolvedValueOnce(undefined);
    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'auth.tokenDanceLogin' }));

    await waitFor(() => {
      expect(mockLoginWithTokenDance).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent('auth.tokenDanceCallbackPending');
    });
  });

  it('renders Hub URL input with default value in advanced settings', () => {
    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: /auth\.advancedSettings/ }));
    const hubInput = screen.getByLabelText('auth.hubUrl');

    expect(hubInput).toBeInTheDocument();
    expect(hubInput).toHaveValue();
  });

  it('allows editing Hub URL', () => {
    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: /auth\.advancedSettings/ }));
    const hubInput = screen.getByLabelText('auth.hubUrl') as HTMLInputElement;
    fireEvent.change(hubInput, { target: { value: 'http://hub.example.com:8080' } });

    expect(hubInput.value).toBe('http://hub.example.com:8080');
    expect(localStorage.getItem('agenthub_hub_url')).toBe('http://hub.example.com:8080');
  });

  it('renders Hub connection status indicator', () => {
    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: /auth\.advancedSettings/ }));

    expect(screen.getByText('auth.hubChecking')).toBeInTheDocument();
  });

  it('renders close button only when onClose is provided', () => {
    const onClose = vi.fn();
    const { rerender } = renderAuthPage();

    expect(screen.queryByTitle('auth.close')).not.toBeInTheDocument();

    rerender(<AuthPage onLoginSuccess={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('auth.close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
