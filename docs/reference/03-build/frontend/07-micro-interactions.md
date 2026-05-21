# AgentHub Micro-Interaction Design Specification

> Cross-reference: kanna.md (typing animation, draining indicator), claude-code-webui.md (UnifiedMessageProcessor dual-mode streaming), design-desktop-ux.md (Progressive Disclosure 4-layer, animation curves), deep-dive-librechat-message-tree.md (SSE streaming, memo strategy)
> Date: 2026-05-21 | Status: Draft v1.0

---

## 1. Streaming Text Animation (Typewriter)

### 1.1 Source Analysis

| Project | Strategy | Granularity | Cursor |
|---------|----------|-------------|--------|
| Kanna | `useEmptyStateTyping` 逐字渲染 | Character-level | Blinking `|` |
| claude-code-webui | UnifiedMessageProcessor: 首片段创建消息,后续 `updateLastMessage(content+delta)` | Chunk-level (SDK message) | None |
| LibreChat | SSE `unfinished: true`, re-render per event | Chunk-level | None |
| **AgentHub** | Adaptive dual-mode | <50 chars → char-by-char; >=50 → whole chunk | `▍` blink, removed 200ms post-done |

### 1.2 Specification

```
State Machine: IDLE → STREAMING_START → STREAMING → STREAMING_DONE → IDLE

Rules:
  - First chunk < 50 chars: 30ms interval per char (typewriter feel, common in thinking phases)
  - Subsequent chunks >= 50 chars: append instantly (no artificial slowdown on fast output)
  - Cursor: `▍` Unicode block, CSS `animation: blink 1s step-end infinite`, accent color
  - 16ms debounce (Kanna pattern): coalesce multiple stream events into single React render
  - Cursor removal: 200ms grace period after STREAMING_DONE
```

```css
.streaming-cursor::after { content: '▍'; animation: cursor-blink 1s step-end infinite; }
@keyframes cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
```

---

## 2. Thinking Block Loading Animation

### 2.1 Source Analysis

| Project | Thinking Display | Loading |
|---------|-----------------|---------|
| Kanna | No separation | Draining spinner |
| claude-code-webui | `processSystemMessage` init/non-init | None |
| **AgentHub** | L1 Progressive Disclosure, collapsed by default | Pulsing dots + elapsed counter |

### 2.2 Specification

```
States: THINKING_ACTIVE → THINKING_DONE → THINKING_EXPANDED

THINKING_ACTIVE (streaming):
  - Toggle: "Thinking... (3.2s)" — real elapsed, updates every 1s
  - Three-dot pulse: 300ms stagger, accent color
    @keyframes thinking-dot {
      0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
      30% { opacity: 1; transform: translateY(-2px); }
    }

Expand: max-height 0→12rem, 200ms ease-out; content opacity 0→1, 150ms, delayed 50ms
Collapse: max-height 12rem→0, 150ms ease-in; opacity 1→0, 100ms
THINKING_DONE → expanded: toggle text "Thinking (collapsed)" → "Thinking (expanded)"
```

---

## 3. Tool Call Progress Indicator

### 3.1 Source Analysis

| Project | Running State | Result |
|---------|--------------|--------|
| Kanna | Draining indicator post-turn | Inline typed result |
| claude-code-webui | No explicit running indicator | `tool_result` below call |
| **AgentHub** | Spinning icon + elapsed counter | Slide-down with status badge |

### 3.2 Specification

```
States: TOOL_PENDING → TOOL_RUNNING → TOOL_DONE → TOOL_EXPANDED / TOOL_COLLAPSED

TOOL_RUNNING:
  - Spinner: SVG animateTransform rotate, 1s linear infinite
  - Elapsed: "Running... (1.5s)" updated every 500ms
  - Color: amber-warning

TOOL_RUNNING → TOOL_DONE:
  - Spinner → status icon: 100ms crossfade
  - Border-left: amber → green/red, 300ms ease
  - Elapsed → final duration: instant swap

Expand (L2): ToolParams max-height 0→16rem, 200ms ease-out; then ToolResult renders
Collapse: ToolResult unmounts; max-height 16rem→0, 150ms ease-in
```

