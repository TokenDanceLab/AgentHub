import { invoke } from '@tauri-apps/api/core';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

let memoryRefreshToken: string | null = null;
let memoryAccessToken: string | null = null;

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined';
}

// ── Hub refresh token (OS credential store) ────────

export async function loadStoredHubRefreshToken(): Promise<string | null> {
  if (!canUseTauriInvoke()) {
    return memoryRefreshToken;
  }

  return invoke<string | null>('read_hub_refresh_token');
}

export async function saveStoredHubRefreshToken(token: string | null): Promise<void> {
  memoryRefreshToken = token;

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
  if (!canUseTauriInvoke()) {
    // Fallback: localStorage for browser dev mode
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('agenthub_hub_token');
    }
    return memoryAccessToken;
  }

  return invoke<string | null>('read_hub_access_token');
}

export async function saveStoredHubAccessToken(token: string | null): Promise<void> {
  memoryAccessToken = token;

  if (!canUseTauriInvoke()) {
    // Fallback: localStorage for browser dev mode
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem('agenthub_hub_token', token);
      } else {
        localStorage.removeItem('agenthub_hub_token');
      }
    }
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
