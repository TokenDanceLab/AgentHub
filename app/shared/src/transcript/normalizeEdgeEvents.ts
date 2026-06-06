import type { EventEnvelope } from '../events';
import type { EvidenceRef, EvidenceRefStatus, TranscriptAuthor, TranscriptBlock } from './types';

const AGENT_AUTHOR: TranscriptAuthor = { id: 'agent', name: 'Agent', role: 'agent' };
const EDGE_AUTHOR: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };

export function normalizeEdgeEventsToTranscript(events: EventEnvelope[] | undefined): TranscriptBlock[] {
  if (!events?.length) return [];

  return events
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
}

function normalizeEdgeEvent(event: EventEnvelope): TranscriptBlock | null {
  switch (event.type) {
    case 'run.queued':
      return runTextBlock(event, 'queued', 'pending');
    case 'run.started':
      return runTextBlock(event, 'started', 'running');
    case 'run.status.changed':
      return runStatusBlock(event);
    case 'run.output':
      return outputTextBlock(event);
    case 'run.output.batch':
      return outputBatchTextBlock(event);
    case 'run.agent.text_delta':
    case 'run.agent.text_block':
      return agentTextBlock(event);
    case 'run.agent.thinking':
      return thinkingTextBlock(event);
    case 'run.agent.tool_call':
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
    case 'run.agent.result':
      return agentResultBlock(event);
    case 'run.finished':
      return runTextBlock(event, 'finished', 'completed');
    case 'run.failed':
      return runFailedBlock(event);
    case 'run.cancelled':
      return runTextBlock(event, 'cancelled', 'failed');
    default:
      return null;
  }
}

function runTextBlock(
  event: EventEnvelope,
  action: string,
  status: EvidenceRefStatus,
): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) return null;

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status)),
    kind: 'text',
    text: `Run ${runId} ${action}`,
  };
}

function runStatusBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  const statusText = stringField(event.payload.status);
  if (!runId || !statusText) return null;
  const status = normalizeEvidenceStatus(statusText);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status)),
    kind: 'text',
    text: `Run ${runId} ${statusText}`,
  };
}

function runFailedBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) return null;
  const reason =
    stringField(event.payload.reason) ??
    stringField(event.payload.error) ??
    stringField(event.payload.message);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'failed')),
    kind: 'text',
    text: reason ? `Run ${runId} failed: ${reason}` : `Run ${runId} failed`,
  };
}

function outputTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const text = cleanText(stringField(event.payload.text));
  if (!text) return null;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'running')),
    kind: 'text',
    text,
  };
}

function outputBatchTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const chunks = event.payload.chunks;
  if (!Array.isArray(chunks)) return null;

  const text = cleanText(
    chunks
      .map((chunk) => {
        if (!isRecord(chunk)) return '';
        return stringField(chunk.text) ?? '';
      })
      .join(''),
  );
  if (!text) return null;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'running')),
    kind: 'text',
    text,
  };
}

function agentTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const text = cleanText(stringField(event.payload.content) ?? stringField(event.payload.text));
  if (!text) return null;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, AGENT_AUTHOR, runEvidence(runId, 'running')),
    kind: 'text',
    text,
  };
}

function thinkingTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const content = cleanText(stringField(event.payload.content));
  if (!content) return null;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, AGENT_AUTHOR, runEvidence(runId, 'running')),
    kind: 'text',
    text: `Thinking: ${content}`,
  };
}

function toolCallBlock(event: EventEnvelope): TranscriptBlock | null {
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.name);
  const callId = stringField(event.payload.callId) ?? stringField(event.payload.id);
  if (!toolName && !callId) return null;
  const status = normalizeEvidenceStatus(stringField(event.payload.status) ?? 'running');
  const runId = eventRunId(event);
  const label = toolName ?? callId ?? 'Tool call';

  return {
    ...blockBase(event, AGENT_AUTHOR, [
      ...runEvidence(runId, status),
      ...toolEvidence(callId ?? label, label, status),
    ]),
    kind: 'tool_call',
    toolName: label,
    status,
  };
}

function toolResultBlock(event: EventEnvelope): TranscriptBlock | null {
  const callId = stringField(event.payload.callId) ?? stringField(event.payload.id);
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.name) ?? callId;
  if (!toolName) return null;
  const isError = event.payload.isError === true || Boolean(stringField(event.payload.error));
  const status: EvidenceRefStatus = isError ? 'failed' : 'completed';
  const runId = eventRunId(event);

  return {
    ...blockBase(event, AGENT_AUTHOR, [
      ...runEvidence(runId, status),
      ...toolEvidence(callId ?? toolName, `${toolName} result`, status),
    ]),
    kind: 'tool_call',
    toolName,
    status,
  };
}

