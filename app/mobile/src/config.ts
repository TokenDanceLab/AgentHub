import { setBaseUrl } from "@agenthub/shared";

// Hub Server - shared API helpers append /v1 paths.
export const HUB_API_URL = "https://hub.vectorcontrol.tech";
export const HUB_WS_URL = "wss://hub.vectorcontrol.tech/ws";

// Initialize shared API client to target Hub Server
setBaseUrl(HUB_API_URL);
