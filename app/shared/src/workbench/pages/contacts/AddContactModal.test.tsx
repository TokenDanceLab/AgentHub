import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddContactModal } from './AddContactModal';
import { useTestI18nLanguage } from '../../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

const TAB_LABELS = ['企业二维码', '企业链接', '企业邀请码', '手机号'];

function renderModal(overrides: Partial<Parameters<typeof AddContactModal>[0]> = {}) {
  return render(<AddContactModal onClose={vi.fn()} {...overrides} />);
}

describe('AddContactModal', () => {
  it('renders a modal dialog with aria-modal', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('添加联系人')).toBeInTheDocument();
  });

  it('renders tablist with aria-selected on the active tab', () => {
    renderModal();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(4);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps only the active tab in the tab order', () => {
    renderModal();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves initial focus into the dialog (close button on QR tab)', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByLabelText('关闭'));
  });

  it('moves focus to the first input when the phone panel is active', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: '手机号' }));
    const phoneInput = screen.getByPlaceholderText('输入手机号');
    phoneInput.focus();
    expect(document.activeElement).toBe(phoneInput);
  });

  it('traps Tab: wraps from the last focusable back to the first', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: '手机号' }));
    const sendButton = screen.getByText('发送邀请');
    sendButton.focus();
    fireEvent.keyDown(sendButton, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('关闭'));
  });

  it('traps Shift+Tab: wraps from the first focusable to the last', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: '手机号' }));
    const closeBtn = screen.getByLabelText('关闭');
    closeBtn.focus();
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('发送邀请'));
  });

  it('moves between tabs with Arrow keys and updates aria-selected', () => {
    renderModal();
    const activeTab = screen.getByRole('tab', { name: '企业二维码' });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: 'ArrowRight' });
    const linkTab = screen.getByRole('tab', { name: '企业链接' });
    expect(document.activeElement).toBe(linkTab);
    expect(linkTab).toHaveAttribute('aria-selected', 'true');
    expect(activeTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('邀请链接')).toBeInTheDocument();
  });

  it('supports ArrowLeft navigation in the tablist', () => {
    renderModal();
    const activeTab = screen.getByRole('tab', { name: '企业二维码' });
    activeTab.focus();
    // Wrap backwards: 企业二维码 → 手机号
    fireEvent.keyDown(activeTab, { key: 'ArrowLeft' });
    const phoneTab = screen.getByRole('tab', { name: '手机号' });
    expect(document.activeElement).toBe(phoneTab);
    expect(phoneTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('输入手机号')).toBeInTheDocument();
  });

  it('jumps to the last tab on End and first on Home', () => {
    renderModal();
    const activeTab = screen.getByRole('tab', { name: '企业二维码' });
    activeTab.focus();
    fireEvent.keyDown(activeTab, { key: 'End' });
    const phoneTab = screen.getByRole('tab', { name: '手机号' });
    expect(document.activeElement).toBe(phoneTab);
    expect(phoneTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(phoneTab, { key: 'Home' });
    const qrTab = screen.getByRole('tab', { name: '企业二维码' });
    expect(document.activeElement).toBe(qrTab);
    expect(qrTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches panel when a tab is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: '企业链接' }));
    expect(screen.getByText('复制链接')).toBeInTheDocument();
  });

  it('calls onClose when clicking the backdrop', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
