import { setBaseUrl } from "@agenthub/shared";

// Hub Server — mobile uses Hub, not local Edge
export const HUB_API_URL = "https://hub.vectorcontrol.tech/api/v1";
export const HUB_WS_URL = "wss://hub.vectorcontrol.tech/ws";

// Initialize shared API client to target Hub Server
setBaseUrl(HUB_API_URL);
