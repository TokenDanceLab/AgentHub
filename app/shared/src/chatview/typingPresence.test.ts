import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleIncomingTyping,
  clearTyping,
  getTypingUserIds,
  subscribe,
} from './typingPresence';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';
const USER_1 = 'user-1';
const USER_2 = 'user-2';

beforeEach(() => {
  // Clear all sessions by force-clearing known entries
  clearTyping(SESSION_A, USER_1);
  clearTyping(SESSION_A, USER_2);
  clearTyping(SESSION_B, USER_1);
});

describe('typingPresence', () => {
  it('adds a typing user to a session', () => {
    handleIncomingTyping(SESSION_A, USER_1);
    expect(getTypingUserIds(SESSION_A)).toEqual([USER_1]);
  });

  it('adds multiple typing users to the same session', () => {
    handleIncomingTyping(SESSION_A, USER_1);
    handleIncomingTyping(SESSION_A, USER_2);

    const ids = getTypingUserIds(SESSION_A);
    expect(ids).toContain(USER_1);
    expect(ids).toContain(USER_2);
    expect(ids.length).toBe(2);
  });

  it('keeps sessions isolated', () => {
    handleIncomingTyping(SESSION_A, USER_1);
    handleIncomingTyping(SESSION_B, USER_2);

    expect(getTypingUserIds(SESSION_A)).toEqual([USER_1]);
    expect(getTypingUserIds(SESSION_B)).toEqual([USER_2]);
  });

  it('clears a specific user from a session', () => {
    handleIncomingTyping(SESSION_A, USER_1);
    handleIncomingTyping(SESSION_A, USER_2);

    clearTyping(SESSION_A, USER_1);

    expect(getTypingUserIds(SESSION_A)).toEqual([USER_2]);
  });

  it('auto-clears after timeout', async () => {
    vi.useFakeTimers();

    handleIncomingTyping(SESSION_A, USER_1);
    expect(getTypingUserIds(SESSION_A)).toEqual([USER_1]);

    // Advance past the 3s timeout
    vi.advanceTimersByTime(3100);

    expect(getTypingUserIds(SESSION_A)).toEqual([]);

    vi.useRealTimers();
  });

  it('resets the auto-clear timer on repeated typing from the same user', async () => {
    vi.useFakeTimers();

    handleIncomingTyping(SESSION_A, USER_1);
    vi.advanceTimersByTime(2000); // 2s in

    // Still present
    expect(getTypingUserIds(SESSION_A)).toEqual([USER_1]);

    // New typing event resets timer
    handleIncomingTyping(SESSION_A, USER_1);

    vi.advanceTimersByTime(2000); // Another 2s = 4s total, but timer was reset so only 2s since reset

    // Should still be present (original 3s timer was replaced)
    expect(getTypingUserIds(SESSION_A)).toEqual([USER_1]);

    vi.advanceTimersByTime(1500); // Total 3.5s since last event = past 3s

    expect(getTypingUserIds(SESSION_A)).toEqual([]);

    vi.useRealTimers();
  });

  it('notifies subscribers on typing events', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);

    handleIncomingTyping(SESSION_A, USER_1);

    expect(listener).toHaveBeenCalledWith(SESSION_A, [USER_1]);

    unsub();
  });

  it('notifies subscribers on clear', () => {
    handleIncomingTyping(SESSION_A, USER_1);

    const listener = vi.fn();
    const unsub = subscribe(listener);

    clearTyping(SESSION_A, USER_1);

    expect(listener).toHaveBeenCalledWith(SESSION_A, []);

    unsub();
  });

  it('unsubscribes listeners', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();

    handleIncomingTyping(SESSION_A, USER_1);

    expect(listener).not.toHaveBeenCalled();
  });
});
