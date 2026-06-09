import type * as DocumentPickerTypes from 'expo-document-picker';
import type * as ImagePickerTypes from 'expo-image-picker';

export type NativePermissionState = 'granted' | 'prompt' | 'blocked' | 'unavailable';
export type NativeAttachmentKind = 'photo' | 'video' | 'document';
export type NativeAttachmentSource = 'camera' | 'library' | 'document';

export interface NativePermissionSummary {
  camera: NativePermissionState;
  photos: NativePermissionState;
  notifications: NativePermissionState;
}

export interface NativeAttachment {
  kind: NativeAttachmentKind;
  source: NativeAttachmentSource;
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
}

export interface NativeStorageSnapshot {
  cacheUri?: string;
  documentUri?: string;
  totalBytes?: number;
  availableBytes?: number;
  usedRatio?: number;
}

export interface NativeCacheClearResult {
  cleared: boolean;
  targetUri?: string;
  reason?: 'missing_cache' | 'missing_target' | 'not_supported';
}

interface PermissionLike {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

interface ImagePickerLike {
  getCameraPermissionsAsync: () => Promise<PermissionLike>;
  getMediaLibraryPermissionsAsync: (writeOnly?: boolean) => Promise<PermissionLike>;
  requestCameraPermissionsAsync: () => Promise<PermissionLike>;
  requestMediaLibraryPermissionsAsync: (writeOnly?: boolean) => Promise<PermissionLike>;
  launchCameraAsync: (options?: ImagePickerTypes.ImagePickerOptions) => Promise<ImagePickerTypes.ImagePickerResult>;
  launchImageLibraryAsync: (options?: ImagePickerTypes.ImagePickerOptions) => Promise<ImagePickerTypes.ImagePickerResult>;
}

interface DocumentPickerLike {
  getDocumentAsync: (options?: DocumentPickerTypes.DocumentPickerOptions) => Promise<DocumentPickerTypes.DocumentPickerResult>;
}

interface FileSystemLike {
  cacheDirectory: string | null;
  documentDirectory: string | null;
  getTotalDiskSpace: () => number | undefined;
  getAvailableDiskSpace: () => number | undefined;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
}

export interface NativeCapabilityServiceDeps {
  imagePicker?: ImagePickerLike;
  documentPicker?: DocumentPickerLike;
  fileSystem?: FileSystemLike;
  getNotificationPermission?: () => Promise<PermissionLike>;
}

export interface NativeCapabilityService {
  getPermissions: () => Promise<NativePermissionSummary>;
  requestCameraPermission: () => Promise<NativePermissionState>;
  requestPhotoPermission: () => Promise<NativePermissionState>;
  captureEvidencePhoto: () => Promise<NativeAttachment | undefined>;
  pickEvidenceMedia: () => Promise<NativeAttachment[]>;
  pickEvidenceDocument: () => Promise<NativeAttachment[]>;
  getStorageSnapshot: () => NativeStorageSnapshot;
  clearEvidenceCache: () => Promise<NativeCacheClearResult>;
}

const EVIDENCE_CACHE_DIR = 'agenthub-evidence';

export function createNativeCapabilityService(deps: NativeCapabilityServiceDeps = {}): NativeCapabilityService {
  const imagePicker = deps.imagePicker ?? createUnavailableImagePicker();
  const documentPicker = deps.documentPicker ?? createUnavailableDocumentPicker();
  const fileSystem = deps.fileSystem ?? createUnavailableFileSystemAdapter();

  return {
    async getPermissions() {
      const [camera, photos, notifications] = await Promise.all([
        imagePicker.getCameraPermissionsAsync().then(normalizePermission).catch(() => 'unavailable' as const),
        imagePicker.getMediaLibraryPermissionsAsync(false).then(normalizePermission).catch(() => 'unavailable' as const),
        deps.getNotificationPermission
          ? deps.getNotificationPermission().then(normalizePermission).catch(() => 'unavailable' as const)
          : Promise.resolve('unavailable' as const),
      ]);

      return { camera, photos, notifications };
    },
    async requestCameraPermission() {
      return normalizePermission(await imagePicker.requestCameraPermissionsAsync());
    },
    async requestPhotoPermission() {
      return normalizePermission(await imagePicker.requestMediaLibraryPermissionsAsync(false));
    },
    async captureEvidencePhoto() {
      const permission = normalizePermission(await imagePicker.requestCameraPermissionsAsync());
      if (permission !== 'granted') {
        return undefined;
      }

      const result = await imagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.86,
      });

      return result.canceled ? undefined : cacheImageAsset(result.assets[0], 'camera', fileSystem);
    },
    async pickEvidenceMedia() {
      const permission = normalizePermission(await imagePicker.requestMediaLibraryPermissionsAsync(false));
      if (permission !== 'granted') {
        return [];
      }

      const result = await imagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: true,
        mediaTypes: ['images', 'videos'],
        orderedSelection: true,
        quality: 0.9,
      });

      if (result.canceled) {
        return [];
      }

      const attachments = await Promise.all(
        result.assets.map((asset) => cacheImageAsset(asset, 'library', fileSystem)),
      );
      return attachments.filter((attachment): attachment is NativeAttachment => Boolean(attachment));
    },
    async pickEvidenceDocument() {
      const result = await documentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: ['image/*', 'video/*', 'application/pdf', 'text/*'],
      });

      if (result.canceled) {
        return [];
      }

      return Promise.all(result.assets.map((asset) => cacheDocumentAsset(asset, fileSystem)));
    },
    getStorageSnapshot() {
      const totalBytes = fileSystem.getTotalDiskSpace();
      const availableBytes = fileSystem.getAvailableDiskSpace();
      const usedRatio = totalBytes && availableBytes !== undefined
        ? clampRatio((totalBytes - availableBytes) / totalBytes)
        : undefined;

      return {
        ...(fileSystem.cacheDirectory ? { cacheUri: fileSystem.cacheDirectory } : {}),
        ...(fileSystem.documentDirectory ? { documentUri: fileSystem.documentDirectory } : {}),
        ...(totalBytes !== undefined ? { totalBytes } : {}),
        ...(availableBytes !== undefined ? { availableBytes } : {}),
        ...(usedRatio !== undefined ? { usedRatio } : {}),
      };
    },
    async clearEvidenceCache() {
      if (!fileSystem.cacheDirectory) {
        return { cleared: false, reason: 'missing_cache' };
      }

      const targetUri = `${fileSystem.cacheDirectory}${EVIDENCE_CACHE_DIR}`;
      await fileSystem.deleteAsync(targetUri, { idempotent: true });

      return { cleared: true, targetUri };
    },
  };
}

