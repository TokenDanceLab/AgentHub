import { describe, expect, it } from 'vitest';
import { blocksToTranscriptItems } from '../chatview/adapter';
import type { TranscriptAgentItem, TranscriptUserItem } from '../chatview/transcript-item';
import {
  goldenMixedSourceFullBlockIds,
  goldenMixedSourceInspectorOnlyBlockIds,
  goldenMixedSourceMainBlockIds,
  resolveGoldenMixedSourceMainTranscript,
  resolveGoldenMixedSourceTranscript,
} from './goldenTranscriptFixtures';
import { isSidebarOnlyTranscriptBlock } from './types';

describe('golden mixed-source transcript fixture', () => {
  it('normalizes Hub user, Edge tool/result, subagent detail, and markdown reply in deterministic order', () => {
    const blocks = resolveGoldenMixedSourceTranscript();

    expect(blocks.map((block) => block.id)).toEqual([...goldenMixedSourceFullBlockIds]);
    expect(blocks.map((block) => block.kind)).toEqual([
      'text',
      'run_session',
      'tool_call',
      'tool_call',
      'tool_result',
      'tool_result',
      'subtask',
      'route_decision',
      'text',
    ]);
    expect(blocks[0]).toEqual(expect.objectContaining({
      author: { id: 'user-golden', name: 'Golden User', role: 'human' },
      text: 'Kick off the golden mixed-source contract.',
    }));
    expect(blocks[blocks.length - 1]).toEqual(expect.objectContaining({
      author: { id: 'agent-golden-builder', name: 'Builder', role: 'agent' },
      text: expect.stringContaining('| order | ordered |'),
    }));
  });

  it('keeps inspector-only details out of the main transcript fixture', () => {
    const fullBlocks = resolveGoldenMixedSourceTranscript();
    const mainBlocks = resolveGoldenMixedSourceMainTranscript();
    const inspectorOnlyBlocks = fullBlocks.filter(isSidebarOnlyTranscriptBlock);

    expect(inspectorOnlyBlocks.map((block) => block.id)).toEqual([...goldenMixedSourceInspectorOnlyBlockIds]);
    expect(mainBlocks.map((block) => block.id)).toEqual([...goldenMixedSourceMainBlockIds]);

    const mainText = JSON.stringify(mainBlocks);
    expect(mainText).not.toContain('Deep report should stay in inspector');
    expect(mainText).not.toContain('Reviewer QA');
    expect(mainText).not.toContain('Route details belong to the inspector DAG.');
    expect(mainText).not.toContain('Runtime: mock replay');
  });

  it('adapts the main fixture into stable ChatView items without losing tool/result ordering', () => {
    const items = blocksToTranscriptItems(resolveGoldenMixedSourceMainTranscript());
    const userItem = items[0] as TranscriptUserItem;
    const agentItem = items[1] as TranscriptAgentItem;

    expect(items).toHaveLength(2);
    expect(userItem).toMatchObject({
      type: 'user',
      id: 'hub-message-client-golden-user',
      text: 'Kick off the golden mixed-source contract.',
    });

    expect(agentItem.agent).toBe('Builder');
    expect(agentItem.rows.map((row) => row.id)).toEqual([
      'edge-event-hub-runtime-evt-golden-call-read-a',
      'edge-event-hub-runtime-evt-golden-call-read-b',
    ]);
    expect(agentItem.rows.map((row) => ({
      toolCallId: row.toolCallId,
      content: row.content,
      isResult: row.isResult,
      status: row.status,
    }))).toEqual([
      {
        toolCallId: 'read-a',
        content: 'A result belongs to src/a.ts',
        isResult: true,
        status: 'ok',
      },
      {
        toolCallId: 'read-b',
        content: 'B result belongs to src/b.ts',
        isResult: true,
        status: 'ok',
      },
    ]);
    expect(agentItem.bubbles).toEqual([
      [
        'The golden replay summary is below.',
        '',
        '| Check | Status |',
        '| --- | --- |',
        '| order | ordered |',
      ].join('\n'),
    ]);
  });
});
