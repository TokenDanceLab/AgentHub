// ArtifactPreview — iframe preview + fullscreen + apply-diff support
// Used inline in ChatView and as a fullscreen modal overlay.
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  Image as ImageIcon,
  FileText,
  ExternalLink,
  Check,
  Maximize2,
  RotateCcw,
  AlertCircle,
  Download,
  ArrowRight,
} from 'lucide-react';
import Modal from '@shared/ui/Modal';
import styles from './ArtifactPreview.module.css';

export type ArtifactType = 'iframe' | 'page' | 'image' | 'file';

export interface ArtifactPreviewProps {
  artifactUrl: string;
  artifactType: ArtifactType;
  title?: string | undefined;
  /** When set, the component renders as a clickable inline card inside chat. */
  inline?: boolean | undefined;
  /** Called when the user clicks the "Apply Diff" button. */
  onApplyDiff?: ((artifactUrl: string) => void) | undefined;
  /** True when the diff has already been applied. */
  diffApplied?: boolean | undefined;
}

const TYPE_ICON_MAP: Record<ArtifactType, typeof Globe> = {
  iframe: Globe,
  page: Globe,
  image: ImageIcon,
  file: FileText,
};

const TYPE_LABEL_KEY: Record<ArtifactType, string> = {
  iframe: 'artifact.type.iframe',
  page: 'artifact.type.page',
  image: 'artifact.type.image',
  file: 'artifact.type.file',
};

export default function ArtifactPreview({
  artifactUrl,
  artifactType,
  title,
  inline = false,
  onApplyDiff,
  diffApplied = false,
}: ArtifactPreviewProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [applyState, setApplyState] = useState<'idle' | 'applying' | 'applied' | 'error'>(
    diffApplied ? 'applied' : 'idle',
  );

  const displayTitle = title ?? artifactUrl.split('/').pop() ?? artifactUrl;

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setIframeError(false);
    setIframeLoading(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setIsFullscreen(false);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleRetry = useCallback(() => {
    setIframeError(false);
    setIframeLoading(true);
  }, []);

  const handleApplyDiff = useCallback(async () => {
    if (applyState === 'applied') return;
    try {
      setApplyState('applying');
      window.dispatchEvent(
        new CustomEvent('agenthub:apply-diff', {
          detail: { artifactUrl, title: displayTitle },
        }),
      );
      onApplyDiff?.(artifactUrl);
      setApplyState('applied');
    } catch {
      setApplyState('error');
    }
  }, [applyState, artifactUrl, displayTitle, onApplyDiff]);

  const TypeIcon = TYPE_ICON_MAP[artifactType] ?? FileText;

  // ── Inline card trigger ────────────────────
  if (inline) {
    return (
      <>
        <div
          className={styles.triggerCard}
          onClick={handleOpen}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleOpen();
          }}
          aria-label={t('artifact.openPreview', { title: displayTitle })}
        >
          <div className={styles.triggerIcon}>
            <TypeIcon size={18} />
          </div>
          <div className={styles.triggerInfo}>
            <div className={styles.triggerTitle}>{displayTitle}</div>
            <div className={styles.triggerType}>{t(TYPE_LABEL_KEY[artifactType])}</div>
          </div>
          <ArrowRight size={16} className={styles.triggerArrow} />
        </div>

        <Modal
          open={isOpen}
          onClose={handleClose}
          title={displayTitle}
          fullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        >
          <ArtifactContent
            artifactUrl={artifactUrl}
            artifactType={artifactType}
            displayTitle={displayTitle}
            iframeError={iframeError}
            iframeLoading={iframeLoading}
            applyState={applyState}
            onApplyDiff={onApplyDiff != null ? handleApplyDiff : undefined}
            onIframeLoad={() => setIframeLoading(false)}
            onIframeError={() => {
              setIframeLoading(false);
              setIframeError(true);
            }}
            onRetry={handleRetry}
          />
        </Modal>
      </>
    );
  }

  // ── Embedded (non-inline) render ───────────
  return (
    <div className={styles.root}>
      <ArtifactContent
        artifactUrl={artifactUrl}
        artifactType={artifactType}
        displayTitle={displayTitle}
        iframeError={iframeError}
        iframeLoading={iframeLoading}
        applyState={applyState}
        onApplyDiff={onApplyDiff != null ? handleApplyDiff : undefined}
        onIframeLoad={() => setIframeLoading(false)}
        onIframeError={() => {
          setIframeLoading(false);
          setIframeError(true);
        }}
        onRetry={handleRetry}
      />
    </div>
  );
}

