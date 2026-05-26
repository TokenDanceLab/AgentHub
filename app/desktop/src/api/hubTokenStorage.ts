import { invoke } from '@tauri-apps/api/core';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

let memoryRefreshToken: string | null = null;
let memoryAccessToken: string | null = null;

const ACCESS_TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_TOKEN_KEY = 'agenthub_hub_refresh_token';

function readSessionStorage(key: string): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, token: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (token) {
      sessionStorage.setItem(key, token);
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* storage disabled */
  }
}

function clearLegacyLocalStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    /* storage disabled */
  }
}

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined';
}

// ── Hub refresh token (OS credential store) ────────

export async function loadStoredHubRefreshToken(): Promise<string | null> {
  clearLegacyLocalStorage(REFRESH_TOKEN_KEY);
  if (!canUseTauriInvoke()) {
    return memoryRefreshToken;
  }

  return invoke<string | null>('read_hub_refresh_token');
}

export async function saveStoredHubRefreshToken(token: string | null): Promise<void> {
  memoryRefreshToken = token;
  clearLegacyLocalStorage(REFRESH_TOKEN_KEY);

  if (!canUseTauriInvoke()) {
    return;
  }

  if (token) {
    await invoke('store_hub_refresh_token', { token });
    return;
  }

  await invoke('clear_hub_refresh_token');
}

export async function clearStoredHubRefreshToken(): Promise<void> {
  await saveStoredHubRefreshToken(null);
}

// ── Hub access token (OS credential store) ─────────

export async function loadStoredHubAccessToken(): Promise<string | null> {
  clearLegacyLocalStorage(ACCESS_TOKEN_KEY);
  if (!canUseTauriInvoke()) {
    // Browser dev fallback is tab-scoped to match Web and avoid persistent
    // Hub session material outside the Tauri credential store.
    return readSessionStorage(ACCESS_TOKEN_KEY) || memoryAccessToken;
  }

  return invoke<string | null>('read_hub_access_token');
}

export async function saveStoredHubAccessToken(token: string | null): Promise<void> {
  memoryAccessToken = token;
  clearLegacyLocalStorage(ACCESS_TOKEN_KEY);

  if (!canUseTauriInvoke()) {
    writeSessionStorage(ACCESS_TOKEN_KEY, token);
    return;
  }

  if (token) {
    await invoke('store_hub_access_token', { token });
    return;
  }

  await invoke('clear_hub_access_token');
}

export async function clearStoredHubAccessToken(): Promise<void> {
  await saveStoredHubAccessToken(null);
}
