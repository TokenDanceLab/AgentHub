// SubagentSessionDialog — #1406 follow-up (fable UIUX gap: drill-down dialog)
// Full sub-session drill-down: opened from the SubagentStreamOverlay
// delegation chip, renders the complete session transcript via the
// existing SubagentTranscript inside the shared Modal (focus trap,
// Escape/backdrop close, role=dialog).
// No WS/REST protocol changes — pure consumer of existing
// TEAM_SUBAGENT_STREAM frames already aggregated by SubagentStreamStore.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import Modal from '@shared/ui/Modal';
import { SubagentTranscript } from './SubagentTranscript';
import type { TeamSubagentStreamEvent } from './SubagentStreamStore';
import styles from './SubagentStreamOverlay.module.css';

export interface SubagentSessionDialogProps {
  /** Dialog visibility. Modal renders nothing while closed. */
  open: boolean;
  /** Called on close button / Escape / backdrop click. */
  onClose: () => void;
  /** Agent display name, shown in the dialog title. */
  agentName: string;
  /** Complete sorted event list of the sub-session. */
  events: readonly TeamSubagentStreamEvent[];
}

export function SubagentSessionDialog({
  open,
  onClose,
  agentName,
  events,
}: SubagentSessionDialogProps): React.ReactElement | null {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('subagentStream.dialogTitle', { name: agentName })}
      contentClassName={styles.sessionDialogContent}
    >
      <div className={styles.sessionDialogBody}>
        <SubagentTranscript events={events} />
      </div>
    </Modal>
  );
}
