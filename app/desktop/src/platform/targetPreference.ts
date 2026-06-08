export const LOCAL_EDGE_TARGET_ID = 'local-edge';
export const DESKTOP_TARGET_PREFERENCE_KEY = 'agenthub:desktop:target-preference';

export interface DesktopTargetPreference {
  owner: 'desktop';
  targetId: typeof LOCAL_EDGE_TARGET_ID;
  targetType: 'local_edge';
  route: 'local-edge-api';
  source: 'local-edge-sidecar';
}

const desktopLocalEdgePreference: DesktopTargetPreference = {
  owner: 'desktop',
  targetId: LOCAL_EDGE_TARGET_ID,
  targetType: 'local_edge',
  route: 'local-edge-api',
  source: 'local-edge-sidecar',
};

export function resolveDesktopTargetPreference(): DesktopTargetPreference {
  return { ...desktopLocalEdgePreference };
}

export function readDesktopTargetPreference(): DesktopTargetPreference {
  return resolveDesktopTargetPreference();
}

export function writeDesktopTargetPreference(_preference: unknown): DesktopTargetPreference {
  const preference = resolveDesktopTargetPreference();
  localStorage.setItem(DESKTOP_TARGET_PREFERENCE_KEY, JSON.stringify(preference));
  return preference;
}
