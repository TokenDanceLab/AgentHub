import { invoke, isTauri } from "@tauri-apps/api/core";

interface NativeHubResponse {
  status: number;
  body: string;
}

export function isTauriRuntime(): boolean {
  return isTauri();
}

export async function requestHubViaNative(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (init?.body && typeof init.body !== "string") {
    throw new Error("Native Hub transport only supports string request bodies.");
  }

  const response = await invoke<NativeHubResponse>("hub_request", {
    request: {
      method: init?.method ?? "GET",
      url,
      body: init?.body,
    },
  });

  return new Response(response.body || null, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
