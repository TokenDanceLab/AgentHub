import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import type { GlobalRailPage } from './GlobalRail';
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

  return <WorkbenchFrame {...frameProps} />;
}
