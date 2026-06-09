import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createExpoNativeCapabilityService,
  createNativeCapabilityService,
  formatBytes,
  type NativePermissionState,
  type NativeStorageSnapshot,
  type NativeCapabilityService,
} from './nativeCapabilities';

export type NativeCapabilityAction = 'camera' | 'photos' | 'documents' | 'clearCache';

export interface NativeCapabilityStatus {
  camera: NativePermissionState;
  photos: NativePermissionState;
  notifications: NativePermissionState;
  storage: NativeStorageSnapshot;
  storageLabel: string;
  lastAction?: {
    action: NativeCapabilityAction;
    success: boolean;
    count?: number;
  };
  ready: boolean;
}

interface UseNativeCapabilitiesResult {
  status: NativeCapabilityStatus;
  refresh: () => Promise<void>;
  requestCamera: () => Promise<void>;
  requestPhotos: () => Promise<void>;
  capturePhoto: () => Promise<void>;
  pickMedia: () => Promise<void>;
  pickDocument: () => Promise<void>;
  clearCache: () => Promise<void>;
}

const initialStatus: NativeCapabilityStatus = {
  camera: 'unavailable',
  photos: 'unavailable',
  notifications: 'unavailable',
  storage: {},
  storageLabel: formatStorageLabel({}),
  ready: false,
};

export function useNativeCapabilities(): UseNativeCapabilitiesResult {
  const [service, setService] = useState<NativeCapabilityService>(() => createNativeCapabilityService());
  const [status, setStatus] = useState<NativeCapabilityStatus>(initialStatus);

  useEffect(() => {
    let cancelled = false;

    if (isWebPreviewRuntime()) {
      setStatus(initialStatus);
      return () => {
        cancelled = true;
      };
    }

    createExpoNativeCapabilityService().then((nativeService) => {
      if (!cancelled) {
        setService(nativeService);
      }
    }).catch(() => {
      if (!cancelled) {
        setStatus(initialStatus);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [permissions, storage] = await Promise.all([
      service.getPermissions(),
      Promise.resolve(service.getStorageSnapshot()),
    ]);

    setStatus((current) => ({
      ...current,
      ...permissions,
      storage,
      storageLabel: formatStorageLabel(storage),
      ready: permissions.camera !== 'unavailable' || permissions.photos !== 'unavailable' || Boolean(storage.cacheUri),
    }));
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(async (
    action: NativeCapabilityAction,
    execute: () => Promise<{ success: boolean; count?: number }>,
  ) => {
    try {
      const result = await execute();
      setStatus((current) => ({ ...current, lastAction: { action, ...result } }));
    } finally {
      await refresh();
    }
  }, [refresh]);

  return useMemo(() => ({
    status,
    refresh,
    requestCamera: () => runAction('camera', async () => ({
      success: await service.requestCameraPermission() === 'granted',
    })),
    requestPhotos: () => runAction('photos', async () => ({
      success: await service.requestPhotoPermission() === 'granted',
    })),
    capturePhoto: () => runAction('camera', async () => ({
      count: await service.captureEvidencePhoto() ? 1 : 0,
      success: true,
    })),
    pickMedia: () => runAction('photos', async () => {
      const attachments = await service.pickEvidenceMedia();
      return { count: attachments.length, success: true };
    }),
    pickDocument: () => runAction('documents', async () => {
      const attachments = await service.pickEvidenceDocument();
      return { count: attachments.length, success: true };
    }),
    clearCache: () => runAction('clearCache', async () => {
      const result = await service.clearEvidenceCache();
      return { success: result.cleared };
    }),
  }), [refresh, runAction, service, status]);
}

export function formatStorageLabel(snapshot: NativeStorageSnapshot): string {
  if (snapshot.availableBytes === undefined && snapshot.totalBytes === undefined) {
    return formatBytes(undefined);
  }

  if (snapshot.availableBytes === undefined) {
    return formatBytes(snapshot.totalBytes);
  }

  if (snapshot.totalBytes === undefined) {
    return formatBytes(snapshot.availableBytes);
  }

  return `${formatBytes(snapshot.availableBytes)} / ${formatBytes(snapshot.totalBytes)}`;
}

function isWebPreviewRuntime(): boolean {
  return typeof (globalThis as typeof globalThis & { window?: unknown }).window !== 'undefined';
}