export function normalizePermission(permission: PermissionLike | null | undefined): NativePermissionState {
  if (!permission) {
    return 'unavailable';
  }
  if (permission.granted || permission.status === 'granted') {
    return 'granted';
  }
  if (permission.status === 'denied' && permission.canAskAgain === false) {
    return 'blocked';
  }
  if (permission.status === 'undetermined' || permission.status === 'denied' || permission.canAskAgain) {
    return 'prompt';
  }

  return 'unavailable';
}

export async function createExpoNativeCapabilityService(
  deps: Omit<NativeCapabilityServiceDeps, 'documentPicker' | 'fileSystem' | 'imagePicker'> = {},
): Promise<NativeCapabilityService> {
  const [imagePicker, documentPicker, fileSystem, legacyFileSystem] = await Promise.all([
    import('expo-image-picker'),
    import('expo-document-picker'),
    import('expo-file-system'),
    import('expo-file-system/legacy'),
  ]);

  return createNativeCapabilityService({
    ...deps,
    imagePicker,
    documentPicker,
    fileSystem: {
      cacheDirectory: legacyFileSystem.cacheDirectory,
      documentDirectory: legacyFileSystem.documentDirectory,
      getTotalDiskSpace: () => safeNumber(() => fileSystem.Paths.totalDiskSpace),
      getAvailableDiskSpace: () => safeNumber(() => fileSystem.Paths.availableDiskSpace),
      copyAsync: legacyFileSystem.copyAsync,
      deleteAsync: legacyFileSystem.deleteAsync,
      makeDirectoryAsync: legacyFileSystem.makeDirectoryAsync,
    },
  });
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function mapImageAsset(
  asset: ImagePickerTypes.ImagePickerAsset | undefined,
  source: Exclude<NativeAttachmentSource, 'document'>,
): NativeAttachment | undefined {
  if (!asset?.uri) {
    return undefined;
  }

  return {
    kind: asset.type === 'video' ? 'video' : 'photo',
    source,
    uri: asset.uri,
    name: asset.fileName ?? asset.uri.split('/').pop() ?? 'agenthub-evidence',
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.fileSize ? { size: asset.fileSize } : {}),
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  };
}

