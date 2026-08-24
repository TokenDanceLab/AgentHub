/**
 * Inline image attachment row (#1938).
 *
 * Image attachments (`contentType === 'image'`) render a thumbnail with a
 * file-name/size subtitle; clicking (or Enter/Space) opens a lightbox built
 * on the shared Modal (focus trap + Escape + focus return). The image URL
 * is always resolved through the surface-registered platform port
 * (`PreviewPort.resolveAttachmentImageUrl` via attachmentImagePort) — the
 * shared transcript owns no Hub/Edge endpoint. Unresolvable or failed
 * loads degrade to the existing file chip plus an explicit status notice;
 * there is no silent broken-image state.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AttachmentRef } from '../../composer/types';
import { getAttachmentImageUrlResolver } from '../../platform/attachmentImagePort';
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources';
import type { RowItem } from '../types';
import { Modal } from '../../ui/Modal';
import './RowItem.css';

export type ImageUrlState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string }
  | { phase: 'unavailable' }
  | { phase: 'failed' };

export interface AttachmentImageResolution {
  state: ImageUrlState;
  /** The resolved URL stopped loading (img error) — degrade to the chip. */
  markFailed: () => void;
}

/**
 * Resolve one attachment through the active platform port. Stale-safe: a
 * later attachment id always wins over an in-flight earlier resolution.
 * Exported for behavior tests.
 */
export function useAttachmentImageUrl(
  attachmentRef: AttachmentRef | undefined,
): AttachmentImageResolution {
  const id = attachmentRef?.id?.trim() || undefined;
  const [state, setState] = useState<ImageUrlState>(() =>
    id ? { phase: 'loading' } : { phase: 'unavailable' },
  );

  useEffect(() => {
    if (!id || !attachmentRef) {
      setState({ phase: 'unavailable' });
      return;
    }
    const resolver = getAttachmentImageUrlResolver();
    if (!resolver) {
      // No surface registered a resolver (fixture/demo surfaces) — honest
      // chip fallback instead of a dead <img>.
      setState({ phase: 'unavailable' });
      return;
    }
    let stale = false;
    setState({ phase: 'loading' });
    resolver(attachmentRef)
      .then((url) => {
        if (stale) return;
        setState(url ? { phase: 'ready', url } : { phase: 'unavailable' });
      })
      .catch(() => {
        if (!stale) setState({ phase: 'unavailable' });
      });
    return () => {
      stale = true;
    };
    // The ref identity can change per adapter pass while the block id is
    // stable — key the effect on the id only.
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markFailed = useCallback(() => setState({ phase: 'failed' }), []);

  return { state, markFailed };
}

interface ImageAttachmentRowProps {
  item: RowItem;
}

export const ImageAttachmentRow = memo(function ImageAttachmentRow({
  item,
}: ImageAttachmentRowProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { state, markFailed } = useAttachmentImageUrl(item.attachmentRef);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomFailed, setZoomFailed] = useState(false);

  const name = item.fileName ?? item.attachmentRef?.name ?? '';

  const openZoom = useCallback(() => {
    setZoomFailed(false);
    setZoomOpen(true);
  }, []);
  const closeZoom = useCallback(() => setZoomOpen(false), []);

  if (state.phase === 'ready') {
    const { url } = state;
    return (
      <>
        <button
          type="button"
          className="att-image-thumb"
          aria-label={t('card.attachment.imageEnlarge', { name })}
          onClick={openZoom}
        >
          <img
            src={url}
            alt={name}
            className="att-image-img"
            loading="lazy"
            onError={markFailed}
          />
        </button>
        <div className="att-image-sub">
          <span className="att-name">{name}</span>
          {item.fileSize && <span className="att-size">{item.fileSize}</span>}
        </div>
        <Modal open={zoomOpen} onClose={closeZoom} title={name}>
          {zoomFailed ? (
            <div className="att-image-lightbox-fail" role="status">
              {t('card.attachment.imageLoadFailed')}
            </div>
          ) : (
            <img
              src={url}
              alt={name}
              className="att-image-lightbox-img"
              onError={() => setZoomFailed(true)}
            />
          )}
        </Modal>
      </>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="att-row">
        <span className="att-name">{name}</span>
        {item.fileSize && <span className="att-size">{item.fileSize}</span>}
        <span className="att-image-status" role="status">
          {t('card.attachment.imageLoading')}
        </span>
      </div>
    );
  }

  // Unavailable (no resolver / port returned undefined) or failed after a
  // resolved URL: keep the existing chip and say what happened.
  const notice =
    state.phase === 'failed'
      ? t('card.attachment.imageLoadFailed')
      : t('card.attachment.imageUnavailable');
  return (
    <div className="att-row">
      <span className="att-name">{name}</span>
      {item.fileSize && <span className="att-size">{item.fileSize}</span>}
      <span className="att-image-status" role="status">
        {notice}
      </span>
    </div>
  );
});
