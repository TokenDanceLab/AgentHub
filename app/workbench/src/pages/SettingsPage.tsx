import React from 'react';
import styles from './SettingsPage.module.css';
import {
  SettingsMain,
  SettingsNav,
} from './settings';
import type { SettingsPageProps } from './settings';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPage — AgentHub v4

   Left nav (sections + scope) + right main (settings rows + state preview).
   Pane content / shared controls extracted under ./settings for Phase 18 #572.
   Residual nav/main shell extracted for Phase 21 #604.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  SettingsPageProps,
  SettingsPaneId,
  StatePanelKind,
} from './settings';

/* ═══════════════════════════════════════════════════════════════════════
   Main export
   ═══════════════════════════════════════════════════════════════════════ */

export function SettingsPage(props: SettingsPageProps): React.ReactElement {
  return (
    <section className={`${styles.page} workbench settings-page`}>
      <SettingsNav
        activePane={props.activePane}
        onSelectPane={props.onSelectPane}
        spaceTitle={props.spaceTitle}
        spaceMeta={props.spaceMeta}
        {...(props.currentUserDisplayName !== undefined
          ? { currentUserDisplayName: props.currentUserDisplayName }
          : {})}
      />
      <SettingsMain {...props} />
    </section>
  );
}
