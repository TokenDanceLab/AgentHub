import { isTauriRuntime, requestHubViaNative } from "./hubTransport";

const HUB_HEALTH_URL = import.meta.env.VITE_HUB_HEALTH_URL || '/health';

export interface MobileHubHealth {
  status: string;
  version?: string;
  uptime?: string;
  checks?: Record<string, unknown>;
}

export async function getMobileHubHealth(): Promise<MobileHubHealth> {
  const transport = isTauriRuntime()
    ? requestHubViaNative
    : (input: string, init?: RequestInit) => fetch(input, init);

  const response = await transport(HUB_HEALTH_URL, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Hub health returned ${response.status}`);
  }

  return response.json() as Promise<MobileHubHealth>;
}
