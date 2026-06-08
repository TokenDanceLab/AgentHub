import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorktreeSection from './WorktreeSection';
import {
  chooseWorkspaceRootFromBackend,
  getSelectedWorkspace,
  readWorkspaceSettings,
} from '@/utils/workspaceStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../primitives/SelectControl', () => ({
  default: ({ value, options, onChange }: {
    value: string;
    options: Array<[string, string]>;
    onChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>{label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@/utils/workspaceStore', () => ({
  chooseWorkspaceRootFromBackend: vi.fn(),
  getSelectedWorkspace: vi.fn(),
  readWorkspaceSettings: vi.fn(() => ({})),
  writeWorkspaceSettings: vi.fn(),
}));

const mockedChooseWorkspaceRootFromBackend = vi.mocked(chooseWorkspaceRootFromBackend);
const mockedGetSelectedWorkspace = vi.mocked(getSelectedWorkspace);
const mockedReadWorkspaceSettings = vi.mocked(readWorkspaceSettings);

describe('WorktreeSection workspace picker', () => {
  beforeEach(() => {
    mockedChooseWorkspaceRootFromBackend.mockReset();
    mockedGetSelectedWorkspace.mockReset();
    mockedReadWorkspaceSettings.mockReset();
    mockedReadWorkspaceSettings.mockReturnValue({});
    mockedGetSelectedWorkspace.mockReturnValue(null);
  });

  it('opens the trusted backend picker from the visible default workspace row', async () => {
    const selectedWorkspace = {
      name: 'AgentHub',
      path: 'D:/Code/TokenDance/AgentHub',
      lastOpenedAt: 1_771_000_000_000,
    };
    mockedChooseWorkspaceRootFromBackend.mockImplementationOnce(async () => {
      mockedGetSelectedWorkspace.mockReturnValue(selectedWorkspace);
      return selectedWorkspace;
    });

    render(<WorktreeSection worktreeIsolation={true} setWorktreeIsolation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.chooseWorkspace' }));

    await waitFor(() => {
      expect(mockedChooseWorkspaceRootFromBackend).toHaveBeenCalledTimes(1);
      expect(screen.getByText('AgentHub (D:/Code/TokenDance/AgentHub)')).toBeInTheDocument();
    });
    expect(mockedReadWorkspaceSettings).toHaveBeenCalledWith('D:/Code/TokenDance/AgentHub');
  });
});
