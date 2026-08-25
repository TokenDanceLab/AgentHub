import type { EventEnvelope } from '../events';
import type { TranscriptBlock } from './types';
import {
  agentResultBlock,
  agentTextBlock,
  artifactCreatedBlock,
  checkpointBlock,
  compactBoundaryBlock,
  contextUsageBlock,
  fileChangeBlock,
  outputBatchTextBlock,
  outputTextBlock,
  permissionDecidedBlock,
  permissionRequestedBlock,
  previewReadyBlock,
  previewStoppedBlock,
  routeDecisionBlock,
  runCancelledBlock,
  runFailedBlock,
  runFinishedBlock,
  subtaskBlock,
  thinkingBlock,
  toolCallBlock,
  toolResultBlock,
} from './edgeEventMappers';

export function normalizeEdgeEventsToTranscript(events: EventEnvelope[] | undefined): TranscriptBlock[] {
  if (!events?.length) return [];

  const blocks = events
    .map((event, index) => ({
      block: normalizeEdgeEvent(event),
      index,
      seq: event.seq,
      timestamp: timestampMs(event),
    }))
    .filter((entry): entry is {
      block: TranscriptBlock;
      index: number;
      seq: number;
      timestamp: number;
    } => Boolean(entry.block))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.index - b.index;
    })
    .map((entry) => entry.block);

  // Post-process: merge consecutive text/thinking blocks from streaming deltas.
  // This prevents UI thrashing from many incremental text_delta/thinking events.
  // Merging only applies to blocks from the same author AND same run (via evidenceRefs).
  const merged = blocks.reduce((acc: TranscriptBlock[], block) => {
    const last = acc[acc.length - 1];
    if (!last) { acc.push(block); return acc; }

    // Only merge when BOTH blocks carry a non-empty run evidence ref. Two
    // blocks with no run evidence (e.g. legacy Hub events without edge_run_id)
    // would otherwise both return '' from evidenceRunId, and '' === '' would
    // wrongly collapse unrelated same-author text into one block.
    const lastRunId = evidenceRunId(last);
    const sameRun = Boolean(lastRunId) && lastRunId === evidenceRunId(block);

    // Merge consecutive text blocks with same author + run (streaming text_delta → single text block)
    if (
      last.kind === 'text' &&
      block.kind === 'text' &&
      last.author.id === block.author.id &&
      sameRun
    ) {
      acc[acc.length - 1] = {
        ...last,
        text: last.text + block.text,
      };
      return acc;
    }

    // Merge consecutive thinking blocks with same author + run (streaming thinking → single thinking block)
    if (
      last.kind === 'thinking' &&
      block.kind === 'thinking' &&
      last.author.id === block.author.id &&
      sameRun
    ) {
      const mergedIsThinking = last.isThinking || block.isThinking
      acc[acc.length - 1] = {
        ...last,
        content: (last.content ?? '') + (block.content ?? ''),
        ...(mergedIsThinking ? { isThinking: true as const } : {}),
      };
      return acc;
    }

    acc.push(block);
    return acc;
  }, []);

  // Post-process: auto-transition thinking blocks to 'completed' when the next
  // non-thinking block arrives. This prevents thinking blocks from staying in
  // 'running' state forever when the model has already moved on to a text reply.
  for (let i = 0; i < merged.length; i++) {
    const block = merged[i]!;
    if (block.kind === 'thinking' && block.isThinking) {
      const nextBlock = merged[i + 1];
      if (!nextBlock || nextBlock.kind !== 'thinking') {
        // Mark as completed; update evidenceRef status too
        block.isThinking = false;
        if (block.evidenceRefs) {
          for (const ref of block.evidenceRefs) {
            ref.status = 'completed';
          }
        }
      }
    }
  }

  return merged;
}

/** Extract the first run evidence ref ID from a block's evidenceRefs, or empty string if none. */
function evidenceRunId(block: TranscriptBlock): string {
  const refs = block.evidenceRefs;
  if (!refs) return '';
  const runRef = refs.find((r) => r.kind === 'run');
  return runRef?.id ?? '';
}

