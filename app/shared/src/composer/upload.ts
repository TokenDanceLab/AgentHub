/**
 * Shared attachment upload utilities for Hub Server.
 *
 * The upload flow is:
 * 1. Compute SHA-256 hash of the file (via `computeFileHash`).
 * 2. Optionally probe to check if the file already exists.
 * 3. POST multipart/form-data to `/client/attachments`.
 *
 * All platform-specific wiring (auth token, base URL) is injected via
 * `UploadContext`, keeping this module free of platform imports.
 */

import type { AttachmentRef, ComposerAttachment } from './types';
import { computeFileHash } from './attachments';

export interface AttachmentUploadProgress {
  /** 0-100 percent of the file uploaded. */
  percent: number;
  /** Current phase of the upload. */
  phase: 'hashing' | 'uploading' | 'done';
}

export type ProgressCallback = (progress: AttachmentUploadProgress) => void;

export interface UploadResult {
  attachmentRef: AttachmentRef;
  /** Absolute or relative download URL for the attachment. */
  downloadUrl: string;
}

/**
 * Platform-specific upload context injected by the caller.
 * This keeps the shared layer free of direct platform imports.
 */
export interface AttachmentUploadContext {
  /** Base URL of the Hub server (e.g. `http://127.0.0.1:8080`). */
  hubBaseUrl: string;
  /** Returns the current JWT bearer token, or null if unauthenticated. */
  getToken(): string | null;
  /** Optional probe endpoint — if provided, skips upload for already-stored files. */
  probeHash?: (hash: string) => Promise<{ exists: boolean; attachment?: AttachmentRef }>;
}

/**
 * Upload a single file to the Hub attachment store with progress reporting.
 *
 * Uses XMLHttpRequest instead of fetch to get upload progress events.
 * Falls back to fetch if XHR is not available (e.g. test environments).
 */
export async function uploadAttachmentWithProgress(
  file: File,
  ctx: AttachmentUploadContext,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  // Phase 1: hash
  onProgress?.({ percent: 0, phase: 'hashing' });
  const hash = await computeFileHash(file);
  onProgress?.({ percent: 10, phase: 'hashing' });

  // Phase 2: probe (optional)
  if (ctx.probeHash) {
    const probeResult = await ctx.probeHash(hash);
    if (probeResult.exists && probeResult.attachment) {
      const downloadUrl = `${ctx.hubBaseUrl}/client/attachments/${encodeURIComponent(probeResult.attachment.id)}`;
      onProgress?.({ percent: 100, phase: 'done' });
      return {
        attachmentRef: probeResult.attachment,
        downloadUrl,
      };
    }
  }

  // Phase 3: upload via XHR for progress
  const formData = new FormData();
  formData.append('file', file);
  formData.append('hash', hash);
  formData.append('original_name', file.name);

  const result = await new Promise<UploadResult>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      // Fallback for test environments — use fetch without progress
      void uploadViaFetch(formData, ctx).then(resolve, reject);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ctx.hubBaseUrl}/client/attachments`);

    const token = ctx.getToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event): void => {
      if (!event.lengthComputable) return;
      // Map upload progress to 15-95% range (hashing took 0-10%, probing 10-15%)
      const uploadPercent = Math.round((event.loaded / event.total) * 100);
      const overallPercent = 15 + Math.round(uploadPercent * 0.8);
      onProgress?.({ percent: overallPercent, phase: 'uploading' });
    };

    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = parseHubResponse<AttachmentRef>(xhr.responseText);
          const downloadUrl = `${ctx.hubBaseUrl}/client/attachments/${encodeURIComponent(response.id)}`;
          onProgress?.({ percent: 100, phase: 'done' });
          resolve({
            attachmentRef: {
              id: response.id,
              name: response.original_name ?? file.name,
              ...(response.original_name ? { original_name: response.original_name } : {}),
              size: response.size,
              mime_type: response.mime_type,
              ...(response.hash ? { hash: response.hash } : { hash }),
              url: downloadUrl,
              ...(response.metadata ? { metadata: response.metadata } : {}),
              ...(response.created_at ? { created_at: response.created_at } : {}),
            },
            downloadUrl,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse upload response: ${parseError}`));
        }
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = (): void => {
      reject(new Error('Upload failed: network error'));
    };

    xhr.send(formData);
  });

  return result;
}

/**
 * Upload an array of pending attachments sequentially.
 * Returns a new array with `attachmentRef` populated for each uploaded file.
 */
export async function uploadPendingAttachmentsWithProgress(
  attachments: ComposerAttachment[],
  ctx: AttachmentUploadContext,
  onProgress?: (attachmentIndex: number, progress: AttachmentUploadProgress) => void,
): Promise<ComposerAttachment[]> {
  return Promise.all(attachments.map(async (attachment, index) => {
    // Already uploaded or no File to upload
    if (attachment.attachmentRef || !attachment.file) return attachment;

    try {
      const result = await uploadAttachmentWithProgress(
        attachment.file,
        ctx,
        (progress) => onProgress?.(index, progress),
      );
      return {
        ...attachment,
        attachmentRef: result.attachmentRef,
      };
    } catch {
      // If upload fails, keep the attachment without a ref so the text
      // content is still included in the message.
      return attachment;
    }
  }));
}

/** Parse the Hub envelope response and extract the data field. */
function parseHubResponse<T>(responseText: string): T {
  const body = JSON.parse(responseText);
  if (body && typeof body === 'object' && typeof body.code === 'string') {
    // Hub envelope format: { code: "ok", data: ... }
    if (body.data) return body.data as T;
  }
  // Direct response (no envelope)
  return body as T;
}

/** Fallback upload using fetch (no progress). */
async function uploadViaFetch(
  formData: FormData,
  ctx: AttachmentUploadContext,
): Promise<UploadResult> {
  const token = ctx.getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${ctx.hubBaseUrl}/client/attachments`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`);
  }

  const response = parseHubResponse<AttachmentRef>(await res.text());
  const downloadUrl = `${ctx.hubBaseUrl}/client/attachments/${encodeURIComponent(response.id)}`;
  return {
    attachmentRef: {
      id: response.id,
      name: response.original_name ?? '',
      ...(response.original_name ? { original_name: response.original_name } : {}),
      size: response.size,
      mime_type: response.mime_type,
      ...(response.hash ? { hash: response.hash } : {}),
      url: downloadUrl,
      ...(response.metadata ? { metadata: response.metadata } : {}),
      ...(response.created_at ? { created_at: response.created_at } : {}),
    },
    downloadUrl,
  };
}
