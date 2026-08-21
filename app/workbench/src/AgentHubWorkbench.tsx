import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import Modal from '@shared/ui/Modal';
import { getResolvedShortcutGroups } from '@shared/utils/keyboardShortcuts';
import type { GlobalRailPage } from './GlobalRail';
import styles from './AgentHubWorkbench.module.css';
import { useWorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import { useWorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import { useWorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import { useWorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import { WorkbenchFrame } from './WorkbenchFrame';
import { WorkbenchProfileOverlays } from './WorkbenchProfileOverlays';
import { WorkbenchTranscriptOverlays } from './WorkbenchTranscriptOverlays';
import {
  buildProfileChromeOptions,
  buildProfileOverlaysProps,
  buildSessionChromeOptions,
  buildTranscriptChromeOptions,
  buildTranscriptOverlaysProps,
  buildWorkbenchFrameProps,
  createEmptyTranscriptHelpersBridge,
  isWorkbenchChatPage,
  resolveWorkbenchComposerFlags,
} from './AgentHubWorkbenchHelpers';
import type { AgentHubWorkbenchProps } from './AgentHubWorkbenchTypes';

export type {
  AgentHubWorkbenchModelCatalogItem,
  AgentHubWorkbenchProjectsStatus,
  AgentHubWorkbenchProps,
  AgentHubWorkbenchStatus,
} from './AgentHubWorkbenchTypes';

/**
 * AgentHub workbench composition shell (#683 residual).
 * Owns page state + chrome hooks; frame/overlay props come from pure helpers.
 */
export function AgentHubWorkbench(props: AgentHubWorkbenchProps): React.ReactElement {
  const { platform, transcript } = props;
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const composerFlags = resolveWorkbenchComposerFlags(props);

  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const isChatPage = isWorkbenchChatPage(activePage);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // Global '?' opens/closes the keyboard-shortcuts help overlay (#8).
  // Reuses getResolvedShortcutGroups() — the same data source as the
  // Settings ShortcutsPane. Skips editable targets and modifier chords.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable === true;
      if (isEditable) return;
      event.preventDefault();
      setShortcutHelpOpen((open) => !open);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const layout = useWorkbenchPanelLayout({
    activePage,
    isChatPage,
    platformSurface: platform.surface,
    setActivePage,
  });

  // Session owns composer/workspace refs and may run before transcript chrome is composed.
  // Bridge transcript helpers through a ref so user-driven handlers always see the latest impl.
  const transcriptHelpersRef = useRef(createEmptyTranscriptHelpersBridge());

  const session = useWorkbenchSessionChrome(buildSessionChromeOptions({
    props,
    activePage,
    isChatPage,
    openInspector: layout.openInspector,
    transcriptHelpersRef,
    t: translate,
  }));

  const transcriptChrome = useWorkbenchTranscriptChrome(buildTranscriptChromeOptions({
    props,
    t: translate,
    session,
    layout,
  }));

  transcriptHelpersRef.current = {
    showWorkbenchToast: transcriptChrome.showWorkbenchToast,
    copyText: transcriptChrome.copyText,
    resetSelection: transcriptChrome.resetSelection,
  };

  const profile = useWorkbenchProfileChrome(buildProfileChromeOptions({
    props,
    t: translate,
    session,
    setActivePage,
    showWorkbenchToast: transcriptChrome.showWorkbenchToast,
    copyText: transcriptChrome.copyText,
  }));

  const frameProps = buildWorkbenchFrameProps({
    props,
    activePage,
    isChatPage,
    layout,
    session,
    transcriptChrome,
    profile,
    setActivePage,
    showComposerAgentPicker: composerFlags.showComposerAgentPicker,
    showComposerStatus: composerFlags.showComposerStatus,
    showMainchainStatus: composerFlags.showMainchainStatus,
    children: (
      <>
        <WorkbenchTranscriptOverlays
          {...buildTranscriptOverlaysProps({
            isChatPage,
            transcriptChrome,
            transcriptLength: transcript.length,
            // #1385: conversation list powers the forward picker submenu.
            conversations: props.conversations,
          })}
        />
        <WorkbenchProfileOverlays
          {...buildProfileOverlaysProps({
            t: translate,
            profile,
          })}
        />
      </>
    ),
  });

  return (
    <>
      <a className={styles.skipLink} href="#main-content">
        {translate('a11y.skipToContent')}
      </a>
      <WorkbenchFrame {...frameProps} />
      <Modal
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
        title={translate('shortcut.title')}
        contentClassName={styles.shortcutHelpContent}
      >
        <ShortcutHelpContent />
      </Modal>
    </>
  );
}

/** Keyboard-shortcut reference content for the global '?' help overlay.
 *  Renders the same canonical groups as the Settings ShortcutsPane
 *  (getResolvedShortcutGroups, including user-custom bindings). */
function ShortcutHelpContent(): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string) => string;
  const groups = getResolvedShortcutGroups();
  return (
    <div className={styles.shortcutHelp}>
      {groups.map((group) => (
        <section className={styles.shortcutHelpGroup} key={group.id}>
          <h3>{translate(group.labelKey)}</h3>
          <ul>
            {group.shortcuts.map((shortcut) => (
              <li className={styles.shortcutHelpRow} key={shortcut.id}>
                <span>{translate(shortcut.labelKey)}</span>
                <kbd>{shortcut.keys.join(' + ')}</kbd>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
