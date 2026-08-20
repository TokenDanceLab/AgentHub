// AgentHubWorkbench shell: v4 shell regions, skip link and the
// keyboard-shortcuts overlay (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks } from './helpers';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockPlatform } from '../../platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
} from '../designIcons';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('renders the v4 shell regions from one shared workbench', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '消息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '云文档' })).toBeInTheDocument();
    /* P76: default primary card is overview only. */
    const inspectorTablist = screen.getByRole('tablist', { name: '右侧工作区' });
    expect(within(inspectorTablist).getByRole('tab', { name: /概览/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(inspectorTablist).queryByRole('tab', { name: /浏览器/ })).not.toBeInTheDocument();
    expect(within(inspectorTablist).queryByRole('tab', { name: /文件/ })).not.toBeInTheDocument();
    const overviewTabIcon = screen.getByRole('tab', { name: /概览/ }).querySelector('svg');
    expect(overviewTabIcon).toHaveAttribute('width', String(DESIGN_NAV_GLYPH_SIZE));
    expect(overviewTabIcon).toHaveAttribute('height', String(DESIGN_NAV_GLYPH_SIZE));
    expect(overviewTabIcon).toHaveAttribute('stroke-width', String(DESIGN_NAV_GLYPH_STROKE_WIDTH));
    expect(screen.getByRole('separator', { name: '调整右侧栏宽度' })).toHaveAttribute('aria-valuenow', '400');
    expect(screen.getByRole('button', { name: '收起右侧概览' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('发消息给 Builder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('composer-attachment-input')).not.toBeInTheDocument();
    const transcriptRegion = screen.getByRole('region', { name: 'Transcript' });
    expect(within(transcriptRegion).getByText('全面参考 tokendance-design/desktop')).toBeInTheDocument();
    expect(within(transcriptRegion).getAllByText('Read desktop/index.html').length).toBeGreaterThan(0);
    expect(within(transcriptRegion).queryByText('Hub replay for desktop run')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Source: Hub replay')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Mode: Replay')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Target: Edge run evidence')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Hub task: task-v4')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Edge run: edge-run-v4')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Adapter: codex')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('Device: desktop-device-1')).not.toBeInTheDocument();
  });

  it('exposes a skip-to-content link that targets the workspace main region', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const skipLink = screen.getByRole('link', { name: '跳到主要内容' });
    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('id', 'main-content');
  });

  it('opens and toggles the keyboard-shortcuts help overlay with the global ? key', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // '?' outside editable targets opens the help overlay.
    fireEvent.keyDown(document, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: '键盘快捷键' });
    expect(within(dialog).getByText('会话')).toBeInTheDocument();
    expect(within(dialog).getByText('导航')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl/⌘ + N')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter')).toBeInTheDocument();

    // A second '?' toggles it closed.
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // '?' inside an editable element must not open the overlay.
    const composer = screen.getByPlaceholderText('发消息给 Builder');
    composer.focus();
    fireEvent.keyDown(composer, { key: '?' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Esc closes the open overlay via the Modal.
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
