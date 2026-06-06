import React, { useState } from 'react';
import type { EvidenceRef } from '../transcript';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';

const inspectorTabs: Array<{ mode: InspectorMode; label: string }> = [
  { mode: 'overview', label: '概览' },
  { mode: 'browser', label: '浏览器' },
  { mode: 'files', label: '文件' },
];

export interface RightInspectorProps {
  evidence: EvidenceRef[];
  browserPreviewEnabled: boolean;
}

export function RightInspector({
  evidence,
  browserPreviewEnabled,
}: RightInspectorProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');

  return (
    <aside aria-label="Right inspector" className={styles.inspector}>
      <div aria-label="Inspector tabs" className={styles.inspectorTabs} role="tablist">
        {inspectorTabs.map((tab) => {
          const disabled = tab.mode === 'browser' && !browserPreviewEnabled;
          return (
            <button
              aria-selected={activeMode === tab.mode}
              className={styles.inspectorTab}
              disabled={disabled}
              key={tab.mode}
              onClick={() => setActiveMode(tab.mode)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={styles.inspectorPanel} role="tabpanel">
        {activeMode === 'overview' ? (
          <ul className={styles.evidenceList}>
            {evidence.map((item) => (
              <li className={styles.evidenceItem} key={item.id}>
                {renderEvidence(item)}
              </li>
            ))}
          </ul>
        ) : null}
        {activeMode === 'browser' ? (
          <p className={styles.inspectorEmpty}>Browser preview</p>
        ) : null}
        {activeMode === 'files' ? (
          <p className={styles.inspectorEmpty}>Changed files</p>
        ) : null}
      </div>
    </aside>
  );
}

function renderEvidence(item: EvidenceRef): React.ReactElement {
  return (
    <>
      <span className={styles.evidenceLabel}>{item.label}</span>
      <span className={styles.blockMeta}>{item.kind}</span>
    </>
  );
}
