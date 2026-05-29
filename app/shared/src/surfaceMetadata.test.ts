import { describe, expect, it } from 'vitest';
import {
  SURFACE_METADATA,
  SURFACE_STATUS_METADATA,
  getSurfaceByDesktopSectionId,
  getSurfaceByWebRoute,
  getSurfaceMetadata,
  getSurfaceStatusMetadata,
  getSurfacesByCategory,
  getSurfacesByPlatform,
  type SurfaceStatus,
} from './surfaceMetadata';

describe('surfaceMetadata', () => {
  it('defines the exact shared surface status vocabulary with translation keys', () => {
    const expectedStatuses: SurfaceStatus[] = [
      'realSnapshot',
      'localSource',
      'loginLocked',
      'interfaceGap',
      'error',
      'demoFallback',
      'catalogFallback',
    ];

    expect(SURFACE_STATUS_METADATA.map((status) => status.id)).toEqual(expectedStatuses);

    for (const status of SURFACE_STATUS_METADATA) {
      expect(status.labelKey).toMatch(/^surface\.status\.[^.]+\.label$/);
      expect(status.descriptionKey).toMatch(/^surface\.status\.[^.]+\.description$/);
      expect('label' in status).toBe(false);
      expect('description' in status).toBe(false);
    }
  });

  it('keeps surface ids, desktop sections, and web route patterns unique', () => {
    const ids = SURFACE_METADATA.map((surface) => surface.id);
    const desktopSectionIds = SURFACE_METADATA.flatMap((surface) =>
      surface.desktopSectionId === undefined ? [] : [surface.desktopSectionId],
    );
    const webRoutePatterns = SURFACE_METADATA.flatMap((surface) =>
      surface.webRoutePattern === undefined ? [] : [surface.webRoutePattern],
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(desktopSectionIds).size).toBe(desktopSectionIds.length);
    expect(new Set(webRoutePatterns).size).toBe(webRoutePatterns.length);
  });

  it('maps every surface to known status, category, platform, and translation keys', () => {
    const statuses = new Set(SURFACE_STATUS_METADATA.map((status) => status.id));
    const categories = new Set([
      'command-center',
      'workspace',
      'automation',
      'system',
      'communication',
      'catalog',
      'preview',
    ]);

    for (const surface of SURFACE_METADATA) {
      expect(statuses.has(surface.defaultStatus)).toBe(true);
      expect(categories.has(surface.category)).toBe(true);
      expect(['desktop', 'web', 'mobile']).toContain(surface.platform);
      expect(surface.labelKey.length).toBeGreaterThan(0);
      expect(surface.descriptionKey.length).toBeGreaterThan(0);
      expect('label' in surface).toBe(false);
      expect('name' in surface).toBe(false);
      expect('i18nKey' in surface).toBe(false);
      expect('webRoute' in surface).toBe(false);
    }
  });

  it('looks up desktop settings sections', () => {
    expect(getSurfaceByDesktopSectionId('tasks')).toMatchObject({
      id: 'desktop.settings.tasks',
      defaultStatus: 'realSnapshot',
    });
    expect(getSurfaceByDesktopSectionId('remoteControl')).toMatchObject({
      id: 'desktop.settings.remoteControl',
      defaultStatus: 'interfaceGap',
    });
  });

  it('matches web root and parameterized group/project routes', () => {
    expect(getSurfaceByWebRoute('/')).toMatchObject({
      id: 'web.workbench',
      defaultStatus: 'error',
    });
    expect(getSurfaceByWebRoute('/agent-square')).toMatchObject({
      id: 'web.agentSquare',
      defaultStatus: 'catalogFallback',
    });
    expect(getSurfaceByWebRoute('/group/abc')).toMatchObject({
      id: 'web.groupWorkspace',
      defaultStatus: 'demoFallback',
    });
    expect(getSurfaceByWebRoute('/project/foo')).toMatchObject({
      id: 'web.projectPreview',
      defaultStatus: 'demoFallback',
    });
  });

  it('looks up categories and known statuses', () => {
    expect(getSurfaceMetadata('desktop.settings.agentMarket')).toMatchObject({
      category: 'catalog',
      defaultStatus: 'loginLocked',
    });
    expect(getSurfaceStatusMetadata('interfaceGap')).toMatchObject({
      labelKey: 'surface.status.interfaceGap.label',
      descriptionKey: 'surface.status.interfaceGap.description',
    });
    expect(getSurfacesByCategory('communication').map((surface) => surface.id)).toEqual([
      'desktop.settings.onlineIm',
      'desktop.settings.groupChat',
      'web.privateChats',
      'web.groupWorkspace',
      'mobile.threads',
      'mobile.chat',
    ]);
  });

  it('exposes Mobile IA surfaces through the shared registry', () => {
    expect(getSurfacesByPlatform('mobile').map((surface) => surface.id)).toEqual([
      'mobile.threads',
      'mobile.chat',
      'mobile.runs',
      'mobile.account',
    ]);

    expect(getSurfaceMetadata('mobile.runs')).toMatchObject({
      category: 'automation',
      defaultStatus: 'realSnapshot',
    });
  });
});
