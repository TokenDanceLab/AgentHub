import { useState, useEffect, useCallback, useSyncExternalStore } from "react";

/**
 * Network status hook that monitors navigator.onLine and
 * window online/offline events.
 *
 * Returns:
 *  - isOnline: boolean — whether the browser reports connectivity
 *  - wasOffline: boolean — true if we transitioned from offline to online
 *    (resets after first online event is consumed via markOnlineHandled)
 *
 * Used by ChatView to:
 *  1. Immediately enqueue messages when offline
 *  2. Flush the offline queue when connectivity returns
 */

function getSnapshot(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getServerSnapshot(): boolean {
  return true;
}

export function useNetworkStatus() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setWasOffline(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const markOnlineHandled = useCallback(() => {
    setWasOffline(false);
  }, []);

  return { isOnline, wasOffline, markOnlineHandled };
}
