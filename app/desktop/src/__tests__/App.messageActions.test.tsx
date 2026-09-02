// #2154 P1-A: Desktop already owns the Hub pin/unpin/recall mutations
// (useDesktopWorkbenchModel → DesktopChatActions), but App.tsx never forwarded
// them into the shared workbench deps. The context menu gate only checked
// `Boolean(sessionId)`, so Desktop rendered pin/unpin/recall entries whose
// clicks were dropped silently by the effect dispatcher.
//
// This suite pins the forwarding contract: every port Desktop can back must be
// handed to <AgentHubWorkbench>, and every port it cannot back must stay
// undefined so the workbench menu keeps the entry hidden (fail-closed).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopWorkbenchApp } from '@/App';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import type { DesktopChatActions, DesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import type { TranscriptBlock } from '@shared/transcript';

const captured = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@agenthub/workbench', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AgentHubWorkbench: (props: Record<string, unknown>) => {
      captured.props = props;
      return null;
    },
  };
});

vi.mock('@/platform/useDesktopWorkbenchModel', () => ({
  useDesktopWorkbenchModel: vi.fn(),
}));

vi.mock('@/platform/desktopPlatform', () => ({
  createDesktopPlatform: vi.fn(() => ({})),
}));

vi.mock('@/platform/edgeCapabilityMapper', () => ({
  mapEdgeAgentsToWorkbenchAgents: vi.fn(() => []),
}));

vi.mock('@/platform/desktopWorkbenchProjectsPort', () => ({
  createDesktopWorkbenchProjectsPort: vi.fn(() => ({})),
}));

vi.mock('@/hooks/useHealth', () => ({
  useHealth: vi.fn(() => ({ online: true, health: { status: 'ok', version: 'test' }, lastError: null, refetch: vi.fn() })),
}));

vi.mock('@/api/agentQueries', () => ({
  useAgentList: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/api/modelCatalogQueries', () => ({
  useModelCatalog: vi.fn(() => ({ data: undefined })),
  useCCSwitchStatus: vi.fn(() => ({ data: undefined })),
  useCCSwitchProviders: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/api/agentProfileQueries', () => ({
  useAgentProfileList: vi.fn(() => ({ data: undefined, error: null, isFetching: false, refetch: vi.fn() })),
  useHubAgentProfiles: vi.fn(() => ({ data: undefined, error: null, refetch: vi.fn() })),
  useCreateAgentProfile: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateAgentProfile: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteAgentProfile: vi.fn(() => ({ mutateAsync: vi.fn() })),
  edgeAgentProfileToWorkbenchAgent: vi.fn((profile: unknown) => profile),
  hubAgentProfileToWorkbenchAgent: vi.fn((profile: unknown) => profile),
}));

vi.mock('@/api/runQueries', () => ({
  useCreateRun: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useCancelRun: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useRuns: vi.fn(() => ({ data: undefined })),
  useDecideEdgePermission: vi.fn(() => ({ mutateAsync: vi.fn() })),
  findActiveEdgeRun: vi.fn(() => undefined),
}));

vi.mock('@/api/threadQueries', () => ({
  useCreateThread: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useThreads: vi.fn(() => ({ data: undefined })),
  useCurrentUser: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/api/documentQueries', () => ({
  useDocumentList: vi.fn(() => ({ data: undefined, error: null })),
  useCreateDocument: vi.fn(() => ({ mutateAsync: vi.fn() })),
  hubDocToDocRow: vi.fn((doc: unknown) => doc),
}));

vi.mock('@/api/hubQueries', () => ({
  getHubClient: vi.fn(() => ({
    listPublicSkills: vi.fn(() => Promise.resolve({ items: [] })),
    listPublicMCPServers: vi.fn(() => Promise.resolve({ items: [] })),
  })),
}));

vi.mock('@/api/executionTargetQueries', () => ({
  useHubExecutionTargets: vi.fn(() => ({ data: undefined, error: null, isFetching: false, refetch: vi.fn() })),
  usePingHubExecutionTarget: vi.fn(() => ({ mutate: vi.fn(), isPending: false, variables: null })),
}));

vi.mock('@/api/agentTeamQueries', () => ({
  useDecideTeamApproval: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useTokenUsageBoard: vi.fn(() => ({ data: undefined, isFetching: false, error: null, refetch: vi.fn() })),
}));

vi.mock('@/api/runEvidenceQueries', () => ({
  useRunEvidence: vi.fn(() => ({
    diffs: [], artifacts: [], previews: [],
    diffLoading: false, artifactLoading: false, previewLoading: false,
    diffError: null, artifactError: null, previewError: null,
    diffSource: null, artifactSource: null, previewSource: null,
  })),
}));

vi.mock('@/demo/demoEvidence', () => ({
  getDemoRuntimeEvidence: vi.fn(() => undefined),
}));

