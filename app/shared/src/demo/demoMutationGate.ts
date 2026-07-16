import {
  getWorkbenchDataModeContract,
  isWorkbenchFixtureDataMode,
  type WorkbenchDataMode,
} from './dataMode';

/**
 * AH-SR-043 — Web/shared demo & preview mutation inventory.
 *
 * Only paths listed here may claim a "success" result without a real Hub/Edge
 * mutation. Product surfaces must fail closed outside explicit mock/fixture.
 */
export const WEB_DEMO_MUTATION_PATH_INVENTORY = [
  {
    id: 'web-platform-submit-composer',
    surface: 'web',
    entry: 'app/web/src/platform/webPlatform.ts#runs.submitComposerIntent',
    demoSink: 'app/shared/src/demo/workbenchDemo.ts#WorkbenchDemoRuntimeStore.submitComposerIntent',
    productionSink: 'Hub sendMessage + /web/agent-tasks (triggerAgentTask)',
    gate: 'allowsWorkbenchDemoRuntimeMutation + explicit demoRuntimeFallback',
    risk: 'Fake private-chat / agent-run success when demo fallback leaks into auto/real modes',
  },
  {
    id: 'desktop-platform-submit-composer',
    surface: 'desktop',
    entry: 'app/desktop/src/platform/desktopPlatform.ts#runs.submitComposerIntent',
    demoSink: 'app/shared/src/demo/workbenchDemo.ts#workbenchDemoRuntimeStore.submitComposerIntent',
    productionSink: 'Local Edge submitRun',
    gate: 'explicit demoRuntimeFallback only when Desktop workbench isDemo',
    risk: 'Fake local execution success without Edge thread',
  },
  {
    id: 'shared-demo-runtime-store',
    surface: 'shared',
    entry: 'app/shared/src/demo/workbenchDemo.ts#createWorkbenchDemoRuntimeStore',
    demoSink: 'in-memory transcript / pin mutations',
    productionSink: 'none (fixture-only store)',
    gate: 'must not be reached from product mutation paths without allowsWorkbenchDemoRuntimeMutation',
    risk: 'Shared demo store used as silent production fallback',
  },
  {
    id: 'shared-mock-platform',
    surface: 'shared-test',
    entry: 'app/shared/src/platform/createMockPlatform.ts#runs.submitComposerIntent',
    demoSink: 'in-memory submittedIntents',
    productionSink: 'none (unit/e2e harness only)',
    gate: 'test harness only; not mounted by product App shells',
    risk: 'None in product if not imported by App',
  },
  {
    id: 'web-chat-actions',
    surface: 'web',
    entry: 'app/web/src/platform/useWebWorkbenchModel.ts#chatActions',
    demoSink: 'none (actions omitted when !hubReady)',
    productionSink: 'Hub pin/edit/recall/forward/reaction APIs',
    gate: 'hubReady requires allowsHubData + authenticated token',
    risk: 'Low — no demo success path when unsigned-out / fixture',
  },
  {
    id: 'web-contact-project-mutations',
    surface: 'web',
    entry: 'app/web/src/platform/useWebWorkbenchModel.ts#contactsActions|projectsActions|onApprovalDecision',
    demoSink: 'none (actions omitted when !hubReady)',
    productionSink: 'Hub contact / workspace-project / approval APIs',
    gate: 'hubReady requires allowsHubData + authenticated token',
    risk: 'Low — empty/undefined actions in fixture modes',
  },
] as const;

export type WebDemoMutationPathId = (typeof WEB_DEMO_MUTATION_PATH_INVENTORY)[number]['id'];

export interface DemoRuntimeMutationGateInput {
  /** Explicit opt-in from the product shell (App). Default false. */
  demoRuntimeFallback?: boolean;
  /** Resolved workbench data mode (env + override). */
  dataMode?: string | WorkbenchDataMode;
  /** When tests inject a Hub client, never take the demo path. */
  hasInjectedHubClient?: boolean;
}

/**
 * Fail-closed gate for demo/fixture composer mutations (AH-SR-043).
 *
 * Demo success is allowed only when:
 * 1. the product shell explicitly enables `demoRuntimeFallback`, and
 * 2. the resolved data mode is mock or fixture (`allowsDemoRuntimeFallback`), and
 * 3. no injected Hub client is forcing the real path.
 *
 * `auto`, `observed`, and `approved-real` never succeed via demo/fixture sinks.
 */
export function allowsWorkbenchDemoRuntimeMutation(
  input: DemoRuntimeMutationGateInput = {},
): boolean {
  if (input.demoRuntimeFallback !== true) return false;
  if (input.hasInjectedHubClient) return false;

  const contract = getWorkbenchDataModeContract(input.dataMode);
  if (!contract.allowsDemoRuntimeFallback) return false;
  if (!isWorkbenchFixtureDataMode(contract.mode)) return false;

  return true;
}

export function demoRuntimeMutationDeniedReason(
  input: DemoRuntimeMutationGateInput = {},
): string | undefined {
  if (allowsWorkbenchDemoRuntimeMutation(input)) return undefined;
  if (input.demoRuntimeFallback !== true) {
    return 'Demo runtime mutations require an explicit demoRuntimeFallback opt-in from the product shell.';
  }
  if (input.hasInjectedHubClient) {
    return 'Injected Hub clients must use the real Hub mutation path.';
  }
  const contract = getWorkbenchDataModeContract(input.dataMode);
  if (!contract.allowsDemoRuntimeFallback || !isWorkbenchFixtureDataMode(contract.mode)) {
    return `Workbench data mode "${contract.mode}" is fail-closed for demo mutations; use mock/fixture explicitly.`;
  }
  return 'Demo runtime mutation denied.';
}
