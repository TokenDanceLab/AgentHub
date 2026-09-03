export type SurfacePlatform = 'desktop' | 'web' | 'mobile';

export type SurfaceCategory =
  | 'command-center'
  | 'workspace'
  | 'automation'
  | 'system'
  | 'communication'
  | 'catalog'
  | 'preview';

export type SurfaceStatus =
  | 'realSnapshot'
  | 'localSource'
  | 'loginLocked'
  | 'interfaceGap'
  | 'error'
  | 'demoFallback'
  | 'catalogFallback';

export interface SurfaceStatusMetadata {
  id: SurfaceStatus;
  labelKey: string;
  descriptionKey: string;
}

export interface SurfaceMetadata {
  id: string;
  platform: SurfacePlatform;
  category: SurfaceCategory;
  labelKey: string;
  descriptionKey: string;
  desktopSectionId?: string;
  webRoutePattern?: string;
  defaultStatus: SurfaceStatus;
}

export const SURFACE_STATUS_METADATA = [
  {
    id: 'realSnapshot',
    labelKey: 'surface.status.realSnapshot.label',
    descriptionKey: 'surface.status.realSnapshot.description',
  },
  {
    id: 'localSource',
    labelKey: 'surface.status.localSource.label',
    descriptionKey: 'surface.status.localSource.description',
  },
  {
    id: 'loginLocked',
    labelKey: 'surface.status.loginLocked.label',
    descriptionKey: 'surface.status.loginLocked.description',
  },
  {
    id: 'interfaceGap',
    labelKey: 'surface.status.interfaceGap.label',
    descriptionKey: 'surface.status.interfaceGap.description',
  },
  {
    id: 'error',
    labelKey: 'surface.status.error.label',
    descriptionKey: 'surface.status.error.description',
  },
  {
    id: 'demoFallback',
    labelKey: 'surface.status.demoFallback.label',
    descriptionKey: 'surface.status.demoFallback.description',
  },
  {
    id: 'catalogFallback',
    labelKey: 'surface.status.catalogFallback.label',
    descriptionKey: 'surface.status.catalogFallback.description',
  },
] as const satisfies readonly SurfaceStatusMetadata[];