vi.mock('@shared/ui/toast', () => ({
  useToastStore: vi.fn((selector?: (s: { showToast: () => void }) => unknown) => (
    typeof selector === 'function' ? selector({ showToast: vi.fn() }) : { showToast: vi.fn() }
  )),
  ToastContainer: () => null,
}));

const pinMessage = vi.fn(() => Promise.resolve(undefined));
const unpinMessage = vi.fn(() => Promise.resolve(undefined));
const recallMessage = vi.fn(() => Promise.resolve(undefined));
const editMessage = vi.fn(() => Promise.resolve(undefined));
const sendMessage = vi.fn(() => Promise.resolve(undefined));
const markRead = vi.fn(() => Promise.resolve(undefined));

function transcriptFixture(): TranscriptBlock[] {
  const base = { kind: 'text' as const, createdAt: '2026-01-01T00:00:00.000Z' };
  return [
    {
      ...base,
      id: 'hub-message-agent-1',
      text: 'agent reply',
      author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    },
    {
      ...base,
      id: 'hub-message-m1',
      text: 'my message',
      author: { id: 'u1', role: 'human', name: 'You' },
    },
  ];
}

function modelFixture(chatActions?: DesktopChatActions): DesktopWorkbenchModel {
  return {
    activeConversationId: 'sess-1',
    agents: [],
    conversations: [{ id: 'sess-1', title: 'Hub session', kind: 'direct' }],
    dataMode: 'live',
    isDemo: false,
    transcript: transcriptFixture(),
    ...(chatActions ? { chatActions } : {}),
  } as unknown as DesktopWorkbenchModel;
}

function hubChatActions(): DesktopChatActions {
  return {
    sendMessage,
    recallMessage,
    editMessage,
    pinMessage,
    unpinMessage,
    markRead,
  } as unknown as DesktopChatActions;
}

const mockedModel = vi.mocked(useDesktopWorkbenchModel);
const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderWorkbench(): void {
  render(
    <QueryClientProvider client={testQueryClient}>
      <DesktopWorkbenchApp />
    </QueryClientProvider>,
  );
}

function workbenchProps(): Record<string, unknown> {
  if (!captured.props) throw new Error('AgentHubWorkbench was not rendered');
  return captured.props;
}

describe('Desktop App message action ports (#2154)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.props = undefined;
    testQueryClient.clear();
  });

  it('forwards the Hub pin/unpin/recall ports with the block-id prefix stripped', async () => {
    const chatActions = hubChatActions();
    mockedModel.mockReturnValue(modelFixture(chatActions));
    renderWorkbench();

    const props = workbenchProps();
    const onPinMessage = props.onPinMessage as
      | ((messageId: string, sessionId: string) => Promise<void> | void)
      | undefined;
    const onUnpinMessage = props.onUnpinMessage as
      | ((messageId: string, sessionId: string) => Promise<void> | void)
      | undefined;
    const onRecallMessage = props.onRecallMessage as
      | ((messageId: string) => Promise<void> | void)
      | undefined;

    expect(onPinMessage, 'onPinMessage must reach the workbench deps').toBeTypeOf('function');
    expect(onUnpinMessage, 'onUnpinMessage must reach the workbench deps').toBeTypeOf('function');
    expect(onRecallMessage, 'onRecallMessage must reach the workbench deps').toBeTypeOf('function');

    // The workbench hands over transcript block ids (`hub-message-<id>`); the
    // Hub REST port needs the bare message id (same contract as onEditMessage).
    await onPinMessage?.('hub-message-m1', 'sess-1');
    expect(pinMessage).toHaveBeenCalledWith('m1', 'sess-1');
    await onUnpinMessage?.('hub-message-m1', 'sess-1');
    expect(unpinMessage).toHaveBeenCalledWith('m1', 'sess-1');
    await onRecallMessage?.('hub-message-m1');
    expect(recallMessage).toHaveBeenCalledWith('m1');
  });

  it('leaves the ports Desktop cannot back undefined so the menu hides them', () => {
    mockedModel.mockReturnValue(modelFixture(hubChatActions()));
    renderWorkbench();

    const props = workbenchProps();
    // No Desktop mutation exists for these three (forward needs a
    // useHubForwardMessage port, regenerate a Hub task port, react a reaction
    // port). Undefined props keep the entries out of the menu (#2154
    // fail-closed) instead of rendering a click the dispatcher would drop.
    expect(props.onForwardMessage).toBeUndefined();
    expect(props.onRegenerate).toBeUndefined();
    expect(props.onAddMessageReaction).toBeUndefined();
  });

  it('withholds every message port when Hub chat actions are unavailable', () => {
    mockedModel.mockReturnValue(modelFixture(undefined));
    renderWorkbench();

    const props = workbenchProps();
    expect(props.onPinMessage).toBeUndefined();
    expect(props.onUnpinMessage).toBeUndefined();
    expect(props.onRecallMessage).toBeUndefined();
    expect(props.onEditMessage).toBeUndefined();
  });
});
