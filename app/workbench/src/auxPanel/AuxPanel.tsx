import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
} from './resolveAuxTabs';
import type { AuxPanelTab } from './types';
import styles from './AuxPanel.module.css';

export type AuxPanelProps = {
  hasWorkspace: boolean;
  localFiles?: boolean;
  activeTab: AuxPanelTab;
  onActiveTabChange: (tab: AuxPanelTab) => void;
  labels: Record<AuxPanelTab, string>;
  children: Partial<Record<AuxPanelTab, React.ReactNode>>;
  className?: string;
};

/**
 * Dense aux panel shell: tab strip + slot content.
 * Folder-scoped tabs require hasWorkspace && localFiles (#1172).
 */
export function AuxPanel({
  hasWorkspace,
  localFiles = true,
  activeTab,
  onActiveTabChange,
  labels,
  children,
  className,
}: AuxPanelProps): React.ReactElement {
  const available = useMemo(
    () => resolveAvailableAuxTabs({ hasWorkspace, localFiles }),
    [hasWorkspace, localFiles],
  );
  const effective = resolveEffectiveAuxTab(activeTab, available);

  // ── Roving tabindex (#1823) ──────────────────────────────────────────
  // One Tab stop for the strip; Arrow/Home/End move focus between tabs
  // without changing the selection (activation stays on click/Enter,
  // matching the #1835 TerminalPanel pattern).
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsId = useId();
  const [rovingTabId, setRovingTabId] = useState<AuxPanelTab | null>(null);

  const handleTabsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabButtons = tabsRef.current
      ? Array.from(tabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      : [];
    if (tabButtons.length === 0) return;
    const activeIndex = tabButtons.findIndex((button) => button === document.activeElement);
    // Focus on a non-tab stop is not part of the roving strip — arrow keys
    // should not hijack it (#1835 review).
    if (activeIndex < 0) return;
    let nextIndex: number | null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % tabButtons.length;
        break;
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabButtons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabButtons[nextIndex];
    target?.focus();
    // Keep the roving stop on the focused tab (tabIndex=0 must not remain
    // on the previously focused tab after focus moved away from it).
    setRovingTabId((target?.dataset.tab as AuxPanelTab | undefined) ?? null);
  }, []);

  return (
    <aside className={[styles.root, className].filter(Boolean).join(' ')} data-testid="aux-panel">
      <div
        className={styles.tabStrip}
        role="tablist"
        aria-label="Aux panel"
        onKeyDown={handleTabsKeyDown}
        ref={tabsRef}
      >
        {available.map((tab) => {
          const selected = tab === effective;
          // #1823: a remembered roving target can dangle after availability
          // shrinks (e.g. workspace closed) — fall back to the effective
          // tab so the strip always keeps exactly one Tab stop.
          const rovingValid = rovingTabId !== null && available.includes(rovingTabId);
          const isTabStop = tab === (rovingValid ? rovingTabId : effective);
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${tab}`}
              aria-controls={`${tabsId}-panel`}
              aria-selected={selected}
              tabIndex={isTabStop ? 0 : -1}
              className={selected ? styles.tabActive : styles.tab}
              data-tab={tab}
              onClick={() => {
                // #1823: click activation selects the tab AND moves the
                // roving stop to it — otherwise Tab later returns to the
                // stale stop.
                setRovingTabId(tab);
                onActiveTabChange(tab);
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>
      <div
        className={styles.body}
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-tab-${effective}`}
        data-tab={effective}
      >
        {children[effective] ?? null}
      </div>
    </aside>
  );
}
