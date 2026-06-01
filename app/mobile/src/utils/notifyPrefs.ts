/**
 * Notification preferences — persisted in localStorage so the user can
 * selectively enable/disable run event notifications.
 *
 * Default: all enabled.  The background poller (useRunNotifications) reads
 * these flags before firing any notification.
 */

export type NotifyEventType = "run_completed" | "run_failed" | "approval_needed";

const STORAGE_KEY = "agenthub.mobile.notifyPrefs";

interface NotifyPrefs {
  run_completed: boolean;
  run_failed: boolean;
  approval_needed: boolean;
}

function readPrefs(): NotifyPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
      return {
        run_completed: parsed.run_completed ?? true,
        run_failed: parsed.run_failed ?? true,
        approval_needed: parsed.approval_needed ?? true,
      };
    }
  } catch {
    // Storage blocked or corrupt JSON; fall through to defaults.
  }
  return { run_completed: true, run_failed: true, approval_needed: true };
}

function writePrefs(prefs: NotifyPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable; preferences still apply in-memory for this session.
  }
}

let cachedPrefs: NotifyPrefs | null = null;

function getPrefs(): NotifyPrefs {
  if (!cachedPrefs) {
    cachedPrefs = readPrefs();
  }
  return cachedPrefs;
}

export function isNotifyEnabled(type: NotifyEventType): boolean {
  return getPrefs()[type];
}

export function setNotifyEnabled(type: NotifyEventType, enabled: boolean): void {
  const prefs = { ...getPrefs(), [type]: enabled };
  cachedPrefs = prefs;
  writePrefs(prefs);
}

export function getNotifyPrefs(): NotifyPrefs {
  return { ...getPrefs() };
}