### 3.3 Result Status Badge

| Status | Icon | Color | Text |
|--------|------|-------|------|
| Success | CheckCircle | Green | "Done (1.2s)" |
| Error | XCircle | Red | "Failed (exit 1)" |
| Denied | ShieldOff | Amber | "Denied" |
| Timeout | Clock | Red | "Timeout (30s)" |

---

## 4. AgentRun State Transition Animations

### 4.1 Transition Map

```
idle → queued → starting → running → completed → idle
                          ├── awaiting_approval → running
                          ├── failed → idle
                          └── cancelled → idle
```

### 4.2 Transition Specifications

| Transition | Animation | Duration |
|------------|-----------|----------|
| idle → queued | SendButton → StopButton crossfade; optimistic message with "sending..." badge | 100ms |
| queued → starting | Badge: grey → blue, color transition | 200ms |
| starting → running | RunIndicator spinner fade-in; badge green pulse (2s infinite) | 150ms |
| running → completed | Spinner → green check crossfade; badge fade out | 200ms + 3s hold + 500ms fade |
| running → failed | Spinner → red X crossfade; error slide-down; badge stays | 200ms + 200ms slide |
| running → cancelled | Spinner → grey square crossfade; badge fade out after 3s | 150ms |
| running → awaiting_approval | ApprovalCard slide-in from top; badge amber pulse | 200ms |

### 4.3 RunIndicator CSS

```css
.run-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); }
.run-indicator--running { animation: run-pulse 1.5s ease-in-out infinite; }
.run-indicator--awaiting { animation: run-pulse 2s ease-in-out infinite; background: var(--color-warning); }
@keyframes run-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
```

### 4.4 Draining Indicator (Kanna Pattern)

```
Trigger: turn result arrives but stream still has pending events
UI: thin amber bar at top, "Finishing up..." + pulsing dots; "Stop Draining" button visible
Auto-resolves when all pending events processed → idle
Force-stop → cancelled

Slide-in: translateY(-100%) → 0, 150ms ease-out
Slide-out: 0 → translateY(-100%), 150ms ease-in
```

---

## 5. DiffCard Micro-Interactions

| Transition | Animation | Duration | Easing |
|------------|-----------|----------|--------|
| IDLE → VIEWING | Slide in from bottom | 200ms | ease-out |
| VIEWING → APPLYING | [Apply] → spinner crossfade | 150ms | ease |
| APPLYING → APPLIED | Spinner → green check + badge | 200ms | ease-out |
| APPLYING → APPLY_FAILED | Spinner → red X + [Retry] | 200ms | ease-out |
| VIEWING → DISCARDED | Opacity 1 → 0.4, grey border | 200ms | ease-in |

**Undo Window**: 0-4500ms countdown label "Undo (N s)", 5000ms button disappears + border grey, 5300ms opacity fade to 0.7. Click during window: instant revert (no animation).

---

## 6. Animation Design System

### 6.1 Duration Tokens

| Token | ms | Usage |
|-------|-----|-------|
| `instant` | 0 | Text swap, cursor hide |
| `fast` | 100 | Crossfade, button swap |
| `normal` | 150 | Standard UI transition, badge color |
| `medium` | 200 | Content appearance (tool slide, diff card, status), layout resize |
| `slow` | 300 | Emphasis (thinking expand, error, border color shift) |
| `glacial` | 500 | Delayed dismissals (RunIndicator fade) |

### 6.2 Easing Curves (Material Design 3)

| Token | CSS cubic-bezier | Usage |
|-------|-----------------|-------|
| `ease-out` | `(0, 0, 0.2, 1)` | Entrances (expand, appear, slide-in) |
| `ease-in` | `(0.4, 0, 1, 1)` | Exits (collapse, dismiss, fade-out) |
| `ease-standard` | `(0.4, 0, 0.2, 1)` | State changes (color, crossfade, resize) |
| `ease-emphasized` | `(0.05, 0.7, 0.1, 1)` | Attention-drawing (error, approval) |

