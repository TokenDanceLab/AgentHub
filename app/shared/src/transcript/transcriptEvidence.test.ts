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

  it('keeps first occurrence order while updating repeated evidence status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'run-started',
        kind: 'text',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        text: 'Run started',
        evidenceRefs: [{ id: 'run-1', kind: 'run', label: 'Run 1', status: 'running' }],
      },
      {
        id: 'tool',
        kind: 'tool_call',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        toolName: 'Shell',
        status: 'completed',
        evidenceRefs: [{ id: 'tool-1', kind: 'tool', label: 'Shell', status: 'completed' }],
      },
      {
        id: 'run-finished',
        kind: 'text',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        text: 'Run finished',
        evidenceRefs: [{ id: 'run-1', kind: 'run', label: 'Run 1', status: 'completed' }],
      },
    ];

    expect(collectTranscriptEvidence(blocks)).toEqual([
      { id: 'run-1', kind: 'run', label: 'Run 1', status: 'completed' },
      { id: 'tool-1', kind: 'tool', label: 'Shell', status: 'completed' },
    ]);
  });
});
