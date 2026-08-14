/**
 * MemoryFileManager — reads and writes AgentHub memory files from disk.
 *
 * Memory files live under `{workspace}/.agenthub/memory/` and use a Markdown
 * format with YAML frontmatter for metadata:
 *
 * ```markdown
 * ---
 * id: mem_abc123
 * created: 2026-06-10T12:00:00Z
 * updated: 2026-06-10T12:30:00Z
 * tags: [setup, preferences]
 * source: user
 * ---
 *
 * The user prefers dark theme and always wants Claude Sonnet for code reviews.
 * ```
 *
 * Multiple entries in a single file are separated by a `---` line with
 * frontmatter on each section.
 *
 * This module provides pure functions for serialisation and deserialization.
 * Actual file I/O is handled by the Edge server (Go) for production use,
 * and by the browser/Desktop runtime for local workspace access.
 */

import type {
  MemoryEntry,
  MemoryFrontmatter,
  AgentMemory,
} from './types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Separator between entries in a memory Markdown file. */
const ENTRY_SEPARATOR = '---';

/** Maximum content length per entry (64 KiB). */
const MAX_ENTRY_CONTENT_LENGTH = 65536;

/** Maximum number of tags per entry. */
const MAX_TAGS_PER_ENTRY = 20;

/** Maximum tag length. */
const MAX_TAG_LENGTH = 64;

// ── ID Generation ────────────────────────────────────────────────────────────

/**
 * Generate a unique memory entry ID.
 * Format: `mem_{8-char-hex}_{timestamp-ms-base36}`
 */
export function generateMemoryId(): string {
  const hex = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  const ts = Date.now().toString(36);
  return `mem_${hex}_${ts}`;
}

// ── Serialisation: Entry → Markdown ──────────────────────────────────────────

/**
 * Serialise a single MemoryEntry to a Markdown section with YAML frontmatter.
 */
export function serialiseEntry(entry: MemoryEntry): string {
  const tags = entry.tags && entry.tags.length > 0
    ? `[${entry.tags.map(escapeTag).join(', ')}]`
    : '';

  const frontmatter = [
    `id: ${entry.id}`,
    `created: ${entry.createdAt}`,
    `updated: ${entry.updatedAt}`,
    ...(tags ? [`tags: ${tags}`] : []),
    `source: ${entry.source}`,
  ].join('\n');

  return `${ENTRY_SEPARATOR}\n${frontmatter}\n${ENTRY_SEPARATOR}\n\n${entry.content}`;
}

/**
 * Serialise an array of MemoryEntry objects to a complete memory Markdown file.
 */
export function serialiseMemoryFile(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  return entries.map(serialiseEntry).join('\n\n');
}

// ── Deserialization: Markdown → Entry ────────────────────────────────────────

/**
 * Parse a memory Markdown file into an array of MemoryEntry objects.
 *
 * The file is expected to contain one or more sections separated by `---` lines
 * with YAML frontmatter. Returns an empty array for empty or unparseable files.
 */
export function parseMemoryFile(content: string): MemoryEntry[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const entries: MemoryEntry[] = [];
  // Split on `---\n` boundaries (YAML frontmatter delimiters).
  // Each entry starts with ---\n{yaml}\n---\n{markdown content}
  const sections = splitIntoSections(trimmed);

  for (const section of sections) {
    const entry = parseSection(section);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Split a memory file content into individual entry sections.
 * Each section starts with `---`, contains YAML frontmatter, then `---`, then body.
 */
function splitIntoSections(content: string): string[] {
  const sections: string[] = [];
  // Match ---\n...yaml...\n---\n...body...
  // The body extends until the next --- at the start of a line (or end of file).
  const entryPattern = /^---\n([\s\S]*?)\n---\n([\s\S]*?)(?=^---\n|\s*$)/gm;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(content)) !== null) {
    sections.push(match[0]);
  }

  return sections;
}

/**
 * Parse a single entry section into a MemoryEntry.
 */
function parseSection(section: string): MemoryEntry | null {
  // Extract frontmatter and body.
  const match = section.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const [, yamlBlock, body] = match;
  if (!yamlBlock || !body) {
    return null;
  }
  const fm = parseYamlFrontmatter(yamlBlock);
  if (!fm) {
    return null;
  }

  const content = body.trim();
  if (!content) {
    return null;
  }

  return {
    id: fm.id,
    content,
    tags: fm.tags,
    createdAt: fm.created,
    updatedAt: fm.updated,
    source: fm.source,
  };
}

/**
 * Minimal YAML frontmatter parser. Only handles the flat key-value format
 * used by memory files. No nested objects, no flow collections beyond simple
 * inline arrays like `[a, b, c]`.
 */
