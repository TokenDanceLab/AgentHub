/* ═══════════════════════════════════════════════════════════════════════
   ProjectMain — optional first-load skeleton + i18n-driven empty state.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../__tests__/setup';
import { ProjectMain } from './ProjectMain';
import type { ProjectMainProps } from './ProjectMain';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const resources: Record<string, string> = {
        'projects.empty.title': '暂无项目',
        'projects.empty.description': '创建第一个项目后开始协作',
        'projects.empty.createFirst': '创建第一个项目',
        'projects.edit': '编辑项目',
      };
      return resources[key] ?? key;
    },
  }),
}));

function baseProps(overrides: Partial<ProjectMainProps> = {}): ProjectMainProps {
  return {
    activeProject: null,
    activeTab: 'overview',
    onTabChange: () => undefined,
    canCreateProject: true,
    canUpdateProject: true,
    editorMode: null,
    draft: { name: '', description: '' },
    onDraftChange: () => undefined,
    onCancelEdit: () => undefined,
    onSubmitEdit: () => undefined,
    onStartCreate: () => undefined,
    onStartUpdate: () => undefined,
    ...overrides,
  };
}

describe('ProjectMain first-load skeleton', () => {
  it('shows the detail skeleton while loading with no active project', () => {
    render(<ProjectMain {...baseProps({ loading: true })} />);

    expect(screen.getByTestId('project-detail-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '暂无项目' })).not.toBeInTheDocument();
  });

  it('falls back to the i18n empty state when not loading', () => {
    render(<ProjectMain {...baseProps({ loading: false })} />);

    expect(screen.queryByTestId('project-detail-skeleton')).not.toBeInTheDocument();
    const emptyState = screen.getByRole('region', { name: '暂无项目' });
    expect(emptyState).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建第一个项目' })).toBeInTheDocument();
  });

  it('treats an omitted loading prop as not loading (backwards compatible)', () => {
    render(<ProjectMain {...baseProps()} />);

    expect(screen.queryByTestId('project-detail-skeleton')).not.toBeInTheDocument();
  });
});
