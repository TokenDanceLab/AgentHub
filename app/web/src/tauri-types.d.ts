// Type declarations for Tauri modules — used by hubAuth.ts, hubTokenStorage.ts
// These modules are dynamically imported only when running inside Tauri (isTauri() check).
// TypeScript needs these declarations for the static import to compile in the web project.
declare module '@tauri-apps/api/core' {
  export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare module '@tauri-apps/api/event' {
  export function listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

declare module '@tauri-apps/api/window' {
  export function getCurrentWindow(): {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    unmaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
}
