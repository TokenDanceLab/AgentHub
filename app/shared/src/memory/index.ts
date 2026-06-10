/**
 * Agent Memory — filesystem-based memory module for AgentHub.
 *
 * @module memory
 */

export type {
  MemorySource,
  MemoryEntry,
  AgentMemory,
  MemoryFrontmatter,
  MemoryReadResult,
  MemoryWriteRequest,
  MemoryApiResponse,
} from './types';

export {
  AGENTHUB_DIR,
  MEMORY_DIR,
  MEMORY_FILES,
} from './types';

export {
  generateMemoryId,
  serialiseEntry,
  serialiseMemoryFile,
  parseMemoryFile,
  validateEntry,
  mergeMemory,
  formatMemoryPrompt,
  estimateTokens,
  memoryFilePath,
  memoryDirPath,
} from './MemoryFileManager';
