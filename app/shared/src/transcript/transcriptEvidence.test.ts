import { describe, expect, it } from 'vitest';
import { collectTranscriptEvidence } from './transcriptEvidence';
import type { TranscriptBlock } from './types';

describe('collectTranscriptEvidence', () => {
  it('collects evidence refs from transcript blocks in render order', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'msg-1',
        kind: 'text',
        author: { id: 'user', name: 'User', role: 'human' },
        text: '请实现 v4 shell',
      },
      {
        id: 'tool-1',
        kind: 'tool_call',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'rg',
        status: 'completed',
        evidenceRefs: [
          { id: 'ev-tool', kind: 'tool', label: 'rg desktop shell', status: 'completed' },
          { id: 'ev-file', kind: 'file', label: 'app/shared/src/workbench/AgentHubWorkbench.tsx' },
        ],
      },
      {
        id: 'artifact-1',
        kind: 'artifact',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'v4 workbench skeleton',
        evidenceRefs: [{ id: 'ev-artifact', kind: 'artifact', label: 'Workbench skeleton' }],
      },
    ];

    expect(collectTranscriptEvidence(blocks).map((item) => item.id)).toEqual([
      'ev-tool',
      'ev-file',
      'ev-artifact',
    ]);
  });

  it('deduplicates repeated evidence ids without changing first occurrence order', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'diff-1',
        kind: 'diff',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Shared shell diff',
        files: ['app/shared/src/workbench/AgentHubWorkbench.tsx'],
        evidenceRefs: [{ id: 'ev-file', kind: 'file', label: 'Workbench file' }],
      },
      {
        id: 'approval-1',
        kind: 'approval',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        title: 'Apply workbench patch',
        status: 'pending',
        evidenceRefs: [{ id: 'ev-file', kind: 'file', label: 'Workbench file' }],
      },
    ];

    expect(collectTranscriptEvidence(blocks)).toHaveLength(1);
  });
});
