// Browser-only, memory-only session proof. No bearer or refresh credential.
let csrfToken: string | null = null;
let generation = 0;
const invalidationListeners = new Set<() => void>();
const sessionListeners = new Set<() => void>();

export const getBrowserCsrfToken = () => csrfToken;
export const getBrowserSessionGeneration = () => generation;
export function setBrowserCsrfToken(value: string | null): void {
  if (value !== csrfToken || value === null) generation++;
  csrfToken = value;
  sessionListeners.forEach((listener) => listener());
}
export function invalidateBrowserSession(): void {
  setBrowserCsrfToken(null);
  invalidationListeners.forEach((listener) => listener());
}
export function onBrowserSessionInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}
export function onBrowserSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
