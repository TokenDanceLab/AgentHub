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
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface BrowserPreviewProps {
  url: string;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const BrowserPreview: React.FC<BrowserPreviewProps> = ({
  url,
  onClose,
}) => {
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
          <strong className={styles.addressText}>{url}</strong>
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
        <iframe
          className={styles.frame}
          title={`预览 ${url}`}
          src={url}
          loading="lazy"
        />
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