export const SURFACE_METADATA = [
  {
    id: 'desktop.commandCenter',
    platform: 'desktop',
    category: 'command-center',
    labelKey: 'surface.desktop.commandCenter.label',
    descriptionKey: 'surface.desktop.commandCenter.description',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.general',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.general',
    descriptionKey: 'settings.general.description',
    desktopSectionId: 'general',
    defaultStatus: 'localSource',
  },
  {
    id: 'desktop.settings.appearance',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.appearance',
    descriptionKey: 'settings.appearance.description',
    desktopSectionId: 'appearance',
    defaultStatus: 'localSource',
  },
  {
    id: 'desktop.settings.permissions',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.permissions',
    descriptionKey: 'settings.permissions.description',
    desktopSectionId: 'permissions',
    defaultStatus: 'interfaceGap',
  },
  {
    id: 'desktop.settings.agentProfiles',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.agentProfiles',
    descriptionKey: 'settings.agentProfiles.description',
    desktopSectionId: 'agentProfiles',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.executionTargets',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.executionTargets',
    descriptionKey: 'settings.executionTargets.description',
    desktopSectionId: 'executionTargets',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.tasks',
    platform: 'desktop',
    category: 'workspace',
    labelKey: 'settings.tasks',
    descriptionKey: 'settings.tasks.description',
    desktopSectionId: 'tasks',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.onlineIm',
    platform: 'desktop',
    category: 'communication',
    labelKey: 'settings.onlineIm',
    descriptionKey: 'settings.onlineIm.description',
    desktopSectionId: 'onlineIm',
    defaultStatus: 'loginLocked',
  },
  {
    id: 'desktop.settings.groupChat',
    platform: 'desktop',
    category: 'communication',
    labelKey: 'settings.groupChat',
    descriptionKey: 'settings.groupChat.description',
    desktopSectionId: 'groupChat',
    defaultStatus: 'loginLocked',
  },
  {
    id: 'desktop.settings.agentScheduling',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.agentScheduling',
    descriptionKey: 'settings.agentScheduling.description',
    desktopSectionId: 'agentScheduling',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.agentMarket',
    platform: 'desktop',
    category: 'catalog',
    labelKey: 'settings.agentMarket',
    descriptionKey: 'settings.agentMarket.description',
    desktopSectionId: 'agentMarket',
    defaultStatus: 'loginLocked',
  },
  {
    id: 'desktop.settings.mcp',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.mcp',
    descriptionKey: 'settings.mcp.description',
    desktopSectionId: 'mcp',
    defaultStatus: 'interfaceGap',
  },
  {
    id: 'desktop.settings.skills',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.skills',
    descriptionKey: 'settings.skills.description',
    desktopSectionId: 'skills',
    defaultStatus: 'catalogFallback',
  },
  {
    id: 'desktop.settings.models',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.models',
    descriptionKey: 'settings.models.description',
    desktopSectionId: 'models',
    defaultStatus: 'localSource',
  },
  {
    id: 'desktop.settings.modelMapping',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.modelMapping',
    descriptionKey: 'settings.modelMapping.description',
    desktopSectionId: 'modelMapping',
    defaultStatus: 'localSource',
  },
  {
    id: 'desktop.settings.ccSwitch',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.ccSwitch',
    descriptionKey: 'settings.ccSwitch.description',
    desktopSectionId: 'ccSwitch',
    defaultStatus: 'localSource',
  },
  {
    id: 'desktop.settings.connections',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.connections',
    descriptionKey: 'settings.connections.description',
    desktopSectionId: 'connections',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'desktop.settings.remoteControl',
    platform: 'desktop',
    category: 'automation',
    labelKey: 'settings.remoteControl',
    descriptionKey: 'settings.remoteControl.description',
    desktopSectionId: 'remoteControl',
    defaultStatus: 'interfaceGap',
  },
  {
    id: 'desktop.settings.platforms',
    platform: 'desktop',
    category: 'system',
    labelKey: 'settings.platforms',
    descriptionKey: 'settings.platforms.description',
    desktopSectionId: 'platforms',
    defaultStatus: 'interfaceGap',
  },
  {
    id: 'desktop.settings.account',
    platform: 'desktop',
    category: 'system',
    labelKey: 'settings.account',
    descriptionKey: 'settings.account.description',
    desktopSectionId: 'account',
    defaultStatus: 'loginLocked',
  },
  {
    id: 'desktop.settings.securityAudit',
    platform: 'desktop',
    category: 'system',
    labelKey: 'settings.securityAudit',
    descriptionKey: 'settings.securityAudit.description',
    desktopSectionId: 'securityAudit',
    defaultStatus: 'interfaceGap',
  },
  {
    id: 'mobile.threads',
    platform: 'mobile',
    category: 'communication',
    labelKey: 'surface.mobile.threads.label',
    descriptionKey: 'surface.mobile.threads.description',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'mobile.chat',
    platform: 'mobile',
    category: 'communication',
    labelKey: 'surface.mobile.chat.label',
    descriptionKey: 'surface.mobile.chat.description',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'mobile.runs',
    platform: 'mobile',
    category: 'automation',
    labelKey: 'surface.mobile.runs.label',
    descriptionKey: 'surface.mobile.runs.description',
    defaultStatus: 'realSnapshot',
  },
  {
    id: 'mobile.account',
    platform: 'mobile',
    category: 'system',
    labelKey: 'surface.mobile.account.label',
    descriptionKey: 'surface.mobile.account.description',
    defaultStatus: 'localSource',
  },
] as const satisfies readonly SurfaceMetadata[];

export type SurfaceId = (typeof SURFACE_METADATA)[number]['id'];

export const surfaceStatusById = Object.fromEntries(
  SURFACE_STATUS_METADATA.map((status) => [status.id, status]),
) as Record<SurfaceStatus, SurfaceStatusMetadata>;

export const surfaceMetadataById = Object.fromEntries(
  SURFACE_METADATA.map((surface) => [surface.id, surface]),
) as Record<SurfaceId, SurfaceMetadata>;

export function getSurfaceStatusMetadata(status: SurfaceStatus): SurfaceStatusMetadata {
  return surfaceStatusById[status];
}

export function getSurfaceMetadata(id: SurfaceId): SurfaceMetadata {
  return surfaceMetadataById[id];
}

export function getSurfacesByCategory(category: SurfaceCategory): SurfaceMetadata[] {
  return SURFACE_METADATA.filter((surface) => surface.category === category);
}

export function getSurfacesByPlatform(platform: SurfacePlatform): SurfaceMetadata[] {
  return SURFACE_METADATA.filter((surface) => surface.platform === platform);
}

export function getSurfaceByDesktopSectionId(sectionId: string): SurfaceMetadata | undefined {
  return SURFACE_METADATA.find(
    (surface) => 'desktopSectionId' in surface && surface.desktopSectionId === sectionId,
  );
}

function matchesRoutePattern(route: string, pattern: string): boolean {
  const routeParts = trimSlashes(route).split('/').filter(Boolean);
  const patternParts = trimSlashes(pattern).split('/').filter(Boolean);

  if (routeParts.length !== patternParts.length) {
    return false;
  }

  return patternParts.every((part, index) => part.startsWith(':') || part === routeParts[index]);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
