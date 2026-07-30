/**
 * Typing presence tracker — ephemeral session-scoped typing indicator state.
 *
 * Manages per-session typing events from inbound Hub WS `typing` frames
 * with an auto-dismiss timer (3s). No zustand dependency — uses a plain
 * observer pattern so it works from any module.
 */

const TYPING_TIMEOUT_MS = 3_000;

interface TypingEntry {
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Map<string, TypingEntry>>();

type Listener = (sessionId: string, userIds: string[]) => void;
const listeners = new Set<Listener>();

function notify(sessionId: string): void {
  const userIds = Array.from(sessions.get(sessionId)?.keys() ?? []);
  for (const fn of listeners) {
    try { fn(sessionId, userIds); } catch { /* ignore */ }
  }
}

export function handleIncomingTyping(sessionId: string, userId: string): void {
  let session = sessions.get(sessionId);
  if (!session) {
    session = new Map();
    sessions.set(sessionId, session);
  }
  const existing = session.get(userId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    session!.delete(userId);
    if (session!.size === 0) sessions.delete(sessionId);
    notify(sessionId);
  }, TYPING_TIMEOUT_MS);
  session.set(userId, { timer });
  notify(sessionId);
}

export function clearTyping(sessionId: string, userId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const entry = session.get(userId);
  if (entry) {
    clearTimeout(entry.timer);
    session.delete(userId);
    if (session.size === 0) sessions.delete(sessionId);
    notify(sessionId);
  }
}

export function subscribe(listener: (sessionId: string, userIds: string[]) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getTypingUserIds(sessionId: string): string[] {
  return Array.from(sessions.get(sessionId)?.keys() ?? []);
}

import { useCallback, useEffect, useRef, useState } from "react";

export function useTypingPresence(sessionId?: string): string[] {
  const [userIds, setUserIds] = useState<string[]>(() =>
    sessionId ? getTypingUserIds(sessionId) : [],
  );
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const handleChange = useCallback(
    (changedSessionId: string, userIdsInSession: string[]) => {
      if (changedSessionId !== sessionIdRef.current) return;
      setUserIds(userIdsInSession);
    },
    [],
  );
  useEffect(() => {
    const unsub = subscribe(handleChange);
    if (sessionId) setUserIds(getTypingUserIds(sessionId));
    return unsub;
  }, [handleChange, sessionId]);
  return userIds;
}
