import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../../__tests__/setup';
import { DocsPage } from './DocsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const resources: Record<string, string> = {
        'docs.newDoc': '新建文档',
        'docs.empty.title': '暂无文档',
        'docs.empty.description': '创建或上传文档',
        'docs.tab.recent': '最近访问',
        'docs.tab.mine': '归我所有',
        'docs.tab.shared': '与我共享',
        'docs.tab.starred': '收藏',
        'nav.docs': '云文档',
        'header.search': '搜索',
      };
      return resources[key] ?? key;
    },
  }),
}));

const BASE_PROPS = {
  activeNav: 'home',
  onNavChange: () => undefined,
  navItems: [
    { id: 'home', label: '主页', icon: 'home' as const },
  ],
  activeTab: 'recent' as const,
  rows: [],
};

describe('DocsPage empty state', () => {
  it('uses shared EmptyState for the primary empty path and wires the create CTA', () => {
    const onCreateDoc = vi.fn();

    render(<DocsPage {...BASE_PROPS} onCreateDoc={onCreateDoc} />);

    const emptyState = screen.getByRole('region', { name: '暂无文档' });
    expect(within(emptyState).getByText('创建或上传文档')).toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole('button', { name: '新建文档' }));
    expect(onCreateDoc).toHaveBeenCalledTimes(1);
  });

  it('still shows the default EmptyState when create callback is omitted', () => {
    render(<DocsPage {...BASE_PROPS} />);

    const emptyState = screen.getByRole('region', { name: '暂无文档' });
    expect(emptyState).toBeInTheDocument();
    expect(within(emptyState).queryByRole('button', { name: '新建文档' })).not.toBeInTheDocument();
  });

  it('does not render EmptyState when documents are present', () => {
    render(
      <DocsPage
        {...BASE_PROPS}
        rows={[
          {
            id: 'doc-1',
            title: '示例文档',
            location: '我的空间',
            owner: 'Owner',
            time: '今天',
          },
        ]}
      />,
    );

    expect(screen.queryByRole('region', { name: '暂无文档' })).not.toBeInTheDocument();
    expect(screen.getByText('示例文档')).toBeInTheDocument();
  });
});
