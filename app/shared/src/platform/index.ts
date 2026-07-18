export { createMockPlatform, createMockTerminalPort } from './createMockPlatform';
export { resolveEvidencePreviewTarget } from './previewTargets';
export type { MockPlatform, MockPlatformSeed, MockTerminalPort } from './createMockPlatform';
export type {
  AgentHubPlatform,
  AgentHubSurface,
  AttachmentPort,
  ConversationKind,
  ConversationPort,
  HostDiagnosticsPort,
  LocalCliDiscoveryItem,
  LocalCliDiscoveryManifest,
  LocalCliRuntimeId,
  PreviewPort,
  RunPort,
  RuntimeSessionSummary,
  SurfaceCapabilities,
  TerminalPort,
  TerminalResizePayload,
  TerminalSession,
  TerminalSessionId,
  TerminalSessionStatus,
  TerminalSpawnOptions,
  TerminalWritePayload,
  WorkbenchAgent,
  WorkbenchConversation,
} from './types';
