import { open } from "@tauri-apps/plugin-shell";

export async function openExternalResource(url: string): Promise<void> {
  try {
    await open(url);
    return;
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
