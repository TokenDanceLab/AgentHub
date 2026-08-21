import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div
      aria-label={t('aria.resizeInspector')}
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
