import React from 'react';
import { DESIGN_NAV_GLYPH_STROKE_WIDTH, DesignNavIcon } from '../designIcons';
import styles from './BrowserPreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   BrowserPreview — Browser chrome with back/forward/refresh/address
   bar and an embedded iframe.

   Props:
     url     — The URL loaded in the iframe
     onClose — Called when the close button is clicked

   Mirrors the desktop demo .browser-preview-pane visual design using
   ONLY v4 CSS custom properties. Pure presentational — no data fetching.

   Demo/fixture blank URLs use a color-scheme-aware empty document so the
   pane never paints pure white in dark mode (#1247). Real URLs still load
   via src as before.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface BrowserPreviewProps {
  url: string;
  onClose: () => void;
}

/**
 * Empty document for demo defaults: Canvas/CanvasText + light/dark scheme
 * so blank previews follow the host theme instead of a white void.
 */
export const THEMED_BLANK_PREVIEW_SRCDOC = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta name="color-scheme" content="light dark" />',
  '<title>Preview</title>',
  '<style>',
  ':root{color-scheme:light dark}',
  'html,body{margin:0;min-height:100%;background:Canvas;color:CanvasText}',
  'body{background:',
  'radial-gradient(ellipse 78% 58% at 50% 38%, color-mix(in srgb, CanvasText 4%, transparent) 0%, transparent 68%),',
  'Canvas}',
  '</style>',
  '</head>',
  '<body></body>',
  '</html>',
].join('');

export function isThemedBlankPreviewUrl(url: string): boolean {
  const value = url.trim().toLowerCase();
  return (
    value === ''
    || value === 'about:blank'
    || value.startsWith('about:blank?')
    || value.startsWith('about:blank#')
  );
}

// ── Component ────────────────────────────────────────────────────────────

export const BrowserPreview: React.FC<BrowserPreviewProps> = ({
  url,
  onClose,
}) => {
  const themedBlank = isThemedBlankPreviewUrl(url);
  const addressLabel = themedBlank ? (url.trim() || 'about:blank') : url;

  return (
    <section
      className={styles.pane}
      aria-label="内置浏览器预览"
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        {/* Back */}
        <button
          className={styles.navBtn}
          type="button"
          aria-label="后退"
          title="后退"
          disabled
        >
          <DesignNavIcon name="back" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
        </button>

        {/* Forward */}
        <button
          className={styles.navBtn}
          type="button"
          aria-label="前进"
          title="前进"
          disabled
        >
          <DesignNavIcon name="forward" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
        </button>

        {/* Refresh */}
        <button
          className={styles.navBtn}
          type="button"
          aria-label="刷新"
          title="刷新"
        >
          <DesignNavIcon name="refresh" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
        </button>

        {/* Address bar */}
        <div className={styles.address}>
          <span className={styles.addressIcon}>
            <DesignNavIcon name="link" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
          </span>
          <strong className={styles.addressText}>{addressLabel}</strong>
        </div>

        {/* Close */}
        <button
          className={styles.closeBtn}
          type="button"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭预览"
        >
          <DesignNavIcon name="close" size={15} strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH} />
        </button>
      </div>

      {/* ── Iframe ── */}
      <div className={styles.frameShell}>
        {themedBlank ? (
          <iframe
            className={styles.frame}
            title={`预览 ${addressLabel}`}
            srcDoc={THEMED_BLANK_PREVIEW_SRCDOC}
            loading="lazy"
          />
        ) : (
          <iframe
            className={styles.frame}
            title={`预览 ${url}`}
            src={url}
            loading="lazy"
          />
        )}
      </div>

      {/* ── Status bar ── */}
      <div className={styles.status}>
        <span className={styles.statusItem}>Desktop</span>
        <span className={styles.statusItem}>Local Vite</span>
        <span className={styles.statusItem}>只读预览</span>
      </div>
    </section>
  );
};
