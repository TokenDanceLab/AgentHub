// real_tested=true
import { describe, expect, it } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import { AGENT_AUTHOR, EDGE_AUTHOR } from './edgeEventEvidence';
import {
  artifactCreatedBlock,
  previewReadyBlock,
  previewStoppedBlock,
} from './edgeEventMappersArtifacts';

function edgeEvent(
  id: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  sentAt = `2026-06-07T03:00:0${seq}Z`,
  scopeOverrides: EventScope = {},
): EventEnvelope {
  return {
    version: 'v1',
    id,
    seq,
    type,
    scope: {
      threadId: 'thread-live',
      conversationId: 'thread-live',
      runId: typeof payload.runId === 'string' ? payload.runId : undefined,
      ...scopeOverrides,
    },
    sentAt,
    payload,
  };
}

describe('artifactCreatedBlock', () => {
  it('builds an artifact block with path, uri, mimeType, and threadId', () => {
    expect(
      artifactCreatedBlock(
        edgeEvent('evt-ac', 1, 'artifact.created', {
          runId: 'run-1',
          artifactId: 'art-1',
          path: 'dist/index.html',
          uri: 'https://preview.dev/dist/index.html',
          mimeType: 'text/html',
          kind: 'preview',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-ac',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        {
          id: 'artifact-art-1',
          kind: 'artifact',
          label: 'dist/index.html',
          status: 'completed',
          path: 'dist/index.html',
          uri: 'https://preview.dev/dist/index.html',
          mimeType: 'text/html',
        },
      ],
      kind: 'artifact',
      title: 'dist/index.html',
      artifactId: 'art-1',
      artifactKind: 'preview',
      threadId: 'thread-live',
      path: 'dist/index.html',
      uri: 'https://preview.dev/dist/index.html',
      mimeType: 'text/html',
    });
  });

  it('falls back to the event id as the artifactId', () => {
    const block = artifactCreatedBlock(
      edgeEvent('evt-ac2', 2, 'artifact.created', { runId: 'run-2' }),
    );
    expect(block?.artifactId).toBe('evt-ac2');
    expect(block?.title).toBe('evt-ac2');
    expect(block?.evidenceRefs?.[1]?.id).toBe('artifact-evt-ac2');
  });

  it('falls back to url and href for the uri', () => {
    const byUrl = artifactCreatedBlock(
      edgeEvent('evt-ac3', 3, 'artifact.created', {
        artifactId: 'art-3',
        url: 'https://x.dev/a',
      }),
    );
    expect(byUrl?.uri).toBe('https://x.dev/a');

    const byHref = artifactCreatedBlock(
      edgeEvent('evt-ac4', 4, 'artifact.created', {
        artifactId: 'art-4',
        href: 'https://x.dev/b',
      }),
    );
    expect(byHref?.uri).toBe('https://x.dev/b');
  });

  it('falls back to mediaType for the mimeType', () => {
    const block = artifactCreatedBlock(
      edgeEvent('evt-ac5', 5, 'artifact.created', {
        artifactId: 'art-5',
        mediaType: 'image/png',
      }),
    );
    expect(block?.mimeType).toBe('image/png');
    expect(block?.evidenceRefs?.[0]?.mimeType).toBe('image/png');
  });

  it('falls back through title, uri, kind, and id for the title', () => {
    const byTitle = artifactCreatedBlock(
      edgeEvent('evt-ac6', 6, 'artifact.created', {
        artifactId: 'art-6',
        title: 'Result bundle',
      }),
    );
    expect(byTitle?.title).toBe('Result bundle');

    const byKind = artifactCreatedBlock(
      edgeEvent('evt-ac7', 7, 'artifact.created', { kind: 'report' }),
    );
    expect(byKind?.title).toBe('report');
    expect(byKind?.artifactKind).toBe('report');
  });

  it('omits threadId when the event scope has no conversationId', () => {
    const block = artifactCreatedBlock(
      edgeEvent('evt-ac8', 8, 'artifact.created', { artifactId: 'art-8' }, undefined, {
        conversationId: undefined,
      }),
    );
    expect(block).not.toHaveProperty('threadId');
  });

  it('derives the author from payload agent id and name', () => {
    const block = artifactCreatedBlock(
      edgeEvent('evt-ac9', 9, 'artifact.created', {
        artifactId: 'art-9',
        agentId: 'agent-c',
        agentName: 'Gamma',
      }),
    );
    expect(block?.author).toEqual({ id: 'agent-c', name: 'Gamma', role: 'agent' });
  });
});

