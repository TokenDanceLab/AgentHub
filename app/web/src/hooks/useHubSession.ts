import { useEffect, useMemo, useState } from 'react';

const HUB_TOKEN_KEYS = [
  'agenthub_hub_token',
  'agenthub:web_hub_token',
  'agenthub_web_hub_token',
  'agenthub:hub_token',
];

function readStorageToken(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key)?.trim() || null;
  } catch {
    return null;
  }
}

export function getWebHubToken(): string | null {
  if (typeof window === 'undefined') return null;

  for (const key of HUB_TOKEN_KEYS) {
    const token = readStorageToken(window.sessionStorage, key) ?? readStorageToken(window.localStorage, key);
    if (token) return token;
  }

  return null;
}

export function getHubBaseUrl(): string {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_HUB_URL;
  return (configured || 'http://localhost:8080').replace(/\/+$/, '');
}

export function useHubSession() {
  const [token, setToken] = useState<string | null>(() => getWebHubToken());

  useEffect(() => {
    const refresh = () => setToken(getWebHubToken());
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return useMemo(
    () => ({
      hasSession: Boolean(token),
      token,
      hubBaseUrl: getHubBaseUrl(),
    }),
    [token],
  );
}
