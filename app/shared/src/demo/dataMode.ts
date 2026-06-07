export type WorkbenchDataMode = 'auto' | 'demo' | 'real';

export function normalizeWorkbenchDataMode(value: string | undefined): WorkbenchDataMode {
  switch (value?.trim().toLowerCase()) {
    case 'demo':
    case 'mock':
      return 'demo';
    case 'real':
      return 'real';
    default:
      return 'auto';
  }
}
