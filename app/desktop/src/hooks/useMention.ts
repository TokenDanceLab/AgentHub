import { useState, useCallback } from 'react';
import type { AgentInfo } from '@shared/types';

export type MentionKind = 'agent' | 'file' | 'thread';

export interface MentionItem {
  id: string;
  kind: MentionKind;
  label: string;
  description?: string;
  status?: AgentInfo['status'];
  keywords?: string[];
  replacementText?: string;
  agent?: AgentInfo;
  payload?: unknown;
}

export interface MentionState {
  /** Whether the mention popover is visible */
  isOpen: boolean;
  /** Current query string (text after @, before cursor) */
  query: string;
  /** Pixel position for the popover (relative to viewport, for fixed positioning) */
  position: { top: number; left: number };
  /** Index of the currently highlighted suggestion */
  selectedIndex: number;
  /** Agents filtered by the current query */
  filteredAgents: AgentInfo[];
  /** All mention suggestions filtered by the current query */
  filteredItems: MentionItem[];
}

interface UseMentionOptions {
  agents: AgentInfo[];
  items?: MentionItem[];
  /** Called when an agent is selected from the mention popover */
  onSelectAgent: (agentId: string) => void;
  /** Called after any mention item is selected. */
  onSelectMention?: (item: MentionItem) => void;
}

interface UseMentionReturn extends MentionState {
  /** Call on textarea 'input' events to detect @ triggers */
  handleInput: () => void;
  /** Call on textarea 'keydown' events. Returns true if the event was consumed. */
  handleKeyDown: (e: React.KeyboardEvent<Element>) => boolean;
  /** Select an agent: remove @query text, set selected agent, close popover */
  selectAgent: (agent: AgentInfo) => void;
  /** Select any mention item. */
  selectItem: (item: MentionItem) => void;
  /** Close the popover */
  closeMention: () => void;
}

const POPOVER_HEIGHT = 250; // ~max popover height
const POPOVER_MAX_WIDTH = 360;
const POPOVER_MARGIN = 16;
const POPOVER_OFFSET_Y = 8; // gap above caret line

function clampPopoverToViewport(position: { top: number; left: number }): { top: number; left: number } {
  const maxLeft = Math.max(POPOVER_MARGIN, window.innerWidth - POPOVER_MAX_WIDTH - POPOVER_MARGIN);
  return {
    top: Math.max(POPOVER_MARGIN, position.top),
    left: Math.min(Math.max(POPOVER_MARGIN, position.left), maxLeft),
  };
}

/**
 * Filters agents by the given query (case-insensitive match on name).
 */
function agentToMentionItem(agent: AgentInfo): MentionItem {
  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    label: agent.name,
    description: agent.description,
    status: agent.status,
    keywords: [agent.id, agent.name, 'agent', 'runtime'],
    replacementText: '',
    agent,
  };
}

