import React, { useRef } from 'react';
import {
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DesignNavIcon,
  type DesignNavIconName,
} from '../designIcons';
import { Tooltip } from '../../ui/Tooltip';
import styles from '../AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   InspectorTabChrome — tab config, close mark, and monitor-head chrome
   for RightInspector (tablist + quick-open restore menu).

   Extracted from RightInspector as Phase 19 residual thin #584.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export type InspectorMode = 'overview' | 'browser' | 'files';

export interface InspectorTabDef {
  mode: InspectorMode;
  label: string;
  markChar: string;
  icon: DesignNavIconName;
}

export function getInspectorTabs(t: (key: string) => string): InspectorTabDef[] {
  return [
    { mode: 'overview', label: t('inspector.overview'), markChar: '×', icon: 'overview' },
    { mode: 'browser', label: t('inspector.browser'), markChar: '×', icon: 'browser' },
    { mode: 'files', label: t('inspector.files'), markChar: '×', icon: 'fileText' },
  ];
}

/** P76: overview is the single default primary card; browser/files open on demand. */
export const defaultVisibleTabs = new Set<InspectorMode>(['overview']);

export function getQuickOpenItems(t: (key: string) => string) {
  return [
    { id: 'files', label: t('inspector.quickOpenFiles'), shortcut: 'Ctrl+P', mode: 'files' as InspectorMode },
    { id: 'chat', label: t('inspector.quickOpenChat'), shortcut: '', mode: null },
    { id: 'browser', label: t('inspector.quickOpenBrowser'), shortcut: 'Ctrl+T', mode: 'browser' as InspectorMode },
    { id: 'terminal', label: t('inspector.quickOpenTerminal'), shortcut: 'Ctrl+`', mode: null },
  ];
}

export function inspectorTabLabel(mode: InspectorMode, t: (key: string) => string): string {
  return getInspectorTabs(t).find((tab) => tab.mode === mode)?.label ?? mode;
}

function TabMark({
  char,
  children,
  mode,
  onClose,
  t,
}: {
  char: string;
  children: React.ReactElement;
  mode: InspectorMode;
  onClose: (mode: InspectorMode) => void;
  t: (key: string) => string;
}) {
  const closeLabel = t('inspector.closeTab').replace('{{label}}', inspectorTabLabel(mode, t));
  return (
    <Tooltip label={closeLabel}>
      <span
        aria-label={closeLabel}
        className={styles.inspectorTabMark}
        data-inspector-close
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose(mode);
        }}
        role="button"
        tabIndex={-1}
      >
        {children}
        <b>{char}</b>
      </span>
    </Tooltip>
  );
}

export interface InspectorMonitorHeadProps {
  activeMode: InspectorMode;
  browserPreviewEnabled: boolean;
  quickOpenVisible: boolean;
  visibleTabs: Set<InspectorMode>;
  onCloseTab: (mode: InspectorMode) => void;
  onRestoreTab: (mode: InspectorMode) => void;
  onSelectMode: (mode: InspectorMode) => void;
  onToggleQuickOpen: () => void;
  t: (key: string) => string;
}

/** Tablist + quick-open / restore menu for the right inspector. */
export function InspectorMonitorHead({
  activeMode,
  browserPreviewEnabled,
  quickOpenVisible,
  visibleTabs,
  onCloseTab,
  onRestoreTab,
  onSelectMode,
  onToggleQuickOpen,
  t,
}: InspectorMonitorHeadProps): React.ReactElement {
  const inspectorTabs = getInspectorTabs(t);
  const quickOpenItems = getQuickOpenItems(t);
  const visibleInspectorTabs = inspectorTabs.filter((tab) => visibleTabs.has(tab.mode));
  const tablistRef = useRef<HTMLDivElement>(null);

  /* Roving tabindex (#8): ArrowLeft/Right + Home/End move the single tab stop
     between visible tabs, skipping the capability-disabled browser tab.
     Same pattern as ContextMenu.tsx: index state + focus-on-change. */
  function handleTablistKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const enabledTabs = visibleInspectorTabs.filter(
      (tab) => !(tab.mode === 'browser' && !browserPreviewEnabled),
    );
    if (enabledTabs.length === 0) return;

    const current = enabledTabs.findIndex((tab) => tab.mode === activeMode);
    const from = current >= 0 ? current : 0;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (from + 1) % enabledTabs.length;
        break;
      case 'ArrowLeft':
        next = (from - 1 + enabledTabs.length) % enabledTabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabledTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextMode = enabledTabs[next]!.mode;
    onSelectMode(nextMode);
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`[data-inspector-tab="${nextMode}"]`)
      ?.focus();
  }

  return (
    <div className={styles.monitorHead}>
      <div
        aria-label={t("aria.rightWorkspace")}
        className={styles.inspectorTabs}
        onKeyDown={handleTablistKeyDown}
        ref={tablistRef}
        role="tablist"
      >
        {visibleInspectorTabs.map((tab) => {
          const disabled = tab.mode === 'browser' && !browserPreviewEnabled;
          return (
            <button
              aria-selected={activeMode === tab.mode}
              className={styles.inspectorTab}
              data-inspector-tab={tab.mode}
              disabled={disabled}
              key={tab.mode}
              onClick={() => onSelectMode(tab.mode)}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                onCloseTab(tab.mode);
              }}
              role="tab"
              tabIndex={activeMode === tab.mode ? 0 : -1}
              type="button"
            >
              <TabMark char={tab.markChar} mode={tab.mode} onClose={onCloseTab} t={t}>
                <DesignNavIcon
                  className={styles.inspectorTabIcon}
                  name={tab.icon}
                  size={DESIGN_NAV_GLYPH_SIZE}
                  strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
                />
              </TabMark>
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className={styles.inspectorWindowActions}>
        <Tooltip label={t("aria.newRightWindow")}>
          <button
            type="button"
            aria-label={t("aria.newRightWindow")}
            aria-expanded={quickOpenVisible}
            aria-haspopup="menu"
            onClick={onToggleQuickOpen}
          >
            <DesignNavIcon name="plus" size={15} />
          </button>
        </Tooltip>
        {quickOpenVisible && (
          <div className={styles.inspectorAddMenu} role="menu" aria-label={t("aria.rightWindowMenu")}>
            {quickOpenItems.map((item) => (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                onClick={() => {
                  if (item.mode) onRestoreTab(item.mode);
                }}
              >
                <DesignNavIcon name={item.mode === 'browser' ? 'browser' : item.mode === 'files' ? 'fileText' : 'tools'} size={15} />
                <span>{item.label}</span>
                {item.shortcut && <em>{item.shortcut}</em>}
              </button>
            ))}
            {inspectorTabs.some((tab) => !visibleTabs.has(tab.mode)) && (
              <div className={styles.inspectorAddMenuDivider} />
            )}
            {inspectorTabs.filter((tab) => !visibleTabs.has(tab.mode)).map((tab) => (
              <button
                key={tab.mode}
                role="menuitem"
                type="button"
                onClick={() => onRestoreTab(tab.mode)}
              >
                <DesignNavIcon name={tab.icon} size={15} />
                <span>{`恢复 ${tab.label}`}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
