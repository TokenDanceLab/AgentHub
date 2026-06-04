import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SelectControl from '../primitives/SelectControl';
import Switch from '../primitives/Switch';
import { writeStoredValue } from '../utils';
import {
  getSelectedWorkspace,
  readWorkspaceSettings,
  writeWorkspaceSettings,
  type WorkspaceEntry,
} from '@/utils/workspaceStore';
import styles from '../primitives/primitives.module.css';

const PERMISSION_MODE_OPTIONS: Array<[string, string]> = [
  ['', 'Default'],
  ['default', 'Default'],
  ['plan', 'Plan'],
  ['acceptEdits', 'Accept Edits'],
  ['bypassPermissions', 'Bypass Permissions'],
  ['dontAsk', "Don't Ask"],
];

interface WorktreeSectionProps {
  worktreeIsolation: boolean;
  setWorktreeIsolation: (value: boolean) => void;
}

export default function WorktreeSection({ worktreeIsolation, setWorktreeIsolation }: WorktreeSectionProps) {
  const { t } = useTranslation();
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceEntry | null>(() => getSelectedWorkspace());
  const [workspaceDefaultModel, setWorkspaceDefaultModel] = useState('');
  const [workspacePermissionMode, setWorkspacePermissionMode] = useState('');
  const [workspaceCustomInstructions, setWorkspaceCustomInstructions] = useState('');

  const loadWorkspaceSettings = useCallback((ws: WorkspaceEntry | null) => {
    setCurrentWorkspace(ws);
    if (ws) {
      const settings = readWorkspaceSettings(ws.path);
      setWorkspaceDefaultModel(settings.defaultModel ?? '');
      setWorkspacePermissionMode(settings.permissionMode ?? '');
      setWorkspaceCustomInstructions(settings.customInstructions ?? '');
    } else {
      setWorkspaceDefaultModel('');
      setWorkspacePermissionMode('');
      setWorkspaceCustomInstructions('');
    }
  }, []);

  useEffect(() => {
    loadWorkspaceSettings(getSelectedWorkspace());
  }, [loadWorkspaceSettings]);

  useEffect(() => {
    const handleWorkDirSelected = () => {
      loadWorkspaceSettings(getSelectedWorkspace());
    };
    window.addEventListener('agenthub:workdir-selected', handleWorkDirSelected);
    return () => window.removeEventListener('agenthub:workdir-selected', handleWorkDirSelected);
  }, [loadWorkspaceSettings]);

  const handleDefaultModelChange = (value: string) => {
    setWorkspaceDefaultModel(value);
    if (currentWorkspace) {
      writeWorkspaceSettings(currentWorkspace.path, {
        defaultModel: value || undefined,
        permissionMode: workspacePermissionMode || undefined,
        customInstructions: workspaceCustomInstructions || undefined,
      });
    }
  };

  const handlePermissionModeChange = (value: string) => {
    setWorkspacePermissionMode(value);
    if (currentWorkspace) {
      writeWorkspaceSettings(currentWorkspace.path, {
        defaultModel: workspaceDefaultModel || undefined,
        permissionMode: value || undefined,
        customInstructions: workspaceCustomInstructions || undefined,
      });
    }
  };

  const handleCustomInstructionsChange = (value: string) => {
    setWorkspaceCustomInstructions(value);
    if (currentWorkspace) {
      writeWorkspaceSettings(currentWorkspace.path, {
        defaultModel: workspaceDefaultModel || undefined,
        permissionMode: workspacePermissionMode || undefined,
        customInstructions: value || undefined,
      });
    }
  };

  const workspaceDisplay = currentWorkspace
    ? `${currentWorkspace.name} (${currentWorkspace.path})`
    : t('settings.noWorkspaceSelected');

  if (!currentWorkspace) {
    return (
      <Panel title={t('settings.worktree')} description={t('settings.worktreeDesc')}>
        <SettingRow title={t('settings.defaultWorkspace')} description={t('settings.noWorkspaceSelected')} />
        <SettingRow
          title={t('settings.worktreeIsolation')}
          description={t('settings.worktreeIsolationDesc')}
          control={<Switch checked={worktreeIsolation} onChange={(v) => { setWorktreeIsolation(v); writeStoredValue('worktreeIsolation', v); }} />}
        />
        <SettingRow title={t('settings.worktreePolicy')} description=".worktrees/<feature>" />
      </Panel>
    );
  }

  return (
    <>
      <Panel title={t('settings.worktree')} description={t('settings.worktreeDesc')}>
        <SettingRow title={t('settings.defaultWorkspace')} description={workspaceDisplay} />
        <SettingRow
          title={t('settings.worktreeIsolation')}
          description={t('settings.worktreeIsolationDesc')}
          control={<Switch checked={worktreeIsolation} onChange={(v) => { setWorktreeIsolation(v); writeStoredValue('worktreeIsolation', v); }} />}
        />
        <SettingRow title={t('settings.worktreePolicy')} description=".worktrees/<feature>" />
      </Panel>

      <Panel title={t('workspace.settings.title')} description={currentWorkspace.path}>
        <SettingRow
          title={t('workspace.settings.defaultModel')}
          description={t('workspace.settings.defaultModelDesc')}
          control={
            <input
              className={styles.textInput}
              type="text"
              value={workspaceDefaultModel}
              placeholder="e.g. claude-sonnet-4-6"
              onChange={(event) => handleDefaultModelChange(event.target.value)}
            />
          }
        />
        <SettingRow
          title={t('workspace.settings.permissionMode')}
          description={t('workspace.settings.permissionModeDesc')}
          control={
            <SelectControl
              value={workspacePermissionMode || ''}
              options={PERMISSION_MODE_OPTIONS}
              onChange={handlePermissionModeChange}
            />
          }
        />
        <SettingRow
          title={t('workspace.settings.customInstructions')}
          description={t('workspace.settings.customInstructionsDesc')}
          control={
            <textarea
              className={styles.textInput}
              rows={3}
              value={workspaceCustomInstructions}
              placeholder={t('workspace.settings.customInstructionsDesc')}
              onChange={(event) => handleCustomInstructionsChange(event.target.value)}
            />
          }
        />
      </Panel>
    </>
  );
}
