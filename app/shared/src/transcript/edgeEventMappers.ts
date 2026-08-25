/**
 * Edge event → transcript block mappers public barrel.
 * Residual pure-helper peel of edgeEventMappers (#1124). Pure only; zero behavior change.
 *
 * Implementations live in domain companions; this file re-exports so
 * normalizeEdgeEvents imports from `./edgeEventMappers` remain stable.
 */

export {
  agentTextBlock,
  checkpointBlock,
  outputBatchTextBlock,
  outputTextBlock,
  runCancelledBlock,
  runFailedBlock,
  runFinishedBlock,
  runStatusBlock,
  runTextBlock,
  thinkingBlock,
} from './edgeEventMappersRun';

export {
  agentResultBlock,
  childAgentBlock,
  compactBoundaryBlock,
  contextUsageBlock,
  routeDecisionBlock,
  subagentBlock,
  subtaskBlock,
} from './edgeEventMappersAgents';

export {
  fileChangeBlock,
  toolCallBlock,
  toolResultBlock,
} from './edgeEventMappersTools';

export {
  permissionDecidedBlock,
  permissionRequestedBlock,
} from './edgeEventMappersPermission';

export {
  artifactCreatedBlock,
  previewReadyBlock,
  previewStoppedBlock,
} from './edgeEventMappersArtifacts';
