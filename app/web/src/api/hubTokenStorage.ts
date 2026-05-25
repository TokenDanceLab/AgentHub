let memoryRefreshToken: string | null = null;
let memoryAccessToken: string | null = null;

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, token: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (token) {
      localStorage.setItem(key, token);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* storage disabled */
  }
}

export async function loadStoredHubRefreshToken(): Promise<string | null> {
  return readLocalStorage('agenthub_hub_refresh_token') || memoryRefreshToken;
}

export async function saveStoredHubRefreshToken(token: string | null): Promise<void> {
  memoryRefreshToken = token;
  writeLocalStorage('agenthub_hub_refresh_token', token);
}

export async function clearStoredHubRefreshToken(): Promise<void> {
  await saveStoredHubRefreshToken(null);
}

export async function loadStoredHubAccessToken(): Promise<string | null> {
  return readLocalStorage('agenthub_hub_token') || memoryAccessToken;
}

export async function saveStoredHubAccessToken(token: string | null): Promise<void> {
  memoryAccessToken = token;
  writeLocalStorage('agenthub_hub_token', token);
}

export async function clearStoredHubAccessToken(): Promise<void> {
  await saveStoredHubAccessToken(null);
}