// ── Shared inner renderer ─────────────────────
function ArtifactContent({
  artifactUrl,
  artifactType,
  displayTitle,
  iframeError,
  iframeLoading,
  applyState,
  onApplyDiff,
  onIframeLoad,
  onIframeError,
  onRetry,
}: {
  artifactUrl: string;
  artifactType: ArtifactType;
  displayTitle: string;
  iframeError: boolean;
  iframeLoading: boolean;
  applyState: 'idle' | 'applying' | 'applied' | 'error';
  onApplyDiff?: (() => void) | undefined;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  const sandboxPerms = useMemo(
    () => 'allow-scripts allow-same-origin allow-popups allow-forms',
    [],
  );

  if (iframeError) {
    return (
      <div className={styles.error}>
        <AlertCircle size={32} className={styles.errorIcon} />
        <div className={styles.errorMessage}>
          {t('artifact.error.loadFailed', { url: artifactUrl })}
        </div>
        <button className={styles.retryBtn} onClick={onRetry} type="button">
          <RotateCcw size={14} />
          <span>{t('artifact.retry')}</span>
        </button>
      </div>
    );
  }

  if (artifactType === 'image') {
    return (
      <div className={styles.imageWrapper}>
        <img
          src={artifactUrl}
          alt={displayTitle}
          className={styles.imagePreview}
          onLoad={onIframeLoad}
          onError={onIframeError}
        />
      </div>
    );
  }

  if (artifactType === 'file') {
    return (
      <div className={styles.fileFallback}>
        <FileText size={40} className={styles.fileIcon} />
        <span>{displayTitle}</span>
        <a
          className={styles.downloadLink}
          href={artifactUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={14} />
          <span>{t('artifact.download')}</span>
        </a>
        {onApplyDiff != null && (
          <button
            className={`${styles.actionBtn} ${applyState === 'applied' ? styles.actionBtnApplied : ''}`}
            onClick={onApplyDiff}
            disabled={applyState === 'applied' || applyState === 'applying'}
            type="button"
          >
            {applyState === 'applied' ? (
              <>
                <Check size={14} />
                {t('artifact.diffApplied')}
              </>
            ) : applyState === 'applying' ? (
              t('artifact.applying')
            ) : (
              t('artifact.applyDiff')
            )}
          </button>
        )}
      </div>
    );
  }

  // iframe / page types
  return (
    <div className={styles.frameWrapper}>
      {onApplyDiff != null && (
        <div className={styles.toolbar}>
          <span className={styles.toolbarUrl}>{artifactUrl}</span>
          <button
            className={`${styles.toolbarBtn} ${styles.toolbarBtnPrimary}`}
            onClick={() => window.open(artifactUrl, '_blank', 'noopener,noreferrer')}
            title={t('artifact.openInNewTab')}
            aria-label={t('artifact.openInNewTab')}
            type="button"
          >
            <ExternalLink size={14} />
          </button>
          <button
            className={`${styles.actionBtn} ${applyState === 'applied' ? styles.actionBtnApplied : ''}`}
            onClick={onApplyDiff}
            disabled={applyState === 'applied' || applyState === 'applying'}
            type="button"
          >
            {applyState === 'applied' ? (
              <>
                <Check size={14} />
                {t('artifact.diffApplied')}
              </>
            ) : applyState === 'applying' ? (
              t('artifact.applying')
            ) : (
              t('artifact.applyDiff')
            )}
          </button>
        </div>
      )}
      {iframeLoading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('artifact.loading')}</span>
        </div>
      )}
      <iframe
        src={artifactUrl}
        className={styles.frame}
        title={displayTitle}
        sandbox={sandboxPerms}
        onLoad={onIframeLoad}
        onError={onIframeError}
        style={{ display: iframeLoading ? 'none' : 'block' }}
      />
    </div>
  );
}