function fileChangeBlock(event: EventEnvelope): TranscriptBlock | null {
  const path = stringField(event.payload.path) ?? pathFromContent(stringField(event.payload.content));
  if (!path) return null;
  const runId = eventRunId(event);
  const evidence = [
    ...runEvidence(runId, 'running'),
    fileEvidence(path),
  ];

  if (cleanText(stringField(event.payload.diff))) {
    return {
      ...blockBase(event, AGENT_AUTHOR, evidence),
      kind: 'diff',
      title: path,
      files: [path],
    };
  }

  const action = stringField(event.payload.kind) ?? stringField(event.payload.action) ?? 'modified';
  return {
    ...blockBase(event, AGENT_AUTHOR, evidence),
    kind: 'artifact',
    title: `${action} ${path}`,
  };
}

function permissionRequestedBlock(event: EventEnvelope): TranscriptBlock | null {
  const requestId =
    stringField(event.payload.requestId) ??
    stringField(event.payload.approvalId) ??
    event.id;
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.kind) ?? 'permission';
  const runId = eventRunId(event);

  return {
    ...blockBase(event, EDGE_AUTHOR, [
      ...runEvidence(runId, 'pending'),
      ...toolEvidence(requestId, toolName, 'pending'),
    ]),
    kind: 'approval',
    title: `Permission requested: ${toolName}`,
    status: 'pending',
  };
}

function permissionDecidedBlock(event: EventEnvelope): TranscriptBlock | null {
  const requestId =
    stringField(event.payload.requestId) ??
    stringField(event.payload.approvalId) ??
    event.id;
  const decision = stringField(event.payload.decision) ?? 'decided';
  const status: EvidenceRefStatus = decision === 'deny' || decision === 'rejected' ? 'failed' : 'completed';
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.kind) ?? 'permission';
  const runId = eventRunId(event);

  return {
    ...blockBase(event, EDGE_AUTHOR, [
      ...runEvidence(runId, status),
      ...toolEvidence(requestId, toolName, status),
    ]),
    kind: 'approval',
    title: `Permission ${decision}: ${toolName}`,
    status,
  };
}

function artifactCreatedBlock(event: EventEnvelope): TranscriptBlock | null {
  const artifactId = stringField(event.payload.artifactId) ?? event.id;
  const path = stringField(event.payload.path);
  const uri =
    stringField(event.payload.uri) ??
    stringField(event.payload.url) ??
    stringField(event.payload.href);
  const mimeType = stringField(event.payload.mimeType) ?? stringField(event.payload.mediaType);
  const title =
    path ??
    stringField(event.payload.title) ??
    uri ??
    stringField(event.payload.kind) ??
    artifactId;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, AGENT_AUTHOR, [
      ...runEvidence(runId, 'running'),
      {
        id: `artifact-${artifactId}`,
        kind: 'artifact',
        label: title,
        status: 'completed',
        ...(path ? { path } : {}),
        ...(uri ? { uri } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
    ]),
    kind: 'artifact',
    title,
  };
}

function agentResultBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) return null;
  const success = event.payload.success !== false;
  const status: EvidenceRefStatus = success ? 'completed' : 'failed';
  const error = stringField(event.payload.error);

  return {
    ...blockBase(event, AGENT_AUTHOR, runEvidence(runId, status)),
    kind: 'text',
    text: success ? `Run ${runId} result received` : `Run ${runId} result failed${error ? `: ${error}` : ''}`,
  };
}

function blockBase(event: EventEnvelope, author: TranscriptAuthor, evidenceRefs: EvidenceRef[]) {
  return {
    id: `edge-event-${event.id}`,
    author,
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

function runEvidence(runId: string | undefined, status: EvidenceRefStatus): EvidenceRef[] {
  if (!runId) return [];
  return [{
    id: `run-${runId}`,
    kind: 'run',
    label: `Run ${runId}`,
    status,
  }];
}

function toolEvidence(
  id: string | undefined,
  label: string,
  status: EvidenceRefStatus,
): EvidenceRef[] {
  if (!id) return [];
  return [{
    id: `tool-${id}`,
    kind: 'tool',
    label,
    status,
  }];
}

function fileEvidence(path: string): EvidenceRef {
  return {
    id: `file-${path}`,
    kind: 'file',
    label: path,
    path,
  };
}

function eventRunId(event: EventEnvelope): string | undefined {
  return stringField(event.payload.runId) ?? stringField(event.scope.runId);
}

function normalizeEvidenceStatus(status: string | undefined): EvidenceRefStatus {
  switch (status?.trim()) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'running':
    case 'starting':
    case 'streaming':
    case 'draining':
      return 'running';
    case 'failed':
    case 'cancelled':
    case 'error':
    case 'denied':
    case 'rejected':
      return 'failed';
    case 'completed':
    case 'finished':
    case 'succeeded':
    case 'success':
    case 'approved':
      return 'completed';
    default:
      return 'running';
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  return text || undefined;
}

function pathFromContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const match = content.match(/(?:^|\s)([A-Za-z]:[\\/][^\s]+|[\w./-]+\.[\w.-]+)/);
  return match?.[1];
}

function timestampMs(event: EventEnvelope): number {
  const parsed = Date.parse(event.sentAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
