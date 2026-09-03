import { describe, expect, it } from 'vitest';
import {
  collectTranscriptEvidence,
  isSidebarOnlyTranscriptBlock as isTranscriptEvidenceSidebarOnlyBlock,
  rawRunIdFromEvidenceId,
  resolveCurrentTranscriptRunId,
} from './transcriptEvidence';
import { isSidebarOnlyTranscriptBlock as isCanonicalSidebarOnlyBlock } from './types';
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
          { id: 'ev-file', kind: 'file', label: 'app/workbench/src/AgentHubWorkbench.tsx' },
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
        files: ['app/workbench/src/AgentHubWorkbench.tsx'],
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

describe('isSidebarOnlyTranscriptBlock', () => {
  it('keeps orchestration metadata out of the main chat transcript', () => {
    const sidebarOnlyBlocks: TranscriptBlock[] = [
      {
        id: 'run-session',
        kind: 'run_session',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        title: 'Run started',
      },
      {
        id: 'route',
        kind: 'route_decision',
        author: { id: 'orchestrator', name: 'Orchestrator', role: 'agent' },
        action: 'fanout',
        targetAgent: 'Reviewer',
      },
      {
        id: 'subagent',
        kind: 'subagent',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Review pass',
        worker: 'Reviewer',
        status: 'running',
      },
      {
        id: 'subtask',
        kind: 'subtask',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Audit pass',
        worker: 'Auditor',
        status: 'completed',
      },
      {
        id: 'child',
        kind: 'child_agent',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Child run',
        agent: 'Reviewer',
        status: 'completed',
      },
      {
        id: 'context',
        kind: 'context_usage',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        inputTokens: 1000,
        outputTokens: 200,
      },
    ];

    expect(sidebarOnlyBlocks.map(isCanonicalSidebarOnlyBlock)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(sidebarOnlyBlocks.map(isTranscriptEvidenceSidebarOnlyBlock)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('resolveCurrentTranscriptRunId', () => {
  it('uses the latest raw run id instead of the prefixed evidence ref id', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'run-older',
        kind: 'run_session',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        title: 'Older run',
        status: 'completed',
        runId: 'run-older',
        evidenceRefs: [{ id: 'run-run-older', kind: 'run', label: 'Run run-older' }],
      },
      {
        id: 'run-newer',
        kind: 'run_session',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        title: 'Newer run',
        status: 'running',
        runId: 'run-newer',
        evidenceRefs: [{ id: 'run-run-newer', kind: 'run', label: 'Run run-newer' }],
      },
    ];

    expect(resolveCurrentTranscriptRunId(blocks)).toBe('run-newer');
  });

  it('walks nested run-step children from newest to oldest', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'steps',
        kind: 'run_step_group',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        icon: 'tools',
        title: 'Runtime steps',
        status: 'running',
        children: [
          {
            id: 'child-older',
            kind: 'child_agent',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'Older child',
            agent: 'Reviewer',
            status: 'completed',
            runId: 'run-child-older',
          },
          {
            id: 'child-newer',
            kind: 'subagent',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'Newer child',
            worker: 'Builder',
            status: 'running',
            runId: 'run-child-newer',
          },
        ],
      },
    ];

    expect(resolveCurrentTranscriptRunId(blocks)).toBe('run-child-newer');
  });

  it('can parse normalized run evidence ids as a fallback', () => {
    expect(rawRunIdFromEvidenceId('run-run-live')).toBe('run-live');
    expect(rawRunIdFromEvidenceId('run_legacy')).toBeUndefined();
    expect(resolveCurrentTranscriptRunId([
      {
        id: 'text',
        kind: 'text',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        text: 'Run event',
        evidenceRefs: [{ id: 'run-run-live', kind: 'run', label: 'Run run-live' }],
      },
    ])).toBe('run-live');
  });
});
