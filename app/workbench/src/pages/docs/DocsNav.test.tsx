/* ═══════════════════════════════════════════════════════════════════════
   DocsNav — frozen-input gate + no fabricated library/badge (#2154 P1-1,
   P2-2b).

   Three honesty claims are pinned here:
   1. the search box is disabled (with a reason) until a handler is wired;
   2. the "我的文档库" caption + shortcut list only render with real data, so
      repository-internal document names are never injected by default;
   3. the 离线 nav row carries no permanent "下载中..." badge.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../__tests__/setup';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { DocsNav } from './DocsNav';
import { DEFAULT_NAV_ITEMS } from './shared';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function baseProps(overrides: Partial<Parameters<typeof DocsNav>[0]> = {}) {
  return {
    activeNav: 'home',
    onNavChange: () => undefined,
    navItems: [],
    shortcuts: [],
    ...overrides,
  };
}

describe('DocsNav search gate (#2154 P1-1)', () => {
  it('disables the search input and states why when no handler is wired', () => {
    render(<DocsNav {...baseProps()} />);

    const input = screen.getByPlaceholderText('搜索');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('title', '该搜索框还没有接入数据源，暂时不可用。');
  });

  it('keeps a wired search input editable', () => {
    const onSearchChange = vi.fn();
    render(<DocsNav {...baseProps({ onSearchChange })} />);

    const input = screen.getByPlaceholderText('搜索');
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: '设计' } });
    expect(onSearchChange).toHaveBeenCalledWith('设计');
  });
});

describe('DocsNav shortcut block (#2154 P2-2b)', () => {
  it('renders neither the caption nor shortcuts when there is no data', () => {
    render(<DocsNav {...baseProps({ shortcuts: [] })} />);

    expect(screen.queryByText('我的文档库')).not.toBeInTheDocument();
  });

  it('renders caption + shortcuts when the data source provides them', () => {
    const onShortcutClick = vi.fn();
    render(<DocsNav {...baseProps({ shortcuts: ['示例文档'], onShortcutClick })} />);

    expect(screen.getByText('我的文档库')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '示例文档' }));
    expect(onShortcutClick).toHaveBeenCalledWith('示例文档');
  });
});

describe('DocsNav offline row (#2154 P2-2b)', () => {
  it('carries no permanent "下载中..." badge in the default nav items', () => {
    const download = DEFAULT_NAV_ITEMS.find((item) => item.id === 'download');
    expect(download).toBeDefined();
    expect(download?.trailing).toBeUndefined();

    render(<DocsNav {...baseProps()} />);
    expect(screen.queryByText('下载中...')).not.toBeInTheDocument();
  });
});
