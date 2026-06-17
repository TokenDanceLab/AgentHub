/* ═══════════════════════════════════════════════════════════════════════
   STREAMING SIMULATION — helper for testing incremental block arrival
   ══════════════════════════════════════════════════════════════════════ */

import { blocksToTranscriptItems, type AgentTranscriptBlock } from './adapter'
import type { TranscriptBlock } from '../transcript/types'

/**
 * Simulates streaming by calling blocksToTranscriptItems incrementally.
 * Each call appends one more block. Returns snapshots of each step.
 * Useful for testing React reconciliation during streaming updates.
 */
export function simulateStreaming(blocks: TranscriptBlock[]) {
  const snapshots: ReturnType<typeof blocksToTranscriptItems>[] = []
  const accumulated: TranscriptBlock[] = []

  for (const block of blocks) {
    accumulated.push(block)
    snapshots.push(blocksToTranscriptItems([...accumulated]))
  }

  return snapshots
}

/**
 * Verify that streaming keys remain stable as blocks accumulate.
 * The same block at the same position should produce the same key
 * across all incremental snapshots.
 */
export function verifyStreamingKeyStability(blocks: TranscriptBlock[]): string[] {
  const issues: string[] = []
  const snapshots = simulateStreaming(blocks)

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!
    const curr = snapshots[i]!

    // Agent blocks should maintain stable IDs
    for (let j = 0; j < Math.min(prev.length, curr.length); j++) {
      const prevItem = prev[j]!
      const currItem = curr[j]!
      if ('id' in prevItem && 'id' in currItem) {
        if (prevItem.id !== currItem.id) {
          issues.push(`Step ${i}: agent ID changed from "${prevItem.id}" to "${currItem.id}" at position ${j}`)
        }
      }
      // User messages should have stable content-based keys
      if ('type' in prevItem && 'type' in currItem) {
        if (prevItem.type === 'user' && currItem.type === 'user') {
          if (prevItem.text !== currItem.text) {
            issues.push(`Step ${i}: user text changed at position ${j}`)
          }
        }
      }
    }
  }

  return issues
}

// ── Tests ──

import { describe, it, expect } from 'vitest'

const DEFAULT_AGENT_NAME = 'TestAgent'

const makeAuthor = (id: string) => ({ id, name: DEFAULT_AGENT_NAME, role: 'agent' as const })

describe('simulateStreaming', () => {
  it('produces growing snapshots', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'thinking', createdAt: new Date().toISOString(), author: makeAuthor('b1'), content: 'a', isThinking: true },
      { id: 't2', kind: 'thinking', createdAt: new Date().toISOString(), author: makeAuthor('b1'), content: 'b', isThinking: true },
    ] as TranscriptBlock[]
    const snapshots = simulateStreaming(blocks)
    expect(snapshots).toHaveLength(2)
    expect((snapshots[0]![0]! as AgentTranscriptBlock).rows).toHaveLength(1)
    expect((snapshots[1]![0]! as AgentTranscriptBlock).rows).toHaveLength(2)
  })

  it('maintains stable agent IDs across streaming steps', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'thinking', createdAt: new Date().toISOString(), author: makeAuthor('b1'), content: 'a', isThinking: true },
      { id: 't2', kind: 'tool_call', createdAt: new Date().toISOString(), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 't3', kind: 'tool_result', createdAt: new Date().toISOString(), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'ok' },
    ] as TranscriptBlock[]
    const issues = verifyStreamingKeyStability(blocks)
    expect(issues).toEqual([])
  })
})
