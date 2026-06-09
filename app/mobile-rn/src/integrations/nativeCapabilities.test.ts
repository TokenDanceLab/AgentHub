import { describe, expect, it, vi } from 'vitest';

import {
  createNativeCapabilityService,
  formatBytes,
  normalizePermission,
} from './nativeCapabilities';

describe('AgentHub native mobile capabilities', () => {
  it('normalizes native permission responses without exposing platform detail', () => {
    expect(normalizePermission({ granted: true, status: 'granted' })).toBe('granted');
    expect(normalizePermission({ status: 'denied', canAskAgain: false })).toBe('blocked');
    expect(normalizePermission({ status: 'denied', canAskAgain: true })).toBe('prompt');
    expect(normalizePermission({ status: 'undetermined' })).toBe('prompt');
    expect(normalizePermission(undefined)).toBe('unavailable');
  });

  it('captures photos only after camera permission is granted', async () => {
    const makeDirectoryAsync = vi.fn(async () => undefined);
    const copyAsync = vi.fn(async () => undefined);
    const service = createNativeCapabilityService({
      imagePicker: {
        getCameraPermissionsAsync: vi.fn(),
        getMediaLibraryPermissionsAsync: vi.fn(),
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: 'granted', granted: true })),
        requestMediaLibraryPermissionsAsync: vi.fn(),
        launchCameraAsync: vi.fn(async () => ({
          canceled: false as const,
          assets: [{
            uri: 'file:///agenthub/photo.jpg',
            width: 1280,
            height: 720,
            fileName: 'photo.jpg',
            fileSize: 2048,
            mimeType: 'image/jpeg',
            type: 'image' as const,
          }],
        })),
        launchImageLibraryAsync: vi.fn(),
      },
      fileSystem: {
        cacheDirectory: 'file:///cache/',
        documentDirectory: 'file:///documents/',
        getTotalDiskSpace: () => undefined,
        getAvailableDiskSpace: () => undefined,
        copyAsync,
        deleteAsync: vi.fn(),
        makeDirectoryAsync,
      },
    });

    await expect(service.captureEvidencePhoto()).resolves.toEqual({
      kind: 'photo',
      source: 'camera',
      uri: 'file:///cache/agenthub-evidence/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
      width: 1280,
      height: 720,
    });
    expect(makeDirectoryAsync).toHaveBeenCalledWith('file:///cache/agenthub-evidence', { intermediates: true });
    expect(copyAsync).toHaveBeenCalledWith({
      from: 'file:///agenthub/photo.jpg',
      to: 'file:///cache/agenthub-evidence/photo.jpg',
    });
  });

  it('does not launch camera or library pickers when permissions are denied', async () => {
    const launchCameraAsync = vi.fn();
    const launchImageLibraryAsync = vi.fn();
    const service = createNativeCapabilityService({
      imagePicker: {
        getCameraPermissionsAsync: vi.fn(),
        getMediaLibraryPermissionsAsync: vi.fn(),
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: 'denied', granted: false, canAskAgain: true })),
        requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ status: 'denied', granted: false, canAskAgain: true })),
        launchCameraAsync,
        launchImageLibraryAsync,
      },
    });

    await expect(service.captureEvidencePhoto()).resolves.toBeUndefined();
    await expect(service.pickEvidenceMedia()).resolves.toEqual([]);
    expect(launchCameraAsync).not.toHaveBeenCalled();
    expect(launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('maps picked photos, videos, and documents into AgentHub evidence attachments', async () => {
    const copyAsync = vi.fn(async () => undefined);
    const makeDirectoryAsync = vi.fn(async () => undefined);
    const launchImageLibraryAsync = vi.fn(async () => ({
      canceled: false as const,
      assets: [
        { uri: 'file:///agenthub/screenshot.png', fileName: 'screenshot.png', mimeType: 'image/png', type: 'image' as const, width: 390, height: 844 },
        { uri: 'file:///agenthub/demo.mp4', fileName: 'demo.mp4', mimeType: 'video/mp4', type: 'video' as const, width: 1280, height: 720 },
      ],
    }));
    const service = createNativeCapabilityService({
      imagePicker: {
        getCameraPermissionsAsync: vi.fn(),
        getMediaLibraryPermissionsAsync: vi.fn(),
        requestCameraPermissionsAsync: vi.fn(),
        requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ status: 'granted', granted: true })),
        launchCameraAsync: vi.fn(),
        launchImageLibraryAsync,
      },
      documentPicker: {
        getDocumentAsync: vi.fn(async () => ({
          canceled: false as const,
          assets: [
            { uri: 'file:///agenthub/evidence.pdf', name: 'evidence.pdf', mimeType: 'application/pdf', size: 4096, lastModified: 0 },
          ],
        })),
      },
      fileSystem: {
        cacheDirectory: 'file:///cache/',
        documentDirectory: 'file:///documents/',
        getTotalDiskSpace: () => undefined,
        getAvailableDiskSpace: () => undefined,
        copyAsync,
        deleteAsync: vi.fn(),
        makeDirectoryAsync,
      },
    });

    await expect(service.pickEvidenceMedia()).resolves.toEqual([
      expect.objectContaining({ kind: 'photo', source: 'library', name: 'screenshot.png', uri: 'file:///cache/agenthub-evidence/screenshot.png' }),
      expect.objectContaining({ kind: 'video', source: 'library', name: 'demo.mp4', uri: 'file:///cache/agenthub-evidence/demo.mp4' }),
    ]);
    expect(launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
      allowsMultipleSelection: true,
      mediaTypes: ['images', 'videos'],
    }));
    await expect(service.pickEvidenceDocument()).resolves.toEqual([
      expect.objectContaining({ kind: 'document', source: 'document', name: 'evidence.pdf', size: 4096, uri: 'file:///cache/agenthub-evidence/evidence.pdf' }),
    ]);
    expect(copyAsync).toHaveBeenCalledWith({
      from: 'file:///agenthub/evidence.pdf',
      to: 'file:///cache/agenthub-evidence/evidence.pdf',
    });
  });

  it('summarizes and clears the AgentHub evidence cache boundary', async () => {
    const deleteAsync = vi.fn(async () => undefined);
    const service = createNativeCapabilityService({
      fileSystem: {
        cacheDirectory: 'file:///cache/',
        documentDirectory: 'file:///documents/',
        getTotalDiskSpace: () => 1000,
        getAvailableDiskSpace: () => 250,
        copyAsync: vi.fn(),
        deleteAsync,
        makeDirectoryAsync: vi.fn(),
      },
    });

    expect(service.getStorageSnapshot()).toEqual({
      cacheUri: 'file:///cache/',
      documentUri: 'file:///documents/',
      totalBytes: 1000,
      availableBytes: 250,
      usedRatio: 0.75,
    });
    await expect(service.clearEvidenceCache()).resolves.toEqual({
      cleared: true,
      targetUri: 'file:///cache/agenthub-evidence',
    });
    expect(deleteAsync).toHaveBeenCalledWith('file:///cache/agenthub-evidence', { idempotent: true });
  });

  it('reports missing cache support without attempting evidence cleanup', async () => {
    const deleteAsync = vi.fn();
    const service = createNativeCapabilityService({
      fileSystem: {
        cacheDirectory: null,
        documentDirectory: null,
        getTotalDiskSpace: () => undefined,
        getAvailableDiskSpace: () => undefined,
        copyAsync: vi.fn(),
        deleteAsync,
        makeDirectoryAsync: vi.fn(),
      },
    });

    await expect(service.clearEvidenceCache()).resolves.toEqual({
      cleared: false,
      reason: 'missing_cache',
    });
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('formats storage sizes for compact mobile settings rows', () => {
    expect(formatBytes(undefined)).toBe('Unknown');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10485760)).toBe('10 MB');
  });
});
