function normalizeKey(key: string): string {
  if (key === 'Control') return 'Ctrl';
  if (key === 'Meta') return '⌘';
  if (key === 'Escape') return 'Esc';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function keysFromEvent(e: KeyboardEvent): string[] {
  const result: string[] = [];
  if (e.ctrlKey || e.metaKey) result.push(e.ctrlKey ? 'Ctrl' : '⌘');
  if (e.shiftKey) result.push('Shift');
  if (e.altKey) result.push('Alt');
  const mainKey = normalizeKey(e.key);
  if (!['Control', 'Meta', 'Shift', 'Alt'].includes(e.key) && mainKey) {
    result.push(mainKey);
  }
  return result;
}

export function matchesBinding(e: KeyboardEvent, keys: string[]): boolean {
  if (!keys || keys.length === 0) return false;
  const modifiers = new Set(keys.filter((k) => ['Ctrl', '⌘', 'Shift', 'Alt'].includes(k)));
  const mainKeys = keys.filter((k) => !['Ctrl', '⌘', 'Shift', 'Alt'].includes(k));

  const ctrlExpected = modifiers.has('Ctrl');
  const metaExpected = modifiers.has('⌘');
  if (ctrlExpected !== e.ctrlKey) return false;
  if (metaExpected !== e.metaKey) return false;
  if (modifiers.has('Shift') !== e.shiftKey) return false;
  if (modifiers.has('Alt') !== e.altKey) return false;

  if (mainKeys.length === 0) return false;
  return mainKeys.some((k) => k.toLowerCase() === e.key.toLowerCase());
}
