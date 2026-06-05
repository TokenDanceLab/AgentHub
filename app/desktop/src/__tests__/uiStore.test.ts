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
      leftSidebarView: 'home',
      activeRailView: 'home',
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
      rightPanelWidth: 360,
    });
  });

  it('tracks active rail view', () => {
    const store = useUIStore.getState();

    store.setActiveRailView('messages');
    expect(useUIStore.getState().activeRailView).toBe('messages');

    store.setActiveRailView('agents');
    expect(useUIStore.getState().activeRailView).toBe('agents');

    store.setActiveRailView('home');
    expect(useUIStore.getState().activeRailView).toBe('home');
  });

  it('persists only desktop shell layout fields', () => {
    const store = useUIStore.getState();

    store.setLeftSidebarCollapsed(true);
    store.setRightPanelOpen(true);
    store.setActiveRailView('messages');
    store.setMobileSidebarOpen(true);

    const persisted = JSON.parse(localStorage.getItem('agenthub-ui-shell') ?? '{}');

    expect(persisted.state).toEqual({
      sidebarWidth: 396,
      rightPanelWidth: 360,
      leftSidebarCollapsed: true,
      rightPanelOpen: true,
      leftSidebarView: 'home',
      activeRailView: 'messages',
    });
  });

  it('migrates persisted state without activeRailView to default home', async () => {
    localStorage.setItem('agenthub-ui-shell', JSON.stringify({
      version: 2,
      state: {
        sidebarWidth: 320,
        rightPanelWidth: 360,
        leftSidebarCollapsed: false,
        rightPanelOpen: false,
        leftSidebarView: 'thread',
      },
    }));

    await useUIStore.persist.rehydrate();

    expect(useUIStore.getState()).toMatchObject({
      sidebarWidth: 320,
      rightPanelWidth: 360,
      leftSidebarCollapsed: false,
      rightPanelOpen: false,
      leftSidebarView: 'thread',
      activeRailView: 'home',
    });
  });
});
