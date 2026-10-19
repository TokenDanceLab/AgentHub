/* ═══════════════════════════════════════════════════════════════════════
   TRANSCRIPT EVENT TYPES — context-menu and pointer event shapes used by
   AgentHubWorkbench.
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