function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((item) => {
    const haystack = [
      item.kind,
      item.label,
      item.description,
      ...(item.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((part) => haystack.includes(part));
  });
}

/**
 * Compute the pixel position of the textarea caret relative to the viewport.
 * Uses a hidden mirror div to measure text layout.
 */
function getCaretViewportPosition(
  textarea: HTMLTextAreaElement,
): { top: number; left: number } {
  const pos = textarea.selectionStart;
  const mirror = document.createElement('div');
  const cs = window.getComputedStyle(textarea);

  // Copy all layout-relevant styles
  mirror.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    visibility: hidden;
    height: auto;
    width: ${cs.width};
    min-height: ${cs.lineHeight};
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    font-family: ${cs.fontFamily};
    font-size: ${cs.fontSize};
    font-weight: ${cs.fontWeight};
    font-style: ${cs.fontStyle};
    letter-spacing: ${cs.letterSpacing};
    line-height: ${cs.lineHeight};
    text-transform: ${cs.textTransform};
    word-spacing: ${cs.wordSpacing};
    text-indent: ${cs.textIndent};
    padding-top: ${cs.paddingTop};
    padding-right: ${cs.paddingRight};
    padding-bottom: ${cs.paddingBottom};
    padding-left: ${cs.paddingLeft};
    border-top-width: ${cs.borderTopWidth};
    border-right-width: ${cs.borderRightWidth};
    border-bottom-width: ${cs.borderBottomWidth};
    border-left-width: ${cs.borderLeftWidth};
    border-style: solid;
    border-color: transparent;
    box-sizing: ${cs.boxSizing};
  `;

  const textBefore = textarea.value.substring(0, pos);
  mirror.textContent = textBefore;

  // Append a marker span at the cursor
  const marker = document.createElement('span');
  marker.textContent = '​'; // zero-width space
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();

  document.body.removeChild(mirror);

  // Caret position relative to textarea top-left
  const caretTop = markerRect.top - mirrorRect.top;
  const caretLeft = markerRect.left - mirrorRect.left;

  return {
    top: textareaRect.top + textarea.scrollTop + caretTop,
    left: textareaRect.left + caretLeft,
  };
}

/**
 * Given the textarea value and cursor position, extract the active @mention query.
 * Returns the query string and its start index, or null if no active mention.
 */
function parseMentionAtCursor(
  value: string,
  cursorPos: number,
): { query: string; startIndex: number } | null {
  const textBefore = value.substring(0, cursorPos);
  const atIndex = textBefore.lastIndexOf('@');

  if (atIndex === -1) return null;

  // @ must be at start or preceded by whitespace
  const previousChar = atIndex > 0 ? textBefore[atIndex - 1] : undefined;
  if (previousChar && !/\s/.test(previousChar)) return null;

  const query = textBefore.substring(atIndex + 1);

  // Query must not contain whitespace (incomplete mention)
  if (/\s/.test(query)) return null;

  return { query, startIndex: atIndex };
}

export function useMention({ agents, items, onSelectAgent, onSelectMention }: UseMentionOptions): UseMentionReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allItems = items ?? agents.map(agentToMentionItem);
  const filteredItems = filterMentionItems(allItems, query);
  const filteredAgents = filteredItems
    .filter((item) => item.kind === 'agent' && item.agent)
    .map((item) => item.agent as AgentInfo);
<<<<<<< HEAD
=======

  // Reset selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

  const closeMention = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const handleInput = useCallback(() => {
    const ta = document.activeElement as HTMLTextAreaElement | null;
    if (!ta || ta.tagName !== 'TEXTAREA') return;

    const cursorPos = ta.selectionStart;
    const mention = parseMentionAtCursor(ta.value, cursorPos);

    if (mention) {
      const caretPos = getCaretViewportPosition(ta);
      setQuery(mention.query);
<<<<<<< HEAD
      setSelectedIndex(0);
=======
      setPosition(clampPopoverToViewport({
        top: caretPos.top - POPOVER_HEIGHT - POPOVER_OFFSET_Y,
        left: caretPos.left,
      }));
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
      setIsOpen(true);
    } else {
      closeMention();
    }
  }, [closeMention]);

  const selectItem = useCallback(
    (item: MentionItem) => {
      const ta = document.activeElement as HTMLTextAreaElement | null;
      if (!ta || ta.tagName !== 'TEXTAREA') {
        closeMention();
        return;
      }

      const cursorPos = ta.selectionStart;
      const textBefore = ta.value.substring(0, cursorPos);
      const atIndex = textBefore.lastIndexOf('@');

      if (atIndex === -1) {
        closeMention();
        return;
      }

      // Replace the @query portion. Agent/file items remove the token; thread
      // items insert an explicit reference that is sent to the runtime.
      const replacement = item.replacementText ?? '';
      const removesToken = replacement.length === 0;
      const spaceBefore = removesToken && atIndex > 0 && ta.value[atIndex - 1] === ' ' ? 1 : 0;
      const start = atIndex - spaceBefore;
      const textAfter = ta.value.substring(cursorPos);
      const prefix = ta.value.substring(0, start);
      const needsSpaceAfter =
        replacement.length > 0 && textAfter.length > 0 && !/\s$/.test(replacement) && !/^\s/.test(textAfter);
      const trailingSpace = replacement.length > 0 && textAfter.length === 0 ? ' ' : '';
      const newValue = `${prefix}${replacement}${needsSpaceAfter ? ' ' : trailingSpace}${textAfter}`;
      const nextCursor = prefix.length + replacement.length + (needsSpaceAfter || trailingSpace.length > 0 ? 1 : 0);

      // Use native setter to avoid React controlled/uncontrolled conflicts
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(ta, newValue);
      } else {
        ta.value = newValue;
      }

      ta.selectionStart = ta.selectionEnd = nextCursor;
      ta.focus();

      // Fire input event so attached listeners (auto-resize, draft save, etc.) run
      ta.dispatchEvent(new Event('input', { bubbles: true }));

      closeMention();
      if (item.kind === 'agent' && item.agent) onSelectAgent(item.agent.id);
      onSelectMention?.(item);
    },
    [closeMention, onSelectAgent, onSelectMention],
  );

  const selectAgent = useCallback(
    (agent: AgentInfo) => {
      selectItem(agentToMentionItem(agent));
    },
    [selectItem],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<Element>): boolean => {
      if (!isOpen || filteredItems.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          return true;
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const item = filteredItems[selectedIndex];
          if (item) selectItem(item);
          return true;
        }
        case 'Escape':
          e.preventDefault();
          closeMention();
          return true;
        default:
          return false;
      }
    },
    [isOpen, filteredItems, selectedIndex, selectItem, closeMention],
  );

  return {
    isOpen,
    query,
    position,
    selectedIndex,
    filteredAgents,
    filteredItems,
    handleInput,
    handleKeyDown,
    selectAgent,
    selectItem,
    closeMention,
  };
}
