import type { AttachmentRef } from '../composer/types';

/**
 * Resolves one image attachment into a displayable URL (#1938).
 *
 * Surfaces implement this through `PreviewPort.resolveAttachmentImageUrl`
 * (typically a blob: object URL fetched with the surface's own Hub auth)
 * and register it here at platform construction so the shared transcript
 * UI can reach it without prop threading through workbench glue, which
 * stays platform-agnostic. Returning `undefined` means "this surface cannot
 * serve the content" and the transcript row degrades to the file chip with
 * an honest status notice instead of a broken image.
 */
export type AttachmentImageUrlResolver = (
  attachment: AttachmentRef,
) => Promise<string | undefined>;

let activeResolver: AttachmentImageUrlResolver | undefined;

/**
 * Register the active surface resolver. Last registration wins (a surface
 * re-creating its platform replaces the resolver). Returns an unregister
 * function that clears the slot only if this resolver is still active.
 */
export function registerAttachmentImageUrlResolver(
  resolver: AttachmentImageUrlResolver,
): () => void {
  activeResolver = resolver;
  return () => {
    if (activeResolver === resolver) activeResolver = undefined;
  };
}

/** Current surface resolver, or undefined when no surface registered one. */
export function getAttachmentImageUrlResolver(): AttachmentImageUrlResolver | undefined {
  return activeResolver;
}
