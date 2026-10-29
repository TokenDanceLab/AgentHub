import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LogoutDialog } from './LogoutDialog';

describe('browser logout choices', () => {
  it('offers local and Account logout separately and keeps errors retryable', async () => {
    const local = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const account = vi.fn(async () => undefined);
    const close = vi.fn();
    render(<LogoutDialog open onClose={close} onLogout={local} onLogoutAccount={account} />);
    fireEvent.click(screen.getByRole('button', { name: 'browserSession.logoutLocal' }));
    expect((await screen.findByRole('alert')).textContent).toBe('browserSession.logoutFailed');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'browserSession.logoutAccount' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(account).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledTimes(1);
  });
});
