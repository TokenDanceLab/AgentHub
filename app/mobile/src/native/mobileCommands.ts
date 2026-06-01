import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// ── OIDC & session commands ────────────────────

export async function startMobileOidcLogin(): Promise<void> {
  await invoke("start_oidc_login");
}

export async function readHubAccessToken(): Promise<string | null> {
  return await invoke<string | null>("read_hub_access_token");
}

export async function clearHubAccessToken(): Promise<void> {
  await invoke("clear_hub_access_token");
}

// ── Notification permission ────────────────────

export async function requestNotificationAccess(): Promise<boolean> {
  if (await isPermissionGranted()) {
    return true;
  }

  const permission = await requestPermission();
  return permission === "granted";
}

export async function sendMobileNotificationProbe(): Promise<boolean> {
  const granted = await requestNotificationAccess();
  if (!granted) {
    return false;
  }

  sendNotification({
    title: "AgentHub Mobile",
    body: "Notifications are enabled for run updates.",
  });
  return true;
}

// ── Run event notifications (called by the background poller) ──

/**
 * Fire a native notification for a completed run.
 * Falls back to the Web Notification API when running outside Tauri (browser dev).
 */
export async function notifyRunCompleted(agentName: string, runId: string): Promise<void> {
  const shortId = runId.slice(0, 8);
  if (isTauri()) {
    try {
      await invoke("notify_run_completed", { agentName, runId });
    } catch {
      // Native invoke failed; deliver via Web Notification fallback below.
    }
  }
  // Web Notification fallback (also works in Tauri WebView as secondary channel)
  if (Notification.permission === "granted") {
    new Notification("Agent Run Completed", {
      body: `${agentName} finished run ${shortId}`,
      tag: `run-${runId}`,
    });
  }
}

/**
 * Fire a native notification for a failed run.
 * Falls back to the Web Notification API when running outside Tauri (browser dev).
 */
export async function notifyRunFailed(agentName: string, error: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("notify_run_failed", { agentName, error });
    } catch {
      // Native invoke failed; deliver via Web Notification fallback below.
    }
  }
  // Web Notification fallback
  if (Notification.permission === "granted") {
    new Notification("Agent Run Failed", {
      body: `${agentName} failed: ${error}`,
    });
  }
}

/**
 * Fire a local notification that a run is waiting for approval.
 * Web Notification API only (no dedicated Tauri command for this yet).
 */
export function notifyApprovalNeeded(runId: string): void {
  const shortId = runId.slice(0, 8);
  if (Notification.permission === "granted") {
    new Notification("Run Needs Your Approval", {
      body: `Run ${shortId} is waiting for your review.`,
      tag: `approval-${runId}`,
    });
  }
}
