/* ═══════════════════════════════════════════════════════════════════════
   TRANSCRIPT EVENT TYPES — extracted from former TranscriptView.tsx
   Still used by AgentHubWorkbench for context menu + pointer handlers.
   The old TranscriptView component + block renderers have been retired.
   ══════════════════════════════════════════════════════════════════════ */

export interface TranscriptContextMenuEvent {
  preventDefault: () => void
  clientX: number
  clientY: number
}

export interface TranscriptPointerEvent {
  preventDefault: () => void
  clientX: number
  clientY: number
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: EventTarget | null
  currentTarget: HTMLElement
}
