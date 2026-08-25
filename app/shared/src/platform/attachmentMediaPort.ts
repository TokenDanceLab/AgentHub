import type { AttachmentRef } from '../composer/types';
import type { MediaKind } from '../ui/mediaPreview';

/**
 * Resolves one audio/video attachment into a displayable URL (#1939).
 *
 * Same surface contract as the image resolver (#1938): surfaces implement
 * this through `PreviewPort.resolveAttachmentMediaUrl` (typically a blob:
 * object URL fetched with the surface's own Hub auth) and register it here
 * at platform construction so the shared transcript UI can reach it without
 * prop threading through workbench glue. `kind` is passed through so the
 * resolver can verify the fetched bytes match the expected media family.
 * Returning `undefined` means "this surface cannot serve the content" and
 * the transcript row degrades to the file chip with an honest status
 * notice instead of a dead player.
 */
export type AttachmentMediaUrlResolver = (
  attachment: AttachmentRef,
  kind: MediaKind,
) => Promise<string | undefined>;

let activeResolver: AttachmentMediaUrlResolver | undefined;

/**
 * Register the active surface resolver. Last registration wins (a surface
 * re-creating its platform replaces the resolver). Returns an unregister
 * function that clears the slot only if this resolver is still active.
 */
export function registerAttachmentMediaUrlResolver(
  resolver: AttachmentMediaUrlResolver,
): () => void {
  activeResolver = resolver;
  return () => {
    if (activeResolver === resolver) activeResolver = undefined;
  };
}

/** Current surface resolver, or undefined when no surface registered one. */
export function getAttachmentMediaUrlResolver(): AttachmentMediaUrlResolver | undefined {
  return activeResolver;
}
