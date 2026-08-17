import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import { SettingsPage, type SettingsPageProps } from './SettingsPage';

const BASE_PROPS: SettingsPageProps = {
  activePane: 'appearance',
  spaceTitle: 'AgentHub Desktop',
  spaceMeta: '桌面设计 demo',
  theme: '浅色',
  density: '标准',
  runStepDefault: '折叠',
  animationIntensity: '标准',
  inspectorVisible: true,
  stackedAvatars: true,
  taskCompleteNotify: true,
  approvalNotifyLevel: '横幅',
  failureNotify: true,
  projectGroupNotifyLevel: '全部',
  docUpdateNotifyLevel: '重要',
  dndWindow: '22:00-08:00',
  defaultModel: 'claude / sonnet',
  defaultExecutor: 'Claude Code',
  toolCallDisplay: '摘要',
  deepThinkingDisplay: '摘要',
  permissions: {
    Read: '允许',
    Write: '需确认',
    Shell: '需确认',
    Browser: '允许',
  },
  vitePreviewUrl: 'http://127.0.0.1:5173',
  dataMode: 'Mock',
  composerSubmitBehavior: 'Enter 发送',
  workspacePath: '/workspace/AgentHub',
  targetProjectPath: '/workspace/AgentHub',
  hrmOverlayEnabled: true,
  visualQaMode: '按需',
  logLevel: '标准',
  designSystemValidation: '轻量',
  stateStrategies: {
    empty: true,
    invalid: true,
    missing: true,
  },
  onSelectPane: () => undefined,
  onChangeSetting: () => undefined,
};

describe('SettingsPage load/error UX', () => {
  it('shows StatusNotice while settings are loading', () => {
    render(<SettingsPage {...BASE_PROPS} settingsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载设置');
  });

  it('shows RecoveryPanel for init failures with retry', () => {
    const onRetrySettingsLoad = vi.fn();
    render(
      <SettingsPage
        {...BASE_PROPS}
        settingsError="backend down"
        settingsErrorKind="init"
        onRetrySettingsLoad={onRetrySettingsLoad}
      />,
    );

    expect(screen.getByRole('alert', { name: 'settings.loadFailed' })).toBeInTheDocument();
    expect(screen.getByText('backend down')).toBeInTheDocument();

    screen.getByRole('button', { name: '重试加载' }).click();
    expect(onRetrySettingsLoad).toHaveBeenCalledTimes(1);
  });

  it('shows StatusNotice for write failures with dismiss', () => {
    const onDismissSettingsError = vi.fn();
    render(
      <SettingsPage
        {...BASE_PROPS}
        settingsError="persist failed"
        settingsErrorKind="write"
        onDismissSettingsError={onDismissSettingsError}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('设置未能保存：persist failed');
    screen.getByRole('button', { name: '关闭' }).click();
    expect(onDismissSettingsError).toHaveBeenCalledTimes(1);
  });
});
