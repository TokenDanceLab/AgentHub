// Zod schemas for Edge REST API responses.
// Uses safeParse: schema drift logs a warning but never crashes the UI.
import { z } from 'zod';

// ── Health ──────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  edgeId: z.string(),
  checks: z
    .record(
      z.string(),
      z
        .object({
          status: z.string(),
        })
        .catchall(z.unknown()),
    )
    .optional(),
});

// ── Runner ──────────────────────────────────────

export const RunnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['online', 'offline', 'draining']),
  capabilities: z.string().optional(),
});

// ── Agent ───────────────────────────────────────

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalls: z.boolean(),
  fileChanges: z.boolean(),
  thinkingVisible: z.boolean(),
  multiTurn: z.boolean(),
  mcpIntegration: z.boolean(),
  permissionHooks: z.boolean(),
  subAgentSpawn: z.boolean(),
});

export const AgentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(['available', 'unavailable', 'configuring']),
  capabilities: AgentCapabilitiesSchema,
});

// ── Model catalog ───────────────────────────────

export const ModelCatalogItemSchema = z.object({
  id: z.string(),
  value: z.string(),
  label: z.string(),
  provider: z.string().optional(),
  runtimeId: z.string().optional(),
  resolvedModel: z.string().optional(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  status: z.enum(['available', 'configured', 'unavailable']).or(z.string()),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reasoningEfforts: z.array(z.string()).optional(),
  default: z.boolean().optional(),
});

export const ModelCatalogSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['ready', 'configured', 'unavailable']).or(z.string()),
  detail: z.string().optional(),
});

export const ModelCatalogResponseSchema = z.object({
  items: z.array(ModelCatalogItemSchema),
  sources: z.array(ModelCatalogSourceSchema),
});

// ── Page / List ─────────────────────────────────

export const PageInfoSchema = z.object({
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});

export function listResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: PageInfoSchema,
  });
}

// ── Thread ──────────────────────────────────────

export const ThreadInfoSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ThreadItemInfoSchema = z.object({
  itemId: z.string(),
  projectId: z.string(),
  threadId: z.string(),
  runId: z.string().optional(),
  type: z.string(),
  role: z.string().optional(),
  status: z.string(),
  content: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ThreadPinInfoSchema = z.object({
  threadId: z.string(),
  itemId: z.string(),
  pinnedBy: z.string().optional(),
  pinnedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  item: ThreadItemInfoSchema.optional(),
});

// ── Run ─────────────────────────────────────────

export const RunInfoSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  threadId: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

// ── Safe parse helper ───────────────────────────

/**
 * Parse an API response with a Zod schema. On failure, logs a warning
 * and returns the raw data (never throws), so schema drift cannot white-screen the UI.
 */
export const RunDiffFileSchema = z.object({
  path: z.string(),
  diff: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
});

export const RunDiffSchema = z.object({
  runId: z.string(),
  files: z.array(RunDiffFileSchema),
});

export const ArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  kind: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});

export const PreviewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  url: z.string().optional(),
  status: z.enum(['starting', 'ready', 'stopped']),
  createdAt: z.string(),
});

export function safeParse<T>(schema: z.ZodTypeAny, data: unknown, label: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.warn(`[schema] ${label} schema drift detected:`, parsed.error.issues, 'raw:', data);
    return data as T;
  }
  return parsed.data as T;
}
