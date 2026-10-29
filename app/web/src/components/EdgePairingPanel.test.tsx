import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { getI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionTarget } from '@/api/hubClient';
import en from '@/i18n/locales/en/common.json';
import zh from '@/i18n/locales/zh/common.json';
import { EdgePairingPanel } from './EdgePairingPanel';

const api = vi.hoisted(() => ({ previewEdgeEnrollment: vi.fn(), confirmEdgeEnrollment: vi.fn(), revokeEdgeDevice: vi.fn() }));
const inventory = vi.hoisted(() => ({ items: [] as ExecutionTarget[] }));
const session = vi.hoisted(() => ({ generation: 0 }));
vi.mock('@/api/browserSessionRuntime', () => ({ getBrowserSessionGeneration: () => session.generation }));
vi.mock('@/api/hubClient', () => ({ createHubClient: () => api }));
vi.mock('@/api/executionTargetQueries', () => ({ useHubExecutionTargets: () => ({ data: inventory }) }));

const summary = {
  enrollment_id: 'enrollment-1', name: 'My Edge', device_id: 'edge-1', runtime_id: 'openai-sdk',
  workspace_root: '/workspace/my-project', status: 'pending', expires_at: '2099-01-01T00:00:00Z',
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><EdgePairingPanel /></QueryClientProvider>);
  return invalidation;
}
function enterCode(code = 'abcde-fg234') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Review device' }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  inventory.items = [];
  session.generation = 0;
  api.previewEdgeEnrollment.mockResolvedValue(summary);
  api.confirmEdgeEnrollment.mockResolvedValue({ ...summary, status: 'confirmed' });
  api.revokeEdgeDevice.mockResolvedValue(undefined);
  getI18n().addResourceBundle('en', 'common', en);
  getI18n().addResourceBundle('zh', 'common', zh);
  await getI18n().changeLanguage('en');
});

afterEach(() => vi.useRealTimers());

