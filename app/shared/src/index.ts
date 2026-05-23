export type {
  HealthResponse,
  Runner,
  PageInfo,
  ListResponse,
  RunInfo,
} from './types';

export type {
  EventEnvelope,
  RunnerEvent,
  RunLifecycleEvent,
  RunOutputEvent,
  RunOutputBatchEvent,
  ErrorEvent,
  AnyEvent,
} from './events';

export { parseError, isErrorResponse, AppError } from './errors';

export { buildTree, flattenTree } from './tree';
export type { TreeNode } from './tree';

export { normalizeDiffs, parseUnifiedDiff } from './diff';
export type { DiffFile, DiffHunk, DiffLine } from './diff';

// New diff engine (ported from OpenCode session-diff.ts)
export {
  normalize,
  text as diffText,
  parseUnifiedPatch,
  separateBeforeAfter,
  fileMetadata,
  enrichViewDiff,
} from './diff/engine';
export type {
  ViewDiff,
  FileDiffMetadata,
  SnapshotFileDiff,
  VcsFileDiff,
  LegacyDiff,
  ReviewDiff,
} from './diff/engine';

export {
  estimateTokens,
  breakdownContext,
  toSegments,
  formatTokens,
  formatCost,
} from './context/breakdown';
export type {
  ContextBreakdown,
  BreakdownSegment,
  SessionMetrics,
} from './context/breakdown';
