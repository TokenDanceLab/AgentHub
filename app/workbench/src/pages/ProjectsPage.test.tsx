import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../__tests__/setup';
import { ProjectsPage } from './ProjectsPage';
import { DEFAULT_PROJECTS } from './projects';
import type { ProjectInfo, ProjectsPageProps } from './projects';

// Projects copy resolves via the sharedWorkbench namespace; opt into the zh
// bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});


function baseProps(overrides: Partial<ProjectsPageProps> = {}): ProjectsPageProps {
  return {
    projects: [],
    activeProjectId: null,
    onProjectSelect: () => undefined,
    activeFilter: 'all',
    onFilterChange: () => undefined,
    activeTab: 'overview',
    onTabChange: () => undefined,
    ...overrides,
  };
}

describe('ProjectsPage empty state', () => {
  it('uses shared EmptyState for the primary empty path and wires the create CTA', () => {
    const onProjectCreate = vi.fn(async () => undefined);
    const onNewProject = vi.fn();

    render(
      <ProjectsPage
        {...baseProps({
          onProjectCreate,
          onNewProject,
        })}
      />,
    );

    const emptyState = screen.getByRole('region', { name: '暂无项目' });
    expect(within(emptyState).getByText('创建第一个项目以开始协作。')).toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole('button', { name: '创建第一个项目' }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '创建项目' })).toBeInTheDocument();
    expect(screen.getByText('项目名称')).toBeInTheDocument();
  });

  it('still shows the default EmptyState when create callback is omitted', () => {
    render(<ProjectsPage {...baseProps()} />);

    const emptyState = screen.getByRole('region', { name: '暂无项目' });
    expect(emptyState).toBeInTheDocument();
    expect(within(emptyState).queryByRole('button', { name: '创建第一个项目' })).not.toBeInTheDocument();
  });

  it('does not render EmptyState when projects are present', () => {
    const projects: ProjectInfo[] = DEFAULT_PROJECTS;

    render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: projects[0]?.id ?? null,
        })}
      />,
    );

    expect(screen.queryByRole('region', { name: '暂无项目' })).not.toBeInTheDocument();
    expect(screen.getAllByText(projects[0]!.name).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: projects[0]!.name })).toBeInTheDocument();
    expect(screen.getByText('项目公告')).toBeInTheDocument();
  });
});

describe('ProjectsPage detail tabs', () => {
  it('switches between overview and runs without losing project chrome', () => {
    const onTabChange = vi.fn();
    const projects = DEFAULT_PROJECTS;

    render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: projects[0]!.id,
          activeTab: 'overview',
          onTabChange,
        })}
      />,
    );

    expect(screen.getByText('项目公告')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '项目运行' }));
    expect(onTabChange).toHaveBeenCalledWith('runs');
  });
});

describe('ProjectsPage per-folder theme color', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-folder-accent');
  });

  it('applies the active folder accent token on render', () => {
    const projects: ProjectInfo[] = DEFAULT_PROJECTS;
    const [first] = projects;
    expect(first?.themeColor).toBe('emerald');

    const { unmount } = render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: first!.id,
        })}
      />,
    );

    expect(document.documentElement.getAttribute('data-folder-accent')).toBe('emerald');
    unmount();
    // cleanup reverts to default (no accent attribute)
    expect(document.documentElement.hasAttribute('data-folder-accent')).toBe(false);
  });

  it('switches --td-accent token when the active folder changes', () => {
    const projects: ProjectInfo[] = DEFAULT_PROJECTS;
    const [first, second] = projects;
    expect(first?.themeColor).toBe('emerald');
    expect(second?.themeColor).toBe('amber');

    const { rerender } = render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: first!.id,
        })}
      />,
    );
    expect(document.documentElement.getAttribute('data-folder-accent')).toBe('emerald');

    rerender(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: second!.id,
        })}
      />,
    );
    expect(document.documentElement.getAttribute('data-folder-accent')).toBe('amber');
  });

  it('leaves no accent attribute when the active folder has no themeColor', () => {
    const projects: ProjectInfo[] = [
      { ...DEFAULT_PROJECTS[0]!, id: 'plain', themeColor: undefined },
    ];

    render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: 'plain',
        })}
      />,
    );

    expect(document.documentElement.hasAttribute('data-folder-accent')).toBe(false);
  });
});

describe('ProjectsPage theme color picker', () => {
  function enterCreateEditor() {
    const onProjectCreate = vi.fn(async () => undefined);
    const onNewProject = vi.fn();

    render(
      <ProjectsPage
        {...baseProps({
          onProjectCreate,
          onNewProject,
        })}
      />,
    );

    const emptyState = screen.getByRole('region', { name: '暂无项目' });
    fireEvent.click(within(emptyState).getByRole('button', { name: '创建第一个项目' }));
    return { onProjectCreate };
  }

  it('renders one swatch per palette color in the create editor', () => {
    enterCreateEditor();

    const swatches = screen.getAllByRole('radio', { name: /Plum|Blue|Emerald|Amber|Rose|Violet|Cyan|Orange/ });
    expect(swatches).toHaveLength(8);
    // No swatch is selected when the create draft starts empty.
    for (const swatch of swatches) {
      expect(swatch).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('selects a swatch on click and reflects it in the draft', () => {
    enterCreateEditor();

    const blue = screen.getByRole('radio', { name: 'Blue' });
    fireEvent.click(blue);

    expect(blue).toHaveAttribute('aria-checked', 'true');
    // Every other swatch stays unselected.
    const others = screen.getAllByRole('radio', { name: /Plum|Emerald|Amber|Rose|Violet|Cyan|Orange/ });
    for (const swatch of others) {
      expect(swatch).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('deselects the active swatch when it is clicked again', () => {
    enterCreateEditor();

    const amber = screen.getByRole('radio', { name: 'Amber' });
    fireEvent.click(amber);
    expect(amber).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(amber);
    expect(amber).toHaveAttribute('aria-checked', 'false');
  });

  it('pre-selects the active project themeColor when editing', () => {
    const projects: ProjectInfo[] = DEFAULT_PROJECTS;
    const [first] = projects;
    const onProjectUpdate = vi.fn(async () => undefined);

    render(
      <ProjectsPage
        {...baseProps({
          projects,
          activeProjectId: first!.id,
          onProjectUpdate,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑项目' }));

    // DEFAULT_PROJECTS[0].themeColor === 'emerald'
    expect(screen.getByRole('radio', { name: 'Emerald' })).toHaveAttribute('aria-checked', 'true');
  });
});
