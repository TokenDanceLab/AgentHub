import React from 'react';
import styles from './AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   RightInspectorResizer — keyboard/pointer vertical resizer chrome for
   the right inspector shell (#661). No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface RightInspectorResizerProps {
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  width: number;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function RightInspectorResizer({
  collapsed,
  maxWidth,
  minWidth,
  width,
  onKeyDown,
  onPointerDown,
}: RightInspectorResizerProps): React.ReactElement {
  return (
    <div
      aria-label="调整右侧栏宽度"
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      className={styles.inspectorResizer}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={collapsed ? -1 : 0}
    />
  );
}
