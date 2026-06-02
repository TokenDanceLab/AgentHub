/**
 * Background poller that detects run status transitions and fires native
 * notifications via mobileCommands.  Respects per-event-type notification
 * preferences stored in utils/notifyPrefs.
 *
 * Usage (once at app root):
 *   useRunNotifications();
 *
 * It polls GET /v1/runs every 10 s (refetchInterval: 10_000) and compares
 * the current run statuses against a ref of previously-seen statuses.
 * Transitions:
 *   any → finished    => notifyRunCompleted
 *   any → failed      => notifyRunFailed
 *   any → waiting_approval => notifyApprovalNeeded
 */

import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRuns, type Run } from "@agenthub/shared";
import {
  notifyRunCompleted,
  notifyRunFailed,
  notifyApprovalNeeded,
} from "../native/mobileCommands";
import { isNotifyEnabled } from "../utils/notifyPrefs";

type RunId = string;

function buildStatusMap(runs: Run[]): Map<RunId, string> {
  const map = new Map<RunId, string>();
  for (const run of runs) {
    map.set(run.runId, run.status);
  }
  return map;
}

export function useRunNotifications() {
  // Ref that survives re-renders and keeps the last-seen status snapshot.
  const prevStatusRef = useRef<Map<RunId, string>>(new Map());
  // Guard against duplicate notifications within the same poll cycle.
  const notifiedThisCycle = useRef<Set<string>>(new Set());

  const runsQuery = useQuery({
    queryKey: ["runs-notify-poll"],
    queryFn: () => listRuns({ pageSize: 30 }),
    refetchInterval: 10_000,
    retry: false,
    // Don't show this query in React Query devtools as loading/spinning;
    // it's a silent background poller.
  });

  useEffect(() => {
    const runs = runsQuery.data?.items;
    if (!runs || runs.length === 0) return;

    const currentMap = buildStatusMap(runs);
    const prevMap = prevStatusRef.current;

    // Detect transitions
    for (const run of runs) {
      const prevStatus = prevMap.get(run.runId);
      const currentStatus = run.status;

      // Skip if status hasn't changed
      if (prevStatus === currentStatus) continue;

      // Deduplication key: runId + newStatus
      const dedupKey = `${run.runId}:${currentStatus}`;
      if (notifiedThisCycle.current.has(dedupKey)) continue;

      if (currentStatus === "finished" && isNotifyEnabled("run_completed")) {
        notifiedThisCycle.current.add(dedupKey);
        void notifyRunCompleted("Agent", run.runId);
      }

      if (currentStatus === "failed" && isNotifyEnabled("run_failed")) {
        notifiedThisCycle.current.add(dedupKey);
        void notifyRunFailed("Agent", "unknown error");
      }

      if (currentStatus === "waiting_approval" && isNotifyEnabled("approval_needed")) {
        notifiedThisCycle.current.add(dedupKey);
        notifyApprovalNeeded(run.runId);
      }
    }

    // Update the previous-status snapshot for the next poll.
    prevStatusRef.current = currentMap;

    // Clear the per-cycle dedup set on next tick so it's fresh for the next poll.
    const dedup = notifiedThisCycle.current;
    const timer = setTimeout(() => {
      dedup.clear();
    }, 2000);

    return () => clearTimeout(timer);
  }, [runsQuery.dataUpdatedAt]);
}
