import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../../__tests__/setup';
import { ProjectsPage } from './ProjectsPage';
import { DEFAULT_PROJECTS } from './projects';
import type { ProjectInfo, ProjectsPageProps } from './projects';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const resources: Record<string, string> = {
        'nav.projects': '项目',
        'projects.newProject': '新建项目',
        'projects.loading': '正在加载项目…',
        'projects.empty.title': '暂无项目',
        'projects.empty.description': '创建第一个项目后开始协作',
        'projects.empty.createFirst': '创建第一个项目',
        'projects.nav.all': '全部',
        'projects.nav.running': '进行中',
        'projects.nav.completed': '已完成',
        'projects.nav.archived': '归档',
        'projects.tab.overview': '概览',
        'projects.projectRuns': '运行',
        'projects.tab.settings': '设置',
        'inspector.artifacts': '产物',
        'header.search': '搜索',
      };
      return resources[key] ?? key;
    },
  }),
}));

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
    expect(within(emptyState).getByText('创建第一个项目后开始协作')).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: /运行/ }));
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
