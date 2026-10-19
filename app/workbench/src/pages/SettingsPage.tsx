import React from 'react';
import styles from './SettingsPage.module.css';
import {
  SettingsMain,
  SettingsNav,
} from './settings/index';
import type { SettingsPageProps } from './settings/index';

/* ═══════════════════════════════════════════════════════════════════════
   SettingsPage — AgentHub v4

   Left nav (sections + scope) + right main (settings rows + state preview).
   Pane content and shared controls live under ./settings (#572).
   Nav and main shell (#604).
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  SettingsPageProps,
  SettingsPaneId,
  StatePanelKind,
} from './settings/index';

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