### 6.3 Layout Transition Catalog

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Sidebar collapse (280→48px) | `width` | 200ms | ease-standard |
| RightPanel open/close | `width` + `opacity` | 200ms | ease-standard |
| Message appear (streaming) | `opacity` + `translateY(8px→0)` | 150ms | ease-out |
| JumpToBottomButton | `opacity` + `scale(0.8→1)` | 150ms | ease-out |
| Toast in/out | `translateY` + `opacity` | 200ms | ease-out / ease-in |
| Modal backdrop | `opacity` 0→1 | 150ms | ease-out |
| Drawer (mobile) | `translateX(-100%→0)` | 150ms | ease-out |
| Bottom Sheet (mobile) | `translateY(100%→0)` | 200ms | ease-out |
| ApprovalCard | `max-height` + `opacity` | 200ms | ease-out |

### 6.4 Auto-Scroll During Streaming

```
1. User scrolled up > 100px → no auto-scroll; show JumpToBottomButton (fade-in 150ms)
2. User within 100px of bottom → smooth auto-scroll (scroll-behavior: smooth)
3. On streaming_done → final scroll to bottom if already near; keep position if scrolled up
4. JumpToBottomButton click → instant scroll (skip smooth)

Implementation: IntersectionObserver on 1px sentinel div at list bottom
```

### 6.5 Performance Guardrails

| Rule | Why |
|------|-----|
| Use `max-height` with known bound, never `height: auto` | CSS cannot transition to/from auto |
| Animate `transform` + `opacity` only | GPU-composited, zero layout thrash |
| `will-change` only during active animation | Persistent promotion causes memory bloat |
| 16ms debounce on streaming renders (Kanna) | 60fps, coalesce SSE events |
| Field-level memo comparator on MessageBubble (LibreChat) | Prevent full-tree re-render on single-message delta |
| No React `key` on streaming message container (LibreChat) | Streaming mutates in place; key causes unmount/remount flash |
| `@tanstack/react-virtual` for message list | Only render visible + 3 overscan |

---

## 7. Design Token Summary

```ts
// src/styles/tokens.ts
export const animation = {
  duration: { instant: 0, fast: 100, normal: 150, medium: 200, slow: 300, glacial: 500 },
  easing: {
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    emphasized: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  },
  streaming: {
    typewriterThreshold: 50,      // chars: below → char-by-char, above → whole chunk
    typewriterInterval: 30,       // ms between chars
    debounceWindow: 16,           // ms (Kanna batching)
    cursorBlinkInterval: 1000,    // ms step-end
    cursorRemovalDelay: 200,      // ms after streaming_done
  },
  thinking: {
    dotStaggerDelay: 300,         // ms per dot
    elapsedUpdateInterval: 1000,  // ms
    expandDuration: 200,          // ms max-height
    collapseDuration: 150,        // ms
    contentFadeIn: 150,           // ms opacity
  },
  toolCall: {
    elapsedUpdateInterval: 500,   // ms
    statusCrossfade: 100,         // ms spinner→icon
    borderColorTransition: 300,   // ms amber→green/red
    expandDuration: 200,          // ms slide-down
    collapseDuration: 150,        // ms slide-up
  },
  undoWindow: 5000,               // ms
};
```

---

## 8. References

- `kanna.md` -- Draining indicator, empty-state typing, 16ms debounce broadcast
- `claude-code-webui.md` -- UnifiedMessageProcessor dual-mode, NDJSON streaming, permission UI
- `design-desktop-ux.md` -- Progressive Disclosure L0-L4, DiffCard state machine, mobile 150ms transitions
- `deep-dive-librechat-message-tree.md` -- SSE streaming, SiblingSwitch, custom memo comparator, no-React-key