function parseYamlFrontmatter(yaml: string): MemoryFrontmatter | null {
  const lines = yaml.split('\n');
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  if (!fields.id || !fields.created || !fields.updated || !fields.source) {
    return null;
  }

  const source = fields.source as MemoryEntry['source'];
  if (source !== 'user' && source !== 'agent' && source !== 'system') {
    return null;
  }

  let tags: string[] | undefined;
  if (fields.tags) {
    // Parse [tag1, tag2, ...] format.
    const tagStr = fields.tags;
    if (tagStr.startsWith('[') && tagStr.endsWith(']')) {
      tags = tagStr
        .slice(1, -1)
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
    }
  }

  return {
    id: fields.id,
    created: fields.created,
    updated: fields.updated,
    tags,
    source,
  };
}

function escapeTag(tag: string): string {
  // Escape commas and brackets in tags.
  return tag.replace(/[,()[\]{}]/g, '\\$&');
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a memory entry before writing.
 * Returns an array of validation errors (empty if valid).
 */
export function validateEntry(entry: Partial<MemoryEntry>): string[] {
  const errors: string[] = [];

  if (!entry.id || entry.id.trim() === '') {
    errors.push('id is required');
  }

  if (!entry.content || entry.content.trim() === '') {
    errors.push('content is required');
  } else if (entry.content.length > MAX_ENTRY_CONTENT_LENGTH) {
    errors.push(`content exceeds maximum length of ${MAX_ENTRY_CONTENT_LENGTH} characters`);
  }

  if (entry.tags) {
    if (entry.tags.length > MAX_TAGS_PER_ENTRY) {
      errors.push(`too many tags (max ${MAX_TAGS_PER_ENTRY})`);
    }
    for (const tag of entry.tags) {
      if (tag.length > MAX_TAG_LENGTH) {
        errors.push(`tag "${tag.slice(0, 20)}..." exceeds maximum length of ${MAX_TAG_LENGTH}`);
      }
    }
  }

  if (entry.source && !['user', 'agent', 'system'].includes(entry.source)) {
    errors.push(`invalid source "${entry.source}"`);
  }

  return errors;
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge multiple memory files into a single AgentMemory aggregate.
 */
export function mergeMemory(
  project: MemoryEntry[],
  threads: Record<string, MemoryEntry[]>,
  agents: Record<string, MemoryEntry[]>,
): AgentMemory {
  return {
    project: [...project],
    threads: { ...threads },
    agents: { ...agents },
  };
}

// ── Prompt Formatting ────────────────────────────────────────────────────────

/**
 * Format memory entries into a prompt-suitable text block.
 *
 * Output format:
 * ```
 * [AgentHub Memory - project]
 * - {entry content}
 *
 * [AgentHub Memory - thread abc123]
 * - {entry content}
 * ```
 */
export function formatMemoryPrompt(memory: AgentMemory): string {
  const sections: string[] = [];

  if (memory.project.length > 0) {
    sections.push('[AgentHub Memory - project]');
    for (const entry of memory.project) {
      sections.push(formatEntryForPrompt(entry));
    }
  }

  for (const [threadId, entries] of Object.entries(memory.threads)) {
    if (entries.length > 0) {
      sections.push(`[AgentHub Memory - thread ${threadId}]`);
      for (const entry of entries) {
        sections.push(formatEntryForPrompt(entry));
      }
    }
  }

  for (const [agentId, entries] of Object.entries(memory.agents)) {
    if (entries.length > 0) {
      sections.push(`[AgentHub Memory - agent ${agentId}]`);
      for (const entry of entries) {
        sections.push(formatEntryForPrompt(entry));
      }
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return sections.join('\n\n') + '\n[End of AgentHub Memory]';
}

/**
 * Format a single entry for prompt injection.
 */
function formatEntryForPrompt(entry: MemoryEntry): string {
  const tagLine = entry.tags && entry.tags.length > 0
    ? ` (${entry.tags.join(', ')})`
    : '';
  return `- [${entry.source}${tagLine}] ${entry.content}`;
}

// ── Token Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate the number of tokens in a string using the chars/4 heuristic.
 * Matches the Go implementation in runnerctx.EstimateTokens.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

// ── File Path Helpers ────────────────────────────────────────────────────────

/**
 * Build the filesystem path for a memory file.
 */
export function memoryFilePath(
  workspacePath: string,
  fileName: string,
): string {
  // Use forward slashes for consistency (works on Windows too).
  const normalized = workspacePath.replace(/\\/g, '/');
  return `${normalized}/.agenthub/memory/${fileName}`;
}

/**
 * Build the filesystem path for the memory directory.
 */
export function memoryDirPath(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, '/');
  return `${normalized}/.agenthub/memory`;
}
