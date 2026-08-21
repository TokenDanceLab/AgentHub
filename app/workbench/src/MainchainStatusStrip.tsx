import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import type { MainchainSummary } from './mainchain';

export interface MainchainStatusStripProps {
  summary: MainchainSummary;
  onExportEvidence: () => void;
}

export function MainchainStatusStrip({
  onExportEvidence,
  summary,
}: MainchainStatusStripProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    // A11y (#10): the strip's node states/labels change at runtime — a
    // polite live region announces the changes without stealing focus.
    <section className={styles.mainchainStrip} aria-label={t('aria.mainChainStatus')} aria-live="polite">
      <div className={styles.mainchainTrack} role="list">
        {summary.nodes.map((n) => (
          <div className={styles.mainchainNode} data-state={n.state} key={n.id} role="listitem">
            <span className={styles.mainchainDot} aria-hidden="true" />
            <span className={styles.mainchainCopy}><strong>{n.label}</strong><em>{n.detail}</em></span>
          </div>
        ))}
      </div>
      <button type="button" className={styles.mainchainExport} disabled={!summary.exportEnabled}
        onClick={onExportEvidence} title={summary.exportDetail}>{summary.exportLabel}</button>
    </section>
  );
}
