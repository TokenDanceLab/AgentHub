import type { AnyEvent } from '../events';
import type {
  Approval,
  Artifact,
  ListResponse,
  Preview,
  Project,
  Run,
  RunLogs,
  Runner,
  Thread,
  ThreadItem,
} from '../types';

export type WorkbenchConnectionStatus =
  | 'idle'
  | 'loading'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface WorkbenchSnapshot {
  projects?: ListResponse<Project> | Project[] | null;
  threads?: ListResponse<Thread> | Thread[] | null;
  /**
   * Edge runner diagnostics residual for event/reducer compatibility.
   * Product live catalog must not treat this as inventory SSOT.
   */
  runners?: ListResponse<Runner> | Runner[] | null;
  runs?: ListResponse<Run> | Run[] | null;
  threadItems?: ListResponse<ThreadItem> | ThreadItem[] | null;
  approvals?: ListResponse<Approval> | Approval[] | null;
  artifacts?: ListResponse<Artifact> | Artifact[] | null;
  previews?: ListResponse<Preview> | Preview[] | null;
  runLogs?: RunLogs[] | null;
}

export interface WorkbenchState {
  projects: Project[];
  threads: Thread[];
  /** Diagnostics residual; not product runtime inventory. */
  runners: Runner[];
  runs: Run[];
  threadItems: ThreadItem[];
  approvals: Approval[];
  artifacts: Artifact[];
  previews: Preview[];
  runLogs: Record<string, RunLogs>;
  connection: {
    status: WorkbenchConnectionStatus;
    error?: string;
  };
  lastSeq: number;
}

export type WorkbenchAction =
  | { type: 'snapshot.loaded'; snapshot?: WorkbenchSnapshot | null }
  | { type: 'threadItems.loaded'; threadItems?: ListResponse<ThreadItem> | ThreadItem[] | null }
  | { type: 'connection.loading' }
  | { type: 'connection.connected' }
  | { type: 'connection.disconnected'; error?: string }
  | { type: 'connection.error'; error: string }
  | { type: 'event.received'; event: AnyEvent };

export type WorkbenchSnapshotData = Pick<
  WorkbenchState,
  | 'projects'
  | 'threads'
  | 'runners'
  | 'runs'
  | 'threadItems'
  | 'approvals'
  | 'artifacts'
  | 'previews'
  | 'runLogs'
>;
