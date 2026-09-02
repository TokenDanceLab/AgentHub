import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../__tests__/setup';
import { DocsPage } from './DocsPage';

// Docs copy resolves via the sharedWorkbench namespace; opt into the zh
// bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

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

  it('injects no library shortcuts by default (#2154 P2-2b)', () => {
    render(<DocsPage {...BASE_PROPS} />);

    // The caption + shortcut rows used to come from a page-level default list
    // of repository-internal document names; with no data the block is gone.
    expect(screen.queryByText('我的文档库')).not.toBeInTheDocument();
    expect(screen.queryByText('NewAPI注册和导入CC-switch')).not.toBeInTheDocument();
    expect(screen.queryByText('白盒方向调研报告')).not.toBeInTheDocument();
  });

  it('renders the library block only when shortcuts are supplied', () => {
    render(<DocsPage {...BASE_PROPS} shortcuts={['示例文档']} />);

    expect(screen.getByText('我的文档库')).toBeInTheDocument();
    expect(screen.getByText('示例文档')).toBeInTheDocument();
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
