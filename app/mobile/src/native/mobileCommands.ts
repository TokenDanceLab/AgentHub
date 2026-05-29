import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function startMobileOidcLogin(): Promise<void> {
  await invoke("start_oidc_login");
}

export async function readHubAccessToken(): Promise<string | null> {
  return await invoke<string | null>("read_hub_access_token");
}

export async function clearHubAccessToken(): Promise<void> {
  await invoke("clear_hub_access_token");
}

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
