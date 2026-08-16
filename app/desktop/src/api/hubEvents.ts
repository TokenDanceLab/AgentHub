// Hub WebSocket wire types.
// Canonical event type constants live in @shared/hubEvents (which mirrors
// hub-server/internal/ws/frame.go 1:1 — the SSOT); this module re-exports
// them and adds desktop-specific payload interfaces. The legacy per-constant
// TYPE_* alias layer was removed in #1678 (verified zero consumers).

// ── Re-export canonical constants ────────────────
export { HUB_EVENTS } from '@shared/hubEvents';
export type { HubEventType } from '@shared/hubEvents';

// ── Wire types ───────────────────────────────────

export interface HubFrame<T = unknown> {
  type: string;
  seq_id?: number;
  payload?: T;
}

export interface HubMessage {
  id: string;
  session_id: string;
  seq_id: number;
  sender_type: string;
  sender_id: string;
  content_type: string;
  content: string;
  reply_to_message_id?: string;
  recalled: boolean;
  created_at: string;
}

export interface HubDevicePresence {
  user_id: string;
}

export interface HubAgentTask {
  task_id: string;
  session_id: string;
  agent_instance_id: string;
  status: string;
  content?: string;
  error?: string;
}

export interface HubNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  created_at: string;
}
