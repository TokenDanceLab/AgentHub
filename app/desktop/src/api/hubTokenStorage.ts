import { invoke } from '@tauri-apps/api/core';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

let memoryRefreshToken: string | null = null;

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined';
}

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
