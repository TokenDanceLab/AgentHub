import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '@/stores/uiStore';

describe('uiStore shell layout state', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      sidebarWidth: 396,
      rightPanelWidth: 360,
      leftSidebarCollapsed: false,
      rightPanelOpen: false,
      mobileSidebarOpen: false,
      mobileRightPanelOpen: false,
    });
  });

  it('tracks desktop sidebar collapse and run panel visibility', () => {
    const store = useUIStore.getState();

    store.setLeftSidebarCollapsed(true);
    store.setRightPanelOpen(true);
    store.setSidebarWidth(420);
    store.setRightPanelWidth(448);

    expect(useUIStore.getState()).toMatchObject({
      leftSidebarCollapsed: true,
      rightPanelOpen: true,
      sidebarWidth: 420,
      rightPanelWidth: 448,
    });
  });

  it('persists only desktop shell layout fields', () => {
    const store = useUIStore.getState();

    store.setLeftSidebarCollapsed(true);
    store.setRightPanelOpen(true);
    store.setMobileSidebarOpen(true);

    const persisted = JSON.parse(localStorage.getItem('agenthub-ui-shell') ?? '{}');

    expect(persisted.state).toEqual({
      sidebarWidth: 396,
      rightPanelWidth: 360,
      leftSidebarCollapsed: true,
      rightPanelOpen: true,
    });
  });
});
