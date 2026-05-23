import { useState, useCallback, useEffect } from 'react';
import type { AgentInfo } from '@shared/types';

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
}

interface UseMentionOptions {
  agents: AgentInfo[];
  /** Called when an agent is selected from the mention popover */
  onSelectAgent: (agentId: string) => void;
}

interface UseMentionReturn extends MentionState {
  /** Call on textarea 'input' events to detect @ triggers */
  handleInput: () => void;
  /** Call on textarea 'keydown' events. Returns true if the event was consumed. */
  handleKeyDown: (e: React.KeyboardEvent<Element>) => boolean;
  /** Select an agent: remove @query text, set selected agent, close popover */
  selectAgent: (agent: AgentInfo) => void;
  /** Close the popover */
  closeMention: () => void;
}

const POPOVER_HEIGHT = 250; // ~max popover height
const POPOVER_OFFSET_Y = 8; // gap above caret line

/**
 * Filters agents by the given query (case-insensitive match on name).
 */
function filterAgents(agents: AgentInfo[], query: string): AgentInfo[] {
  if (!query) return agents;
  const q = query.toLowerCase();
  return agents.filter((a) => a.name.toLowerCase().includes(q));
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
  if (atIndex > 0 && !/\s/.test(textBefore[atIndex - 1])) return null;

  const query = textBefore.substring(atIndex + 1);

  // Query must not contain whitespace (incomplete mention)
  if (/\s/.test(query)) return null;

  return { query, startIndex: atIndex };
}

export function useMention({ agents, onSelectAgent }: UseMentionOptions): UseMentionReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredAgents = filterAgents(agents, query);

  // Reset selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
      setQuery(mention.query);
      setIsOpen(true);
      // Compute position after a frame so textarea layout is up to date
      requestAnimationFrame(() => {
        const caretPos = getCaretViewportPosition(ta);
        setPosition({
          top: caretPos.top - POPOVER_HEIGHT - POPOVER_OFFSET_Y,
          left: caretPos.left,
        });
      });
    } else {
      closeMention();
    }
  }, [closeMention]);

  const selectAgent = useCallback(
    (agent: AgentInfo) => {
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

      // Remove the @query portion (including any preceding space)
      const spaceBefore = atIndex > 0 && ta.value[atIndex - 1] === ' ' ? 1 : 0;
      const start = atIndex - spaceBefore;
      const textAfter = ta.value.substring(cursorPos);
      const newValue = ta.value.substring(0, start) + textAfter;

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

      ta.selectionStart = ta.selectionEnd = start;
      ta.focus();

      // Fire input event so attached listeners (auto-resize, draft save, etc.) run
      ta.dispatchEvent(new Event('input', { bubbles: true }));

      closeMention();
      onSelectAgent(agent.id);
    },
    [closeMention, onSelectAgent],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<Element>): boolean => {
      if (!isOpen || filteredAgents.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredAgents.length - 1));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          return true;
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const agent = filteredAgents[selectedIndex];
          if (agent) selectAgent(agent);
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
    [isOpen, filteredAgents, selectedIndex, selectAgent, closeMention],
  );

  return {
    isOpen,
    query,
    position,
    selectedIndex,
    filteredAgents,
    handleInput,
    handleKeyDown,
    selectAgent,
    closeMention,
  };
}
