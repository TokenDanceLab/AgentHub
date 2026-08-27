import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useWorkbenchGlobalShortcuts } from './useWorkbenchGlobalShortcuts';
import { useWorkbenchTaskDeepLinks } from './useWorkbenchTaskDeepLinks';
import { WorkbenchTaskDeepLinkProvider } from './workbenchTaskDeepLinks';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT } from './desktopChromeEvents';
import { isEditableKeyboardTarget } from './workbenchSessionChromeHelpers';
import { WorkbenchFrame } from './WorkbenchFrame';
import {
  engineeringColumnActivitySignal,
  useEngineeringColumnAutoOpen,
} from './useEngineeringColumnAutoOpen';
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
  return (
    <WorkbenchTaskDeepLinkProvider>
      <AgentHubWorkbenchContent {...props} />
    </WorkbenchTaskDeepLinkProvider>
  );
}

function AgentHubWorkbenchContent(props: AgentHubWorkbenchProps): React.ReactElement {
  const { platform, transcript } = props;
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const composerFlags = resolveWorkbenchComposerFlags(props);

  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const isChatPage = isWorkbenchChatPage(activePage);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  // #1822: Ctrl/⌘+K global search dialog (conversation switcher).
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  // #1963: task ↔ conversation deep links — intents queued by the tasks
  // route view / conversation sidebar become page + conversation navigation
  // here (and the back trips go through the same store).
  useWorkbenchTaskDeepLinks({
    setActivePage,
    onActiveConversationChange: props.onActiveConversationChange,
    dataMode: props.workbenchStatus?.dataMode,
  });

  // Global '?' opens/closes the keyboard-shortcuts help overlay (#8).
  // Reuses getResolvedShortcutGroups() — the same data source as the
  // Settings ShortcutsPane. Skips editable targets and modifier chords.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableKeyboardTarget(event.target)) return;
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
    // #1997 (UX F3): split-view placement derives from the shell selection.
    ...(props.activeConversationId !== undefined
      ? { activeConversationId: props.activeConversationId }
      : {}),
  });

  const handleGlobalSearchSelect = useCallback((conversationId: string): void => {
    props.onActiveConversationChange?.(conversationId);
    setGlobalSearchOpen(false);
  }, [props.onActiveConversationChange]);

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

  const activitySignal = engineeringColumnActivitySignal({
    isAgentRunning: props.isAgentRunning,
    runtimeEvidence: props.runtimeEvidence,
  });
  const engineeringColumn = useEngineeringColumnAutoOpen({
    conversationId: session.currentConversationId,
    isChatPage,
    platformSurface: platform.surface,
    activitySignal,
    layout,
  });
  const managedLayout = engineeringColumn.layout;

  // #1822 + #1964: the global run-panel shortcut is a manual toggle, so it
  // participates in the same per-conversation suppression contract as the
  // header button. Quick-open is an explicit request and always expands.
  const handleQuickOpen = useCallback((): void => {
    managedLayout.openInspector();
    window.dispatchEvent(new CustomEvent(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, {
      detail: { mode: 'files' },
    }));
  }, [managedLayout]);

  useWorkbenchGlobalShortcuts({
    onSearch: () => setGlobalSearchOpen(true),
    onOpenSettings: () => setActivePage('settings'),
    onToggleSidebar: managedLayout.toggleSidebar,
    onToggleRunPanel: engineeringColumn.toggleInspector,
    onQuickOpen: handleQuickOpen,
  });

  const transcriptChrome = useWorkbenchTranscriptChrome(buildTranscriptChromeOptions({
    props,
    t: translate,
    session,
    layout: managedLayout,
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
    layout: managedLayout,
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
      <GlobalSearchDialog
        open={globalSearchOpen}
        conversations={props.conversations}
        currentConversationId={session.currentConversationId}
        onClose={() => setGlobalSearchOpen(false)}
        onSelect={handleGlobalSearchSelect}
      />
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
