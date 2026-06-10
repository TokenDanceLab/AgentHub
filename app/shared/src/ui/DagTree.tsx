import React, { useState, useCallback } from 'react';
import type { RouteDecisionTranscriptBlock, SubagentTranscriptBlock, ChildAgentTranscriptBlock } from '../transcript';

/* ═══════════════════════════════════════════════════════════════════════
   DagTree — Pure HTML tree showing agent dispatch / routing DAG.

   Data sources:
     1. RouteDecisionTranscriptBlock from transcript
     2. SubagentTranscriptBlock / ChildAgentTranscriptBlock for sub-trees

   Each node renders: status icon + agent name + optional duration.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export type DagNodeStatus = 'completed' | 'in_progress' | 'pending' | 'failed';

export interface DagNode {
  id: string;
  label: string;
  status: DagNodeStatus;
  duration?: string | undefined;
  children?: DagNode[] | undefined;
}

export interface DagTreeProps {
  nodes: DagNode[];
  title?: string | undefined;
}

// ── Status icons ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<DagNodeStatus, string> = {
  completed: '✅',
  in_progress: '⏳',
  pending: '⏸',
  failed: '❌',
};

// ── Component ────────────────────────────────────────────────────────────

export const DagTree: React.FC<DagTreeProps> = ({ nodes, title }) => {
  if (nodes.length === 0) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {title && (
        <div style={{
          font: '600 0.6875rem var(--font-sans)',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          padding: '0 2px',
        }}>
          {title}
        </div>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }} role="tree">
        {nodes.map((node) => <DagTreeNode key={node.id} node={node} />)}
      </ul>
    </section>
  );
};

// ── Tree node (recursive) ────────────────────────────────────────────────

function DagTreeNode({ node }: { node: DagNode }): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 6px',
          borderRadius: 'var(--r-sm)',
          cursor: hasChildren ? 'pointer' : 'default',
          font: '400 0.75rem var(--font-sans)',
          color: node.status === 'failed' ? 'var(--danger)' : 'var(--text-2)',
          background: 'transparent',
          border: 0,
          width: '100%',
          textAlign: 'left',
        }}
        onClick={hasChildren ? toggle : undefined}
        onKeyDown={hasChildren ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}
        tabIndex={hasChildren ? 0 : -1}
      >
        <span aria-hidden="true">{STATUS_ICON[node.status]}</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>
        {node.duration && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', font: '500 0.6875rem var(--font-mono)', whiteSpace: 'nowrap' }}>
            {node.duration}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul style={{ margin: 0, padding: '0 0 0 18px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }} role="group">
          {node.children!.map((child) => <DagTreeNode key={child.id} node={child} />)}
        </ul>
      )}
    </li>
  );
}

// ── Factory: build DagNode[] from transcript blocks ──────────────────────

export function buildDagNodesFromTranscript(blocks: Array<RouteDecisionTranscriptBlock | SubagentTranscriptBlock | ChildAgentTranscriptBlock>): DagNode[] {
  return blocks.map((block, i) => {
    let label: string;
    let status: string | undefined;

    if (block.kind === 'route_decision') {
      label = `${block.action}${block.targetAgent ? ` → ${block.targetAgent}` : ''}`;
      status = 'completed';
    } else if (block.kind === 'child_agent') {
      label = block.agent;
      status = block.status;
    } else {
      label = block.worker;
      status = block.status;
    }

    return {
      id: block.id || `dag-${i}`,
      label,
      status: mapStatus(status),
      children: undefined,
    };
  });
}

function mapStatus(status: string | undefined): DagNodeStatus {
  switch (status) {
    case 'completed': return 'completed';
    case 'running': return 'in_progress';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}
