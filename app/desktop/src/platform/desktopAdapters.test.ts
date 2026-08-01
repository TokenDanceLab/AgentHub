import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { open as openShell } from '@tauri-apps/plugin-shell';
import { fetchSettings, patchSettings } from '@/api/edgeClient';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { pickDesktopComposerAttachments } from './desktopAttachments';
import { canOpenDesktopEvidencePreview, openDesktopEvidencePreview } from './desktopPreview';
import { createDesktopSettingsAdapter } from './desktopSettingsAdapter';
import type { EvidenceRef } from '@shared/transcript';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@/api/edgeClient', () => ({ fetchSettings: vi.fn(), patchSettings: vi.fn() }));
vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn() }));

const mockOpenDialog = vi.mocked(openDialog);
const mockInvoke = vi.mocked(invoke);
const mockOpenShell = vi.mocked(openShell);
const mockFetchSettings = vi.mocked(fetchSettings);
const mockPatchSettings = vi.mocked(patchSettings);
const mockCreateHubClient = vi.mocked(createHubClient);
const mockGetAccessToken = vi.mocked(getAccessToken);

describe('desktop platform adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAccessToken.mockReturnValue(null);
  });

  it('maps selected desktop files and previews only supported text files', async () => {
    mockOpenDialog.mockResolvedValue(['C:\\repo\\README.md', 'C:\\repo\\image.png']);
    mockInvoke.mockImplementation(async (_command, args) => {
      const path = (args as { path: string }).path;
      return path.endsWith('README.md') ? '# hello' : '';
    });

    const attachments = await pickDesktopComposerAttachments();

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      name: 'README.md',
      source: 'desktop',
      path: 'C:\\repo\\README.md',
      contentPreview: '# hello',
    });
    expect(attachments[1]).toMatchObject({ name: 'image.png', source: 'desktop' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('returns an empty selection without invoking the Rust reader', async () => {
    mockOpenDialog.mockResolvedValue(null);
    await expect(pickDesktopComposerAttachments()).resolves.toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('keeps the selected path when the desktop reader cannot preview its contents', async () => {
    mockOpenDialog.mockResolvedValue('C:\\repo\\NOTES.txt');
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));

    await expect(pickDesktopComposerAttachments()).resolves.toMatchObject([
      { name: 'NOTES.txt', source: 'desktop', path: 'C:\\repo\\NOTES.txt' },
    ]);
    expect(mockInvoke).toHaveBeenCalledOnce();
  });

  it('resolves and opens evidence targets, rejecting unsupported labels', async () => {
    const uriEvidence: EvidenceRef = { id: '1', kind: 'file', label: 'readme', uri: 'file:///tmp/readme.md' };
    const pathEvidence: EvidenceRef = { id: '2', kind: 'file', label: 'readme', path: './README.md' };
    const labelEvidence: EvidenceRef = { id: '3', kind: 'file', label: 'https://example.test/a' };
    const invalidEvidence: EvidenceRef = { id: '4', kind: 'file', label: 'not a target' };

    expect(canOpenDesktopEvidencePreview(uriEvidence)).toBe(true);
    expect(canOpenDesktopEvidencePreview(pathEvidence)).toBe(true);
    expect(canOpenDesktopEvidencePreview(labelEvidence)).toBe(true);
    expect(canOpenDesktopEvidencePreview(invalidEvidence)).toBe(false);

    await openDesktopEvidencePreview(uriEvidence);
    await openDesktopEvidencePreview(pathEvidence);
    await openDesktopEvidencePreview(labelEvidence);
    expect(mockOpenShell).toHaveBeenNthCalledWith(1, 'file:///tmp/readme.md');
    expect(mockOpenShell).toHaveBeenNthCalledWith(2, './README.md');
    expect(mockOpenShell).toHaveBeenNthCalledWith(3, 'https://example.test/a');
    await expect(openDesktopEvidencePreview(invalidEvidence)).rejects.toThrow('No preview target');
  });

  it('uses Edge first, Hub second, then localStorage for settings reads', async () => {
    const adapter = createDesktopSettingsAdapter();
    mockFetchSettings.mockResolvedValueOnce({ theme: 'dark' });
    await expect(adapter.readSettings()).resolves.toEqual({ theme: 'dark' });
    expect(localStorage.getItem('agenthub.settings.theme')).toBe('dark');

    mockFetchSettings.mockRejectedValueOnce(new Error('edge unavailable'));
    mockGetAccessToken.mockReturnValue('token-1');
    const hub = { fetchSettings: vi.fn().mockResolvedValue({ density: 'compact' }) };
    mockCreateHubClient.mockReturnValue(hub as unknown as ReturnType<typeof createHubClient>);
    await expect(adapter.readSettings()).resolves.toEqual({ density: 'compact' });
    expect(hub.fetchSettings).toHaveBeenCalledOnce();

    mockFetchSettings.mockRejectedValueOnce(new Error('edge unavailable'));
    mockGetAccessToken.mockReturnValue(null);
    await expect(adapter.readSettings()).resolves.toEqual({ theme: 'dark', density: 'compact' });

    mockFetchSettings.mockRejectedValueOnce(new Error('edge unavailable'));
    mockGetAccessToken.mockReturnValue('token-1');
    hub.fetchSettings.mockRejectedValueOnce(new Error('hub unavailable'));
    await expect(adapter.readSettings()).resolves.toEqual({ theme: 'dark', density: 'compact' });
  });

  it('writes locally immediately and attempts Edge plus authenticated Hub sync', async () => {
    const adapter = createDesktopSettingsAdapter();
    mockPatchSettings.mockResolvedValueOnce({ theme: 'light' });
    mockGetAccessToken.mockReturnValue('token-2');
    const hub = { patchSettings: vi.fn().mockResolvedValue(undefined) };
    mockCreateHubClient.mockReturnValue(hub as unknown as ReturnType<typeof createHubClient>);

    await adapter.writeSettings({ theme: 'light' });

    expect(localStorage.getItem('agenthub.settings.theme')).toBe('light');
    expect(mockPatchSettings).toHaveBeenCalledWith({ theme: 'light' });
    expect(hub.patchSettings).toHaveBeenCalledWith({ theme: 'light' });

    mockPatchSettings.mockRejectedValueOnce(new Error('edge write unavailable'));
    hub.patchSettings.mockRejectedValueOnce(new Error('hub write unavailable'));
    await adapter.writeSettings({ theme: 'dark' });
    await Promise.resolve();
    expect(localStorage.getItem('agenthub.settings.theme')).toBe('dark');
  });
});