// System-level run lifecycle events that should not appear as transcript blocks.
// These are status indicators, not conversational content.
//
// Members:
// - run.queued / run.started / run.status.changed: run-level lifecycle state
//   transitions. The switch below no longer carries dedicated cases for these
//   (they used to be unreachable dead code because this set short-circuits
//   first); keeping them here silences the default-branch console.warn.
// - run.agent.status_change: agent-level status indicator (e.g. the "compacting"
//   state during auto-compaction); emitted by the Anthropic/OpenAI/NDJSON adapters.
// - run.agent.context_warning: auto-compaction budget alert (emitted at ~85%
//   context budget by BudgetAwareEmitter); status indicator, not content.
// - run.agent.api_retry: transient transport/retry signal (emitted ×N per retry
//   attempt by the SDK request paths); observability noise, not content.
//   Consuming it for retry counting is a larger follow-up, deferred for now.
// - run.agent.context_compaction: final auto-compaction marker emitted at
//   compaction completion; status indicator, not content.
//
// TODO(Wave 3): The edge-server emits a long tail of structured events that the
// transcript layer cannot yet project into dedicated block kinds. They are
// listed here so the default-branch console.warn stays quiet until purpose-built
// blocks are designed:
//   - run.agent.sub_agents_complete: aggregated sub-agent results (no block kind)
//   - run.agent.task_dispatched: orchestrator dispatch lifecycle (no block kind)
//   - run.agent.hook_started / hook_progress / hook_response: hook chain telemetry
//   - run.agent.plan_proposed / plan_approved / plan_rejected / plan_expired:
//     plan approval gate signals (the Hub-level approval.* events are already
//     projected via permissionRequestedBlock/permissionDecidedBlock)
//   - run.agent.tool_rejected: allowlist enforcement signal
//   - run.agent.session_init / session_state_changed / session_metrics:
//     session lifecycle telemetry
//   - run.agent.auth_status / rate_limit / cli_invocation_plan / tool_use_summary
//
// Explicitly skipping these silences the default-branch console.warn for known
// system-level status events. Truly unknown event types still warn (see default).
const SKIPPED_EVENT_TYPES = new Set<string>([
  'run.queued',
  'run.started',
  'run.status.changed',
  'run.agent.status_change',
  'run.agent.context_warning',
  'run.agent.api_retry',
  'run.agent.context_compaction',
  // TODO(Wave 3): no dedicated transcript block kind yet — silenced, not dropped silently.
  'run.agent.sub_agents_complete',
  'run.agent.task_dispatched',
  'run.agent.hook_started',
  'run.agent.hook_progress',
  'run.agent.hook_response',
  'run.agent.plan_proposed',
  'run.agent.plan_approved',
  'run.agent.plan_rejected',
  'run.agent.plan_expired',
  'run.agent.tool_rejected',
  'run.agent.session_init',
  'run.agent.session_state_changed',
  'run.agent.session_metrics',
  'run.agent.auth_status',
  'run.agent.rate_limit',
  'run.agent.cli_invocation_plan',
  'run.agent.tool_use_summary',
]);

function normalizeEdgeEvent(event: EventEnvelope): TranscriptBlock | null {
  if (SKIPPED_EVENT_TYPES.has(event.type)) return null;

  switch (event.type) {
    case 'run.checkpoint':
      return checkpointBlock(event);
    case 'run.output':
      return outputTextBlock(event);
    case 'run.output.batch':
      return outputBatchTextBlock(event);
    case 'run.agent.text_delta':
    case 'run.agent.text_block':
      return agentTextBlock(event);
    case 'run.agent.thinking':
      return thinkingBlock(event);
    // Legacy persisted Hub-runtime event_type still consumed by the
    // chat-flow e2e contract (app/web/__e2e__); the edge-server itself emits
    // run.agent.task_started / task_progress / task_notification instead, which
    // are wired to the same subtaskBlock mapper below.
    case 'run.agent.subagent_task':
      return subtaskBlock(event);
    case 'run.agent.task_started':
    case 'run.agent.task_progress':
    case 'run.agent.task_notification':
    case 'run.agent.sub_agent_status':
      return subtaskBlock(event);
    case 'run.agent.route_decision':
      return routeDecisionBlock(event);
    case 'run.agent.context_usage':
      return contextUsageBlock(event);
    case 'run.agent.compact_boundary':
      return compactBoundaryBlock(event);
    case 'run.agent.tool_call':
    case 'run.agent.mcp_tool_call':
      return toolCallBlock(event);
    case 'run.agent.tool_result':
      return toolResultBlock(event);
    case 'run.agent.file_change':
      return fileChangeBlock(event);
    case 'run.agent.permission_requested':
    case 'approval.requested':
      return permissionRequestedBlock(event);
    case 'run.agent.permission_decided':
    case 'approval.decided':
      return permissionDecidedBlock(event);
    case 'artifact.created':
      return artifactCreatedBlock(event);
    case 'preview.ready':
      return previewReadyBlock(event);
    case 'preview.stopped':
      return previewStoppedBlock(event);
    case 'run.agent.result':
      return agentResultBlock(event);
    case 'run.finished':
      return runFinishedBlock(event);
    case 'run.failed':
      return runFailedBlock(event);
    case 'run.cancelled':
      return runCancelledBlock(event);
    default:
      console.warn('normalizeEdgeEvents: unknown event type — silently dropped', {
        type: event.type,
        eventId: event.id,
      });
      return null;
  }
}

function timestampMs(event: EventEnvelope): number {
  const parsed = Date.parse(event.sentAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
