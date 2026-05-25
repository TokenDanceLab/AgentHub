let memoryRefreshToken: string | null = null;
let memoryAccessToken: string | null = null;

function readSessionStorage(key: string): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, token: string | null) {
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

const ACCESS_TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_TOKEN_KEY = 'agenthub_hub_refresh_token';

export async function loadStoredHubRefreshToken(): Promise<string | null> {
  clearLegacyLocalStorage(REFRESH_TOKEN_KEY);
  return readSessionStorage(REFRESH_TOKEN_KEY) || memoryRefreshToken;
}

export async function saveStoredHubRefreshToken(token: string | null): Promise<void> {
  memoryRefreshToken = token;
  clearLegacyLocalStorage(REFRESH_TOKEN_KEY);
  writeSessionStorage(REFRESH_TOKEN_KEY, token);
}

export async function clearStoredHubRefreshToken(): Promise<void> {
  await saveStoredHubRefreshToken(null);
}

export async function loadStoredHubAccessToken(): Promise<string | null> {
  clearLegacyLocalStorage(ACCESS_TOKEN_KEY);
  return readSessionStorage(ACCESS_TOKEN_KEY) || memoryAccessToken;
}

export async function saveStoredHubAccessToken(token: string | null): Promise<void> {
  memoryAccessToken = token;
  clearLegacyLocalStorage(ACCESS_TOKEN_KEY);
  writeSessionStorage(ACCESS_TOKEN_KEY, token);
}

export async function clearStoredHubAccessToken(): Promise<void> {
  await saveStoredHubAccessToken(null);
}
