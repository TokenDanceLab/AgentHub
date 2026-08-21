import React, { useSyncExternalStore } from 'react';
import {
  getAppliedAgentHubTheme,
  type AgentHubTheme,
} from '@shared/theme';
import { DESIGN_NAV_GLYPH_STROKE_WIDTH, DesignNavIcon } from '../designIcons';
import { Button } from '@shared/ui/Button';
import { Tooltip } from '@shared/ui/Tooltip';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './BrowserPreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   BrowserPreview — Browser chrome with back/forward/refresh/address
   bar and an embedded iframe.

   Props:
     url     — The URL loaded in the iframe
     onClose — Called when the close button is clicked

   Mirrors the desktop demo .browser-preview-pane visual design using
   ONLY v4 CSS custom properties. Pure presentational — no data fetching.

   Demo/fixture blank URLs use a host data-theme-aware empty document so
   the pane never paints pure white in dark mode (#1247, #1251). Real
   URLs still load via src as before.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface BrowserPreviewProps {
  url: string;
  onClose: () => void;
}

/** Surface tokens for blank preview docs — match themes.css app canvas. */
const BLANK_PREVIEW_SURFACE: Record<
  AgentHubTheme,
  { background: string; color: string; ambient: string; scheme: AgentHubTheme }
> = {
  dark: {
    scheme: 'dark',
    background: '#1a1a20',
    color: '#e3e4e6',
    ambient:
      'radial-gradient(ellipse 78% 58% at 50% 38%, rgba(41,171,226,0.045) 0%, transparent 68%)',
  },
  light: {
    scheme: 'light',
    background: '#f8f9fb',
    color: '#1a1a2e',
    ambient:
      'radial-gradient(ellipse 78% 58% at 50% 38%, rgba(0,113,188,0.04) 0%, transparent 68%)',
  },
};

/**
 * Empty document for demo defaults. Uses explicit host-theme surfaces
 * (not system Canvas) so blank previews follow data-theme even when OS
 * prefers-color-scheme disagrees (#1251).
 */
export function buildThemedBlankPreviewSrcDoc(theme: AgentHubTheme): string {
  const { scheme, background, color, ambient } = BLANK_PREVIEW_SURFACE[theme];
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta name="color-scheme" content="${scheme}" />`,
    '<title>Preview</title>',
    '<style>',
    `:root{color-scheme:${scheme}}`,
    `html,body{margin:0;min-height:100%;background:${background};color:${color}}`,
    `body{background:${ambient},${background}}`,
    '</style>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('');
}

/** @deprecated Prefer buildThemedBlankPreviewSrcDoc(hostTheme). Light fallback for static consumers. */
export const THEMED_BLANK_PREVIEW_SRCDOC = buildThemedBlankPreviewSrcDoc('light');

export const THEMED_BLANK_PREVIEW_SRCDOC_DARK = buildThemedBlankPreviewSrcDoc('dark');
export const THEMED_BLANK_PREVIEW_SRCDOC_LIGHT = buildThemedBlankPreviewSrcDoc('light');

export function isThemedBlankPreviewUrl(url: string): boolean {
  const value = url.trim().toLowerCase();
  return (
    value === ''
    || value === 'about:blank'
    || value.startsWith('about:blank?')
    || value.startsWith('about:blank#')
  );
}

function subscribeHostTheme(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function useHostAgentHubTheme(): AgentHubTheme {
  return useSyncExternalStore(
    subscribeHostTheme,
    getAppliedAgentHubTheme,
    () => 'light' as AgentHubTheme,
  );
}

// ── Component ────────────────────────────────────────────────────────────

export const BrowserPreview: React.FC<BrowserPreviewProps> = ({
  url,
  onClose,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const hostTheme = useHostAgentHubTheme();
  const themedBlank = isThemedBlankPreviewUrl(url);
  const addressLabel = themedBlank ? (url.trim() || 'about:blank') : url;
  const blankSrcDoc = themedBlank
    ? buildThemedBlankPreviewSrcDoc(hostTheme)
    : undefined;

  return (
    <section
      className={styles.pane}
      aria-label={t('aria.browserPreview')}
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        {/* Back */}
        <Tooltip label={t('aria.goBack')}>
          <button
            className={styles.navBtn}
            type="button"
            aria-label={t('aria.goBack')}
            disabled
          >
            <DesignNavIcon name="back" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </button>
        </Tooltip>

        {/* Forward */}
        <Tooltip label={t('aria.goForward')}>
          <button
            className={styles.navBtn}
            type="button"
            aria-label={t('aria.goForward')}
            disabled
          >
            <DesignNavIcon name="forward" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </button>
        </Tooltip>

        {/* Refresh */}
        <Tooltip label={t('aria.refresh')}>
          <button
            className={styles.navBtn}
            type="button"
            aria-label={t('aria.refresh')}
          >
            <DesignNavIcon name="refresh" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </button>
        </Tooltip>

        {/* Address bar */}
        <div className={styles.address}>
          <span className={styles.addressIcon}>
            <DesignNavIcon name="link" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </span>
          <strong className={styles.addressText}>{addressLabel}</strong>
        </div>

        {/* Close */}
        <Tooltip label={t('aria.closePreview')}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            aria-label={t('aria.closePreview')}
          >
            <DesignNavIcon name="close" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </Button>
        </Tooltip>
      </div>

      {/* ── Iframe ── */}
      <div className={styles.frameShell}>
        {themedBlank ? (
          <iframe
            className={`${styles.frame} ${styles.frameBlank}`}
            title={t('browserPreview.iframeTitle', { url: addressLabel })}
            srcDoc={blankSrcDoc}
            loading="lazy"
          />
        ) : (
          <iframe
            className={styles.frame}
            title={t('browserPreview.iframeTitle', { url })}
            src={url}
            loading="lazy"
          />
        )}
      </div>

      {/* ── Status bar ── */}
      <div className={styles.status}>
        <span className={styles.statusItem}>Desktop</span>
        <span className={styles.statusItem}>Local Vite</span>
        <span className={styles.statusItem}>{t('browserPreview.readOnly')}</span>
      </div>
    </section>
  );
};
