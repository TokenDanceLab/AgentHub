/**
 * Agent Memory — filesystem-based memory model for AgentHub.
 *
 * Memory is stored as Markdown files on disk under `.agenthub/memory/`:
 *   - project.md           — project-level facts shared across all threads
 *   - thread_{threadId}.md  — thread-specific context
 *   - agent_{agentId}.md    — agent-specific preferences
 *
 * File format uses YAML frontmatter for metadata + Markdown body for content.
 */

// ── Entry Types ──────────────────────────────────────────────────────────────

/** Source of a memory entry — who created it. */
export type MemorySource = 'user' | 'agent' | 'system';

/** A single memory entry stored in a memory file. */
export interface MemoryEntry {
  /** Unique entry ID (e.g. "mem_abc123"). */
  id: string;
  /** The memory content as Markdown text. */
  content: string;
  /** Optional tags for categorisation and search. */
  tags?: string[];
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of last update. */
  updatedAt: string;
  /** Who created this entry. */
  source: MemorySource;
}

// ── Aggregate Types ──────────────────────────────────────────────────────────

/**
 * The complete memory state for a workspace, aggregating entries from all
 * memory files under `.agenthub/memory/`.
 *
 * This is the in-memory representation used by the UI and API layer.
 * On disk, each category is a separate Markdown file.
 */
export interface AgentMemory {
  /** Project-level facts shared across all threads. */
  project: MemoryEntry[];
  /** Thread-specific context, keyed by thread ID. */
  threads: Record<string, MemoryEntry[]>;
  /** Agent-specific preferences, keyed by agent ID. */
  agents: Record<string, MemoryEntry[]>;
}

// ── File Paths ───────────────────────────────────────────────────────────────

/** Directory name inside a workspace that holds AgentHub state. */
export const AGENTHUB_DIR = '.agenthub';

/** Subdirectory for memory files. */
export const MEMORY_DIR = 'memory';

/** Well-known memory file names. */
export const MEMORY_FILES = {
  project: 'project.md',
  thread: (threadId: string) => `thread_${threadId}.md`,
  agent: (agentId: string) => `agent_${agentId}.md`,
} as const;

// ── YAML Frontmatter Types ───────────────────────────────────────────────────

/**
 * The YAML frontmatter block at the top of each memory entry in a Markdown file.
 * Multiple entries in a single file are separated by a `---` horizontal rule
 * with frontmatter on each section.
 */
export interface MemoryFrontmatter {
  id: string;
  created: string;
  updated: string;
  tags?: string[];
  source: MemorySource;
}

// ── Memory Read Result (Edge → Frontend) ─────────────────────────────────────

/**
 * Result returned by the Edge memory reader when reading memory files from disk.
 * Contains the formatted memory text ready for injection into agent prompts,
 * plus metadata about what was read.
 */
export interface MemoryReadResult {
  /** All entries that were successfully read. */
  entries: MemoryEntry[];
  /** Formatted Markdown text suitable for system prompt injection. */
  promptText: string;
  /** Total estimated tokens in the prompt text. */
  estimatedTokens: number;
  /** Number of files that were read. */
  filesRead: number;
  /** Any warnings encountered during reading (missing dir, parse errors). */
  warnings: string[];
}

// ── Memory Write Request ─────────────────────────────────────────────────────

/** Request to write or update memory entries. */
export interface MemoryWriteRequest {
  /** Target category. */
  category: 'project' | 'thread' | 'agent';
  /** Target ID (thread or agent ID). Empty for project. */
  targetId?: string;
  /** Entries to write. Existing entries with matching IDs are updated. */
  entries: MemoryEntry[];
}

// ── API Contract ─────────────────────────────────────────────────────────────

/** Response from the Edge API for reading memory. */
export interface MemoryApiResponse {
  /** The memory read result. */
  memory: MemoryReadResult;
  /** The workspace path that was read. */
  workspacePath: string;
}
