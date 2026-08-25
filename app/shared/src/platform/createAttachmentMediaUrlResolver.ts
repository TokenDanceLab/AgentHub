/**
 * Surface-agnostic factory for `PreviewPort.resolveAttachmentMediaUrl` (#1939).
 *
 * Same Hub blob-fetch contract as the image resolver (#1938) — Hub serves
 * `GET /client/attachments/:id` behind session auth, so a plain
 * `<audio src>` / `<video src>` cannot carry the Bearer token; the
 * resolver fetches with the surface's own token and hands the transcript a
 * blob: object URL. Each media kind gets its own resolver instance (own
 * cache, own byte gate) so an audio row can never receive video bytes:
 * when the Hub-reported blob type is set and does not match the requested
 * kind, the resolver yields `undefined` and the row degrades to the file
 * chip with an honest status notice.
 *
 * Size note: transcript rows fetch the whole attachment into memory, so
 * the MediaAttachment row pre-gates on `AttachmentRef.size` against the
 * shared thresholds (mediaPreview.ts) before ever calling this resolver.
 */
import type { AttachmentRef } from '../composer/types';
import type { MediaKind } from '../ui/mediaPreview';
import type { AttachmentMediaUrlResolver } from './attachmentMediaPort';
import {
  createAttachmentObjectUrlResolver,
  type AttachmentImageUrlResolverDeps,
} from './createAttachmentImageUrlResolver';

/** Resolver deps are identical to the image factory (same Hub contract). */
export type AttachmentMediaUrlResolverDeps = AttachmentImageUrlResolverDeps;

export function createAttachmentMediaUrlResolver(
  deps: AttachmentMediaUrlResolverDeps,
): AttachmentMediaUrlResolver {
  const audioResolver = createAttachmentObjectUrlResolver(
    deps,
    (blob) => !blob.type || blob.type.startsWith('audio/'),
  );
  const videoResolver = createAttachmentObjectUrlResolver(
    deps,
    (blob) => !blob.type || blob.type.startsWith('video/'),
  );
  return function resolveAttachmentMediaUrl(
    attachment: AttachmentRef,
    kind: MediaKind,
  ): Promise<string | undefined> {
    return kind === 'audio' ? audioResolver(attachment) : videoResolver(attachment);
  };
}
