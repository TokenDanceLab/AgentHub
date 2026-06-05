import { useMemo } from 'react';
import type { RunInfo } from '@shared/types';
import type { InspectorTab, ToolCallEntry, TaskPlanItem, ArtifactEntry, ChangedFileEntry, TreeNode } from '@/components/RightInspector';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';
import type { FileDiff } from '@/components/ChatView.types';

export interface RightInspectorData {
  activeTab: InspectorTab;
  run: RunInfo | null;
  onCancel?: () => void;
  approvals: PermissionRequestItem[];
  onDecideApproval?: (requestId: string, decision: 'allow' | 'deny') => Promise<void> | void;
  tasks: TaskPlanItem[];
  teamName?: string;
  teamMembers?: number;
  activeTaskCount?: number;
  toolCalls: ToolCallEntry[];
  artifacts: ArtifactEntry[];
  changedFiles: ChangedFileEntry[];
  diffs: FileDiff[];
  outputText?: string;
  workDir?: string;
  fileTree: TreeNode[];
  onFileSelect?: (path: string) => void;
}

export function useRightInspectorData(): RightInspectorData {
  return useMemo(() => ({
    activeTab: 'progress',
    run: null,
    approvals: [],
    tasks: [],
    toolCalls: [],
    artifacts: [],
    changedFiles: [],
    diffs: [],
    fileTree: [],
  }), []);
}
