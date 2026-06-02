const CUSTOM_INSTRUCTIONS_KEY = 'agenthub-settings.customInstructions';
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 4000;

export function readCustomInstructions(): string {
  try {
    return localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function writeCustomInstructions(value: string): string {
  const normalized = value.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
  try {
    if (normalized) {
      localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, normalized);
    } else {
      localStorage.removeItem(CUSTOM_INSTRUCTIONS_KEY);
    }
  } catch {
    // Settings still update in-memory; persistence can fail in restricted browsers.
  }
  return normalized;
}

export function clearCustomInstructions() {
  try {
    localStorage.removeItem(CUSTOM_INSTRUCTIONS_KEY);
  } catch {
    // localStorage can be unavailable in tests or privacy-restricted contexts.
  }
}

export { CUSTOM_INSTRUCTIONS_KEY, MAX_CUSTOM_INSTRUCTIONS_CHARS };
