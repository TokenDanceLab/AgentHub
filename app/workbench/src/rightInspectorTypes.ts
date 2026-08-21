import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { PreviewPort } from '@shared/platform';
import type {
  ChildAgentTranscriptBlock,
  ContextUsageTranscriptBlock,
  EvidenceRef,
  RouteDecisionTranscriptBlock,
  SubagentTranscriptBlock,
  SubtaskTranscriptBlock,
} from '@shared/transcript';
import type { FileItem, RunResultInfo } from './inspector/OverviewPanel';

/* ═══════════════════════════════════════════════════════════════════════
   rightInspectorTypes — public props / shared residual types for
   RightInspector (#661). No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface RightInspectorProps {
  defaultBrowserUrl: string;
  evidence: EvidenceRef[];
  browserPreviewEnabled: boolean;
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  /**
   * Platform preview port (diff hunk write-back + evidence content-URL
   * resolution) for the file preview router (#1817). Absent capabilities
   * degrade to explicit read-only notices.
   */
  previewPort?: PreviewPort | undefined;
  reviewFileRequest?: FileItem | null | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  /** Workspace directory for the active run — required for diff apply write-back. */
  workDir?: string | undefined;
  /** Context usage blocks from the transcript, used for the compact context bar in Overview. */
  contextBlocks?: ContextUsageTranscriptBlock[] | undefined;
  /** Route decision / sub-agent blocks for DagTree visualization. */
  routeBlocks?: Array<RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock> | undefined;
  /** Deploy preview URL to auto-load in the browser tab. When set, switches to browser. */
  deployPreviewUrl?: string | undefined;
  /** Deploy status indicator for the browser tab. */
  deployStatus?: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
  /** Run result from the transcript, displayed as a banner in the overview tab. */
  runResult?: RunResultInfo | undefined;
  onResizeBy: (delta: number) => void;
  onResizeStart: (clientX: number) => void;
  width: number;
}
