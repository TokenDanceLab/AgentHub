import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@shared/ui/toast';
import { hubQueryKeys, webQueryKeys } from '@shared/stores/queryKeys';

const tryAutoLoginMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());

// Raw-key visible copy is provided by the key-echo default language of the
// web test i18next instance (Issue #1717) — no react-i18next mock here.

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    tryAutoLogin: tryAutoLoginMock,
  }),
  getAccessToken: getAccessTokenMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const refetchQueries = vi.spyOn(queryClient, 'refetchQueries');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient, refetchQueries };
}

describe('useWebAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useHubStore.getState().clear();
    useToastStore.setState({ toasts: [] });
    tryAutoLoginMock.mockReset();
    getAccessTokenMock.mockReset();
    tryAutoLoginMock.mockResolvedValue(false);
    getAccessTokenMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('marks authReady after auto-login settles and refetches Hub data when authenticated', async () => {
    tryAutoLoginMock.mockResolvedValueOnce(true);
    const { wrapper, refetchQueries } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });

    expect(result.current.authReady).toBe(false);

    await waitFor(() => {
      expect(result.current.authReady).toBe(true);
    });

    expect(tryAutoLoginMock).toHaveBeenCalledTimes(1);
    // Web's session list lives in the app-scoped namespace, so refetching
    // `hubQueryKeys.threads.root` after login matched no cache entry (#2261).
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: webQueryKeys.sessions.root });
    expect(refetchQueries).not.toHaveBeenCalledWith({ queryKey: hubQueryKeys.threads.root });
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: hubQueryKeys.agents.root });
  });

  it('still marks authReady when auto-login rejects (network/auth surface handles errors)', async () => {
    tryAutoLoginMock.mockRejectedValueOnce(new Error('network down'));
    const { wrapper, refetchQueries } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.authReady).toBe(true);
    });

    expect(refetchQueries).not.toHaveBeenCalled();
  });

  it('does not set authReady after unmount when auto-login resolves late', async () => {
    let resolveAutoLogin: ((value: boolean) => void) | undefined;
    tryAutoLoginMock.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolveAutoLogin = resolve;
      }),
    );
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result, unmount } = renderHook(() => useWebAuth(), { wrapper });
    expect(result.current.authReady).toBe(false);
    unmount();

    await act(async () => {
      resolveAutoLogin?.(true);
    });

    // Unmounted hook must not flip authReady; re-render a fresh instance to observe isolation.
    const second = renderHook(() => useWebAuth(), { wrapper });
    expect(second.result.current.authReady).toBe(false);
    await waitFor(() => {
      expect(second.result.current.authReady).toBe(true);
    });
  });

  it('ensureAuth fails closed without Hub session: opens modal + error toast', async () => {
    useHubStore.getState().setAuthenticated(false);
    getAccessTokenMock.mockReturnValue(null);
    tryAutoLoginMock.mockResolvedValueOnce(false);
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    let allowed = true;
    act(() => {
      allowed = result.current.ensureAuth();
    });

    expect(allowed).toBe(false);
    expect(useHubStore.getState().showAuthModal).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'webChat.signInRequired',
      }),
    ]);
  });

  it('ensureAuth fails closed when store says authenticated but token is missing', async () => {
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    getAccessTokenMock.mockReturnValue(null);
    tryAutoLoginMock.mockResolvedValueOnce(true);
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    let allowed = true;
    act(() => {
      allowed = result.current.ensureAuth();
    });

    expect(allowed).toBe(false);
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });

  it('ensureAuth allows the action when Hub session and token are present', async () => {
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    getAccessTokenMock.mockReturnValue('hub-access');
    tryAutoLoginMock.mockResolvedValueOnce(true);
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    let allowed = false;
    act(() => {
      allowed = result.current.ensureAuth();
    });

    expect(allowed).toBe(true);
    expect(useHubStore.getState().showAuthModal).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('useWebAuth OIDC callback errors (#1816)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useHubStore.getState().clear();
    useToastStore.setState({ toasts: [] });
    tryAutoLoginMock.mockReset();
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockReturnValue(null);
  });

  it('surfaces OidcError from the callback path as an error toast and reopens the auth modal', async () => {
    const { OidcError } = await import('@/api/hubAuth');
    tryAutoLoginMock.mockRejectedValueOnce(
      new OidcError('stateMismatch', 'OIDC state mismatch', 'bad state'),
    );
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual(
      expect.objectContaining({ type: 'error' }),
    );
    // Key-echo test i18n: the message carries the OIDC error key (or the
    // default fallback key), never an empty string.
    expect(String(toasts[0]?.message)).toMatch(/auth\.error\.oidc\./);
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });

  it('maps tokenExchangeFailed with detail through the oidc i18n key', async () => {
    const { OidcError } = await import('@/api/hubAuth');
    tryAutoLoginMock.mockRejectedValueOnce(
      new OidcError('tokenExchangeFailed', 'Token exchange failed: boom', 'boom'),
    );
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(String(toasts[0]?.message)).toMatch(/auth\.error\.oidc\./);
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });

  it('keeps non-OIDC auto-login rejections silent (no toast, no modal)', async () => {
    tryAutoLoginMock.mockRejectedValueOnce(new Error('network down'));
    const { wrapper } = createWrapper();
    const { useWebAuth } = await import('./useWebAuth');

    const { result } = renderHook(() => useWebAuth(), { wrapper });
    await waitFor(() => expect(result.current.authReady).toBe(true));

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useHubStore.getState().showAuthModal).toBe(false);
  });
});
