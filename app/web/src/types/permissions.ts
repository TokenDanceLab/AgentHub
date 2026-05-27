export interface PermissionRequestItem {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision?: 'allow' | 'deny';
  reason?: string | undefined;
  timestamp: string;
}
