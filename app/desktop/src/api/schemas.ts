// Zod schemas for Edge REST API responses.
// Uses safeParse: schema drift logs a warning but never crashes the UI.
import { z } from 'zod';

// ── Health ──────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  edgeId: z.string(),
});

// ── Runner ──────────────────────────────────────

export const RunnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  capabilities: z.string().optional(),
});

// ── Agent ───────────────────────────────────────

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalls: z.boolean(),
  fileChanges: z.boolean(),
  thinkingVisible: z.boolean(),
  multiTurn: z.boolean(),
});

export const AgentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(['available', 'unavailable', 'configuring']),
  capabilities: AgentCapabilitiesSchema,
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
export function safeParse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.warn(`[schema] ${label} schema drift detected:`, parsed.error.issues, 'raw:', data);
    return data as T;
  }
  return parsed.data;
}
