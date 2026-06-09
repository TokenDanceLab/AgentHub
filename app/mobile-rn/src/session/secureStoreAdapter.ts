import type { HubSessionStorageAdapter } from './sessionState';

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export function createSecureStoreAdapter(
  secureStore: SecureStoreLike,
): HubSessionStorageAdapter {
  return {
    getItemAsync(key) {
      return secureStore.getItemAsync(key);
    },
    setItemAsync(key, value) {
      return secureStore.setItemAsync(key, value);
    },
    deleteItemAsync(key) {
      return secureStore.deleteItemAsync(key);
    },
  };
}

export async function createExpoSecureStoreAdapter(): Promise<HubSessionStorageAdapter> {
  const secureStore = await import('expo-secure-store');
  return createSecureStoreAdapter(secureStore);
}
