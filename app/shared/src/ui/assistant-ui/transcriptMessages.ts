import type { ThreadMessageLike } from '@assistant-ui/react';
import { isSidebarOnlyTranscriptBlock, orderTranscriptBlocks, type TranscriptBlock } from '../../transcript';

/** A view of the platform snapshot. Hub/Edge remain the owners of message IDs and history. */
export function transcriptMessages(blocks: TranscriptBlock[]): ThreadMessageLike[] {
  const visible = orderTranscriptBlocks(blocks).filter((block) => !isSidebarOnlyTranscriptBlock(block));
  const results = new Map(visible.filter((block) => block.kind === 'tool_result' && block.callId)
    .map((block) => [block.kind === 'tool_result' ? block.callId : undefined, block]));
  const calls = new Set(visible.filter((block) => block.kind === 'tool_call').map((block) => block.callId));
  return visible.flatMap((block): ThreadMessageLike[] => {
    if (block.kind === 'tool_result' && block.callId && calls.has(block.callId)) return [];
    const role = block.author.role === 'human' ? 'user' : 'assistant';
    const base: ThreadMessageLike = {
      id: block.id,
      role,
      createdAt: block.createdAt ? new Date(block.createdAt) : undefined,
      metadata: { custom: { author: block.author, blockId: block.id,
        ...(block.kind === 'text' ? { badgeLabel: block.badgeLabel } : {}) } },
      content: [],
    };
    switch (block.kind) {
      case 'text':
        return [{ ...base, content: block.quote ? `> ${block.quote.replaceAll('\n', '\n> ')}\n\n${block.text}` : block.text }];
      case 'thinking':
        return [{ ...base, role: 'assistant', content: [{ type: 'reasoning', text: block.content ?? '' }],
          status: block.isThinking ? { type: 'running' } : { type: 'complete', reason: 'stop' } }];
      case 'tool_call': {
        const result = block.callId ? results.get(block.callId) : undefined;
        return [{ ...base, role: 'assistant', content: [{
          type: 'tool-call', toolCallId: block.callId ?? block.id, toolName: block.toolName,
          args: block.input ?? {},
          ...(result?.kind === 'tool_result' ? { result: result.summary ?? '', isError: result.status === 'failed' } :
            block.status === 'completed' || block.status === 'failed' ? { result: block.summary ?? '', isError: block.status === 'failed' } : {}),
        }] }];
      }
      default:
        // Product evidence (permissions, artifacts, attachments) uses the library's data UI slot.
        return [{ ...base, content: [{ type: 'data', name: 'agenthub-evidence', data: block }] }];
    }
  });
}
