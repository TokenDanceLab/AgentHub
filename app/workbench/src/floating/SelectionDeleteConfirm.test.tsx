import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SelectionDeleteConfirm } from './SelectionDeleteConfirm';
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

describe('SelectionDeleteConfirm (#1823)', () => {
  it('renders the count and calls confirm/cancel callbacks', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SelectionDeleteConfirm count={3} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent('确认删除 3 条消息？');
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the confirm button on mount', () => {
    const { container } = render(
      <SelectionDeleteConfirm count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const confirmBtn = screen.getByRole('button', { name: '确认删除' });
    expect(container).toContainElement(confirmBtn);
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('cancels on Escape without deleting', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SelectionDeleteConfirm count={2} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
