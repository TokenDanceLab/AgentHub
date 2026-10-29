import type { HubMessage } from '@/api/hubClient';

/** Keep loaded history and replace refreshed rows by server identity. */
export function mergeMessageHistory(current: HubMessage[], incoming: HubMessage[]): HubMessage[] {
  const ids = new Set(incoming.map((message) => message.id));
  const clientIds = new Set(incoming.map((message) => message.client_msg_id).filter(Boolean));
  return [...current.filter((message) => !ids.has(message.id) && (!message.client_msg_id || !clientIds.has(message.client_msg_id))), ...incoming]
    .sort((a, b) => a.seq_id - b.seq_id);
}

export function oldestMessageSequence(messages: HubMessage[] | undefined): number | undefined {
  const sequences = (messages ?? []).map((message) => message.seq_id).filter((sequence) => sequence > 0 && sequence < Number.MAX_SAFE_INTEGER);
  return sequences.length ? Math.min(...sequences) : undefined;
}
