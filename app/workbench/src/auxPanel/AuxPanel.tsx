import React, { useMemo } from 'react';
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

  return (
    <aside className={[styles.root, className].filter(Boolean).join(' ')} data-testid="aux-panel">
      <div className={styles.tabStrip} role="tablist" aria-label="Aux panel">
        {available.map((tab) => {
          const selected = tab === effective;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? styles.tabActive : styles.tab}
              data-tab={tab}
              onClick={() => onActiveTabChange(tab)}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>
      <div className={styles.body} role="tabpanel" data-tab={effective}>
        {children[effective] ?? null}
      </div>
    </aside>
  );
}
