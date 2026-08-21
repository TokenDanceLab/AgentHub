import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfilePopover } from './ProfilePopover';

describe('ProfilePopover', () => {
  it('portals the account menu outside clipping workbench shells', async () => {
    const user = userEvent.setup();
    const onAccountMenu = vi.fn();

    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <ProfilePopover
          accountMenu={[{ label: '退出登录', style: 'danger' }]}
          isOpen
          name="Ada"
          onAccountMenu={onAccountMenu}
          onClose={vi.fn()}
          variant="account"
        />
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Ada 账号菜单' });
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(onAccountMenu).toHaveBeenCalledWith('退出登录');
  });
});
