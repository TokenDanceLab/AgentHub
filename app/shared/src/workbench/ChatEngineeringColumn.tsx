import React, { useEffect, useMemo, useState } from 'react';
import {
  AuxPanel,
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
  type AuxPanelTab,
} from './auxPanel';
import shellStyles from './AgentHubWorkbench.module.css';
import styles from './ChatEngineeringColumn.module.css';

export type ChatEngineeringColumnProps = {
  inspector: React.ReactNode;
  hasWorkspace: boolean;
  localFiles: boolean;
};

const LABELS: Record<AuxPanelTab, string> = {
  session_details: '会话',
  file_tree: '文件',
  changes: '变更',
  git_log: '提交',
};

/**
 * Desktop engineering-loop column: RightInspector + AuxPanel stack (#1181).
 * Folder-scoped aux tabs require hasWorkspace && localFiles.
 * Shell width / collapse chrome lives on `.engineeringColumn`.
 */
export function ChatEngineeringColumn({
  inspector,
  hasWorkspace,
  localFiles,
}: ChatEngineeringColumnProps): React.ReactElement {
  const available = useMemo(
    () => resolveAvailableAuxTabs({ hasWorkspace, localFiles }),
    [hasWorkspace, localFiles],
  );
  const [activeTab, setActiveTab] = useState<AuxPanelTab>('session_details');
  const effective = resolveEffectiveAuxTab(activeTab, available);

  useEffect(() => {
    if (effective !== activeTab) setActiveTab(effective);
  }, [effective, activeTab]);

  return (
    <div
      className={[shellStyles.engineeringColumn, styles.column].filter(Boolean).join(' ')}
      data-testid="chat-engineering-column"
    >
      <div className={styles.inspectorSlot}>{inspector}</div>
      <div className={styles.auxSlot}>
        <AuxPanel
          hasWorkspace={hasWorkspace}
          localFiles={localFiles}
          activeTab={effective}
          onActiveTabChange={setActiveTab}
          labels={LABELS}
        >
          {{
            session_details: (
              <div className={styles.placeholder}>会话详情与运行摘要（本地工程循环）</div>
            ),
            file_tree: (
              <div className={styles.placeholder}>工作区文件树（由 Desktop host 填充）</div>
            ),
            changes: (
              <div className={styles.placeholder}>Git 变更列表（由 Desktop host 填充）</div>
            ),
            git_log: (
              <div className={styles.placeholder}>提交历史（由 Desktop host 填充）</div>
            ),
          }}
        </AuxPanel>
      </div>
    </div>
  );
}
