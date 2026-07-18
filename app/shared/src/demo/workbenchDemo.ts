/**
 * Workbench demo public barrel.
 * Residual pure-helper peel of workbenchDemo (#1131). Pure only; zero behavior change.
 *
 * Implementations live in domain companions; this file re-exports so
 * consumers importing from `./workbenchDemo` / `@shared/demo` remain stable.
 */

export type {
  WorkbenchDemoMessagePin,
  WorkbenchDemoRuntimeStore,
  WorkbenchDemoStore,
  WorkbenchDemoSurface,
} from './workbenchDemoTypes';

export { WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID } from './workbenchDemoTypes';

export { demoWorkbenchAgents } from './workbenchDemoAgents';

export {
  demoWorkbenchPins,
  projectGroupMessageLoopHubMessages,
  projectGroupMessageLoopTranscript,
} from './workbenchDemoMessages';

export {
  createWorkbenchDemoRuntimeStore,
  createWorkbenchDemoStore,
  resolveDemoWorkbenchTranscript,
  whenChatviewTranscriptsReady,
  workbenchDemoRuntimeStore,
} from './workbenchDemoStore';
