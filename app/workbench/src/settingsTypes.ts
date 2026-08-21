/**
 * Settings types and serialization helpers for user preferences.
 *
 * Each setting is stored as a key-value pair (both strings) in the backend.
 * Complex values (objects, booleans) are JSON-serialized before sending.
 */

// ── Settings key constants ──────────────────────────────────────────────────

/** Keys that represent boolean values (stored as "true"/"false"). */
export const BOOLEAN_SETTINGS_KEYS = [
  'inspectorVisible',
  'stackedAvatars',
  'taskCompleteNotify',
  'failureNotify',
  'hrmOverlayEnabled',
] as const;

/** Keys that represent string values (stored as-is). */
export const STRING_SETTINGS_KEYS = [
  'theme',
  'density',
  'runStepDefault',
  'animationIntensity',
  'approvalNotifyLevel',
  'projectGroupNotifyLevel',
  'docUpdateNotifyLevel',
  'dndWindow',
  'defaultModel',
  'defaultExecutor',
  'toolCallDisplay',
  'deepThinkingDisplay',
  'visualQaMode',
  'logLevel',
  'designSystemValidation',
] as const;

/** Keys that represent JSON-serialized objects. */
export const JSON_SETTINGS_KEYS = [
  'permissions',
  'stateStrategies',
] as const;

/** All persistable settings keys. */
export const ALL_SETTINGS_KEYS: readonly string[] = [
  ...BOOLEAN_SETTINGS_KEYS,
  ...STRING_SETTINGS_KEYS,
  ...JSON_SETTINGS_KEYS,
] as const;

/** Keys that are local-only (localStorage, not sent to backend). */
export const LOCAL_ONLY_KEYS = [
  'dataMode',
  'composerSubmitBehavior',
  'vitePreviewUrl',
  'workspacePath',
  'targetProjectPath',
] as const;

// ── Serialization helpers ───────────────────────────────────────────────────

/**
 * Serialize a settings snapshot into a flat key-value map for the backend.
 * Booleans become "true"/"false", objects become JSON strings.
 */
export function serializeSettings(
  settings: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ALL_SETTINGS_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      result[key] = value ? 'true' : 'false';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

/**
 * Deserialize a flat key-value map from the backend into a typed settings object.
 * Missing keys fall through — the caller merges with defaults.
 */
export function deserializeSettings(
  raw: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ALL_SETTINGS_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;

    if ((BOOLEAN_SETTINGS_KEYS as readonly string[]).includes(key)) {
      result[key] = value === 'true';
    } else if ((JSON_SETTINGS_KEYS as readonly string[]).includes(key)) {
      try {
        result[key] = JSON.parse(value);
      } catch {
        // keep as string if JSON parse fails
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}