describe('previewReadyBlock', () => {
  it('builds a preview block with url and threadId', () => {
    expect(
      previewReadyBlock(
        edgeEvent('evt-pv', 1, 'preview.ready', {
          runId: 'run-1',
          previewId: 'pv-1',
          url: 'https://preview.dev/app',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-pv',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        {
          id: 'preview-pv-1',
          kind: 'preview',
          label: 'https://preview.dev/app',
          status: 'completed',
          uri: 'https://preview.dev/app',
        },
      ],
      kind: 'preview',
      previewId: 'pv-1',
      threadId: 'thread-live',
      status: 'completed',
      url: 'https://preview.dev/app',
    });
  });

  it('falls back to payload.id for the previewId', () => {
    const block = previewReadyBlock(
      edgeEvent('evt-pv2', 2, 'preview.ready', { runId: 'run-2', id: 'preview-9' }),
    );
    expect(block?.previewId).toBe('preview-9');
    expect(block?.evidenceRefs?.[1]?.label).toBe('preview-9');
  });

  it('returns null when no previewId is present', () => {
    expect(
      previewReadyBlock(edgeEvent('evt-pv3', 3, 'preview.ready', { runId: 'run-3' })),
    ).toBeNull();
  });

  it('normalizes a failed status', () => {
    const block = previewReadyBlock(
      edgeEvent('evt-pv4', 4, 'preview.ready', {
        previewId: 'pv-4',
        status: 'failed',
      }),
    );
    expect(block?.status).toBe('failed');
    expect(block?.evidenceRefs?.[0]?.status).toBe('failed');
  });

  it('defaults the status to completed when missing', () => {
    const block = previewReadyBlock(
      edgeEvent('evt-pv5', 5, 'preview.ready', { previewId: 'pv-5' }),
    );
    expect(block?.status).toBe('completed');
  });

  it('omits threadId when the event scope has no conversationId', () => {
    const block = previewReadyBlock(
      edgeEvent('evt-pv6', 6, 'preview.ready', { previewId: 'pv-6' }, undefined, {
        conversationId: undefined,
      }),
    );
    expect(block).not.toHaveProperty('threadId');
  });
});

describe('previewStoppedBlock', () => {
  it('builds a preview block with a completed status', () => {
    expect(
      previewStoppedBlock(
        edgeEvent('evt-ps', 1, 'preview.stopped', {
          runId: 'run-1',
          previewId: 'pv-1',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-ps',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        {
          id: 'preview-pv-1',
          kind: 'preview',
          label: 'pv-1',
          status: 'completed',
        },
      ],
      kind: 'preview',
      previewId: 'pv-1',
      threadId: 'thread-live',
      status: 'completed',
    });
  });

  it('falls back to payload.id for the previewId', () => {
    const block = previewStoppedBlock(
      edgeEvent('evt-ps2', 2, 'preview.stopped', { runId: 'run-2', id: 'preview-8' }),
    );
    expect(block?.previewId).toBe('preview-8');
  });

  it('returns null when no previewId is present', () => {
    expect(
      previewStoppedBlock(edgeEvent('evt-ps3', 3, 'preview.stopped', { runId: 'run-3' })),
    ).toBeNull();
  });

  it('omits threadId when the event scope has no conversationId', () => {
    const block = previewStoppedBlock(
      edgeEvent('evt-ps4', 4, 'preview.stopped', { previewId: 'pv-4' }, undefined, {
        conversationId: undefined,
      }),
    );
    expect(block).not.toHaveProperty('threadId');
  });
});