describe('EdgePairingPanel', () => {
  it('supports keyboard review and explicit confirmation without pointer input', async () => {
    const user = userEvent.setup();
    mount();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Device pairing code' })).toHaveFocus();
    await user.keyboard('ABCDE-FG234{Enter}');
    const confirm = await screen.findByRole('button', { name: 'Confirm pairing' });
    expect(api.confirmEdgeEnrollment).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard(' ');
    expect(await screen.findByText(/Pairing confirmed/)).toBeVisible();
    expect(api.confirmEdgeEnrollment).toHaveBeenCalledOnce();
  });

  it('requires explicit review of device, runtime and workspace before confirmation', async () => {
    const invalidation = mount();
    expect(screen.getByRole('button', { name: 'Review device' })).toBeDisabled();
    enterCode();
    expect(await screen.findByText('My Edge')).toBeVisible();
    expect(screen.getByText('/workspace/my-project')).toBeVisible();
    expect(screen.getByText('openai-sdk')).toBeVisible();
    expect(screen.getByText(/no tool execution/)).toBeVisible();
    expect(api.previewEdgeEnrollment).toHaveBeenCalledWith('ABCDE-FG234');
    expect(api.confirmEdgeEnrollment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm pairing' }));
    expect(await screen.findByText(/Pairing confirmed/)).toBeVisible();
    expect(api.confirmEdgeEnrollment).toHaveBeenCalledWith('ABCDE-FG234');
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
    expect(invalidation).toHaveBeenCalled();
  });

  it('clears the reviewed device when the user edits the code', async () => {
    mount(); enterCode();
    await screen.findByRole('button', { name: 'Confirm pairing' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FGHIJ-KL234' } });
    expect(screen.queryByText('My Edge')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
    expect(api.confirmEdgeEnrollment).not.toHaveBeenCalled();
  });

  it('guards duplicate submit events and confirmation clicks until the request completes', async () => {
    let complete!: (value: typeof summary) => void;
    api.previewEdgeEnrollment.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    mount(); enterCode();
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(api.previewEdgeEnrollment).toHaveBeenCalledTimes(1);
    await act(async () => complete(summary));
    let confirm!: () => void;
    api.confirmEdgeEnrollment.mockReturnValueOnce(new Promise<void>((resolve) => { confirm = resolve; }));
    const button = screen.getByRole('button', { name: 'Confirm pairing' });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(api.confirmEdgeEnrollment).toHaveBeenCalledTimes(1);
    await act(async () => confirm());
    expect(screen.getByText(/Pairing confirmed/)).toBeVisible();
  });

  it('does not apply a late confirmation or invalidate the next user cache after a session change', async () => {
    const invalidation = mount(); enterCode();
    let confirm!: () => void;
    api.confirmEdgeEnrollment.mockReturnValueOnce(new Promise<void>((resolve) => { confirm = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm pairing' }));
    session.generation += 1;
    await act(async () => confirm());
    expect(screen.queryByText(/Pairing confirmed/)).toBeNull();
    expect(invalidation).not.toHaveBeenCalled();
  });

  it('expires an open preview without requiring another user interaction', async () => {
    vi.useFakeTimers();
    api.previewEdgeEnrollment.mockResolvedValueOnce({ ...summary, expires_at: new Date(Date.now() + 1_000).toISOString() });
    mount();
    await act(async () => enterCode());
    expect(screen.getByRole('button', { name: 'Confirm pairing' })).toBeEnabled();
    await act(async () => vi.advanceTimersByTimeAsync(1_001));
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/expired/);
  });

  it('disables editing during lookup and exposes recoverable invalid or expired code errors', async () => {
    let reject!: (error: Error) => void;
    api.previewEdgeEnrollment.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    mount(); enterCode();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await act(async () => reject(new Error('edge_enrollment_invalid')));
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid, expired or already used/);
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
  });

  it.each(['expired', 'confirmed'])('does not offer confirmation for %s requests', async (state) => {
    api.previewEdgeEnrollment.mockResolvedValue({ ...summary,
      status: state === 'confirmed' ? 'confirmed' : 'pending',
      expires_at: state === 'expired' ? '2000-01-01T00:00:00Z' : summary.expires_at,
    });
    mount(); enterCode();
    await screen.findByText('My Edge');
    expect(screen.getByRole('status')).toHaveTextContent(state === 'expired' ? /expired/ : /already been confirmed/);
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
  });

  it('requires a fresh review after a confirmation conflict', async () => {
    api.confirmEdgeEnrollment.mockRejectedValueOnce(new Error('edge_enrollment_conflict'));
    mount(); enterCode();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm pairing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Review the code again/);
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
  });

  it('revokes only an explicitly confirmed paired device and preserves the retry on failure', async () => {
    inventory.items = [
      { id: 'target-1', name: 'Paired Edge', target_type: 'cloud_edge', device_id: 'edge-1', capabilities: { pairedDevice: true, runtimeId: 'openai-sdk' } },
      { id: 'local-1', name: 'Desktop', target_type: 'local_edge', device_id: 'desktop-1' },
    ];
    api.revokeEdgeDevice.mockRejectedValueOnce(new Error('unavailable'));
    const invalidation = mount();
    expect(screen.getAllByRole('button', { name: 'Revoke pairing' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke pairing' }));
    expect(api.revokeEdgeDevice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke pairing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not revoke/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Device access revoked/);
    expect(api.revokeEdgeDevice).toHaveBeenLastCalledWith('edge-1');
    expect(invalidation).toHaveBeenCalled();
  });

  it('offers the same review and confirmation flow in Chinese', async () => {
    await getI18n().changeLanguage('zh');
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: '设备配对码' }), { target: { value: 'ABCDE-FG234' } });
    fireEvent.click(screen.getByRole('button', { name: '查看设备' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认配对' }));
    await waitFor(() => expect(screen.getByText(/已确认配对/)).toBeVisible());
    expect(screen.getByText(/不执行工具/)).toBeVisible();
  });
});
