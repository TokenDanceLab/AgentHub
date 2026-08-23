import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SelectionDeleteConfirm } from './SelectionDeleteConfirm';
import { chatviewResources } from '@shared/chatview/i18n/resources';
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

// #1823: expected copy derives from the real resource bundle instead of
// duplicating localized strings (a label rename must not break behavior
// assertions that have nothing to do with the wording).
const zh = chatviewResources.zh;
const confirmTitle = (count: number): string =>
  zh['selection.confirmDeleteTitle'].replace('{{count}}', String(count));
const confirmLabel = zh['selection.confirmDelete'];
const cancelLabel = zh['selection.cancelDelete'];

describe('SelectionDeleteConfirm (#1823)', () => {
  it('renders the count and calls confirm/cancel callbacks', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SelectionDeleteConfirm count={3} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent(confirmTitle(3));
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: cancelLabel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the confirm button on mount', () => {
    const { container } = render(
      <SelectionDeleteConfirm count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const confirmBtn = screen.getByRole('button', { name: confirmLabel });
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