function mapDocumentAsset(asset: DocumentPickerTypes.DocumentPickerAsset): NativeAttachment {
  return {
    kind: asset.mimeType?.startsWith('image/')
      ? 'photo'
      : asset.mimeType?.startsWith('video/')
        ? 'video'
        : 'document',
    source: 'document',
    uri: asset.uri,
    name: asset.name,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.size ? { size: asset.size } : {}),
  };
}

async function cacheImageAsset(
  asset: ImagePickerTypes.ImagePickerAsset | undefined,
  source: Exclude<NativeAttachmentSource, 'document'>,
  fileSystem: FileSystemLike,
): Promise<NativeAttachment | undefined> {
  const attachment = mapImageAsset(asset, source);
  return attachment ? cacheAttachment(attachment, fileSystem) : undefined;
}

async function cacheDocumentAsset(
  asset: DocumentPickerTypes.DocumentPickerAsset,
  fileSystem: FileSystemLike,
): Promise<NativeAttachment> {
  return cacheAttachment(mapDocumentAsset(asset), fileSystem);
}

async function cacheAttachment(attachment: NativeAttachment, fileSystem: FileSystemLike): Promise<NativeAttachment> {
  if (!fileSystem.cacheDirectory || !attachment.uri.startsWith('file:')) {
    return attachment;
  }

  const cacheDir = `${fileSystem.cacheDirectory}${EVIDENCE_CACHE_DIR}`;
  const targetUri = `${cacheDir}/${safeEvidenceFileName(attachment.name)}`;
  if (targetUri === attachment.uri) {
    return attachment;
  }

  await fileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  await fileSystem.copyAsync({ from: attachment.uri, to: targetUri });
  return { ...attachment, uri: targetUri };
}

function safeEvidenceFileName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'agenthub-evidence';
}

function createUnavailableImagePicker(): ImagePickerLike {
  const unavailablePermission = async () => ({ status: 'unavailable', granted: false, canAskAgain: false });
  const canceledImageResult = async () => ({ canceled: true, assets: null }) as ImagePickerTypes.ImagePickerCanceledResult;

  return {
    getCameraPermissionsAsync: unavailablePermission,
    getMediaLibraryPermissionsAsync: unavailablePermission,
    requestCameraPermissionsAsync: unavailablePermission,
    requestMediaLibraryPermissionsAsync: unavailablePermission,
    launchCameraAsync: canceledImageResult,
    launchImageLibraryAsync: canceledImageResult,
  };
}

function createUnavailableDocumentPicker(): DocumentPickerLike {
  return {
    getDocumentAsync: async () => ({ canceled: true, assets: null }),
  };
}

function createUnavailableFileSystemAdapter(): FileSystemLike {
  return {
    cacheDirectory: null,
    documentDirectory: null,
    getTotalDiskSpace: () => undefined,
    getAvailableDiskSpace: () => undefined,
    copyAsync: async () => undefined,
    deleteAsync: async () => undefined,
    makeDirectoryAsync: async () => undefined,
  };
}

function safeNumber(read: () => number): number | undefined {
  try {
    const value = read();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}
