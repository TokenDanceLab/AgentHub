/**
 * Inline audio/video attachment row (#1939).
 *
 * Audio/video attachments (`attachmentKind === 'audio' | 'video'`) render a
 * native `<audio controls>` / `<video controls>` player with a file-name/
 * size subtitle — the same surface contract as the image row (#1938): the
 * media URL is always resolved through the surface-registered platform port
 * (`PreviewPort.resolveAttachmentMediaUrl` via attachmentMediaPort) because
 * Hub attachment endpoints sit behind session auth and a plain player
 * `src` cannot carry the Bearer token. The shared transcript owns no
 * Hub/Edge endpoint. Unresolvable, oversized, or failed loads degrade to
 * the existing file chip plus an explicit status notice; there is no silent
 * dead-player state, and a resolved URL only ever reaches the player `src`
 * after passing the shared safe-scheme gate (mediaPreview.ts).
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AttachmentRef } from '../../composer/types';
import { getAttachmentMediaUrlResolver } from '../../platform/attachmentMediaPort';
import {
  formatPreviewByteLimit,
  isSafeMediaSourceUrl,
  isWithinPreviewSizeLimit,
  maxPreviewBytesForKind,
  type MediaKind,
} from '../../ui/mediaPreview';
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources';
import type { RowItem } from '../types';
import './RowItem.css';

export type MediaUrlState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string }
  | { phase: 'unavailable' }
  | { phase: 'too-large' }
  | { phase: 'failed' };

export interface AttachmentMediaResolution {
  state: MediaUrlState;
  /** The resolved URL stopped loading (media error) — degrade to the chip. */
  markFailed: () => void;
}

/**
 * Resolve one media attachment through the active platform port. Stale-safe:
 * a later attachment id always wins over an in-flight earlier resolution.
 * Oversized attachments (known `size` above the shared threshold) never
 * fetch — the transcript pulls whole blobs into memory, so the pre-gate
 * renders an honest "too large" notice instead. Exported for behavior tests.
 */
export function useAttachmentMediaUrl(
  attachmentRef: AttachmentRef | undefined,
  kind: MediaKind,
): AttachmentMediaResolution {
  const id = attachmentRef?.id?.trim() || undefined;
  const [state, setState] = useState<MediaUrlState>(() => {
    if (!id) return { phase: 'unavailable' };
    const knownSize = attachmentRef && attachmentRef.size > 0 ? attachmentRef.size : undefined;
    return isWithinPreviewSizeLimit(kind, knownSize)
      ? { phase: 'loading' }
      : { phase: 'too-large' };
  });

  useEffect(() => {
    if (!id || !attachmentRef) {
      setState({ phase: 'unavailable' });
      return;
    }
    // A zero size means "mapper had no size", not "empty file" — only a
    // positive size can gate honestly.
    const knownSize = attachmentRef.size > 0 ? attachmentRef.size : undefined;
    if (!isWithinPreviewSizeLimit(kind, knownSize)) {
      setState({ phase: 'too-large' });
      return;
    }
    const resolver = getAttachmentMediaUrlResolver();
    if (!resolver) {
      // No surface registered a resolver (fixture/demo surfaces) — honest
      // chip fallback instead of a dead player.
      setState({ phase: 'unavailable' });
      return;
    }
    let stale = false;
    setState({ phase: 'loading' });
    resolver(attachmentRef, kind)
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
    // stable — key the effect on id/kind only (same contract as #1938).
  }, [id, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const markFailed = useCallback(() => setState({ phase: 'failed' }), []);

  return { state, markFailed };
}

interface MediaAttachmentRowProps {
  item: RowItem;
}

export const MediaAttachmentRow = memo(function MediaAttachmentRow({
  item,
}: MediaAttachmentRowProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const kind: MediaKind = item.attachmentKind === 'video' ? 'video' : 'audio';
  const { state, markFailed } = useAttachmentMediaUrl(item.attachmentRef, kind);

  const name = item.fileName ?? item.attachmentRef?.name ?? '';

  const chip = (notice: string) => (
    <div className="att-row">
      <span className="att-name">{name}</span>
      {item.fileSize && <span className="att-size">{item.fileSize}</span>}
      <span className="att-image-status" role="status">
        {notice}
      </span>
    </div>
  );

  if (state.phase === 'ready') {
    // Defensive scheme gate: even a trusted port resolver must never put a
    // non-http(s)/blob: URL into a player src (#1939 negative requirement).
    if (!isSafeMediaSourceUrl(state.url)) {
      return chip(
        t(kind === 'audio' ? 'card.attachment.audioUnavailable' : 'card.attachment.videoUnavailable'),
      );
    }
    return (
      <>
        {kind === 'audio' ? (
          <audio
            aria-label={t('card.attachment.audioInline', { name })}
            className="att-media-player"
            controls
            preload="metadata"
            src={state.url}
            onError={markFailed}
          />
        ) : (
          <video
            aria-label={t('card.attachment.videoInline', { name })}
            className="att-media-video"
            controls
            preload="metadata"
            src={state.url}
            onError={markFailed}
          />
        )}
        <div className="att-media-sub">
          <span className="att-name">{name}</span>
          {item.fileSize && <span className="att-size">{item.fileSize}</span>}
        </div>
      </>
    );
  }

  if (state.phase === 'loading') {
    return chip(
      t(kind === 'audio' ? 'card.attachment.audioLoading' : 'card.attachment.videoLoading'),
    );
  }

  if (state.phase === 'too-large') {
    return chip(
      t('card.attachment.mediaTooLarge', {
        limit: formatPreviewByteLimit(maxPreviewBytesForKind(kind)),
      }),
    );
  }

  // Unavailable (no resolver / port returned undefined) or failed after a
  // resolved URL: keep the existing chip and say what happened.
  const notice =
    state.phase === 'failed'
      ? t(kind === 'audio' ? 'card.attachment.audioLoadFailed' : 'card.attachment.videoLoadFailed')
      : t(kind === 'audio' ? 'card.attachment.audioUnavailable' : 'card.attachment.videoUnavailable');
  return chip(notice);
});
