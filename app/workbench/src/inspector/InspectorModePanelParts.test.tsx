import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import type { EvidenceRef } from '@shared/transcript';
import {
  BrowserPanelFallback,
  DeployStatusBar,
  FilesPanel,
} from './InspectorModePanelParts';

/* ═══════════════════════════════════════════════════════════════════════
   InspectorModePanelParts i18n wiring tests (#2032).

   Panels render through the project's real test i18next instance: the zh
   block keeps historical visible copy, the en block proves the same
   sharedWorkbench keys converge to natural English.
   ═══════════════════════════════════════════════════════════════════════ */

function artifact(label: string, id = `id-${label}`): EvidenceRef {
  return { id, kind: 'artifact', label, uri: `https://example.test/${label}` };
}

function fileRef(label: string, id = `id-${label}`): EvidenceRef {
  return { id, kind: 'file', label };
}

async function noopPreview(): Promise<void> {}

describe('InspectorModePanelParts zh visible copy (#2032)', () => {
  beforeAll(async () => {
    await useTestI18nLanguage('zh');
  });

  it('renders browser fallback copy through sharedWorkbench keys', () => {
    render(
      <BrowserPanelFallback
        artifacts={[artifact('report.md'), artifact('chart.png')]}
        onOpenPreview={noopPreview}
        onOpenUrl={() => {}}
      />,
    );
    expect(screen.getByText('浏览器预览已启用')).toBeTruthy();
    expect(screen.getByText('检测到 2 个可预览产物。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开产物 report.md' })).toBeTruthy();
    expect(screen.getAllByText('打开').length).toBeGreaterThan(0);
  });

  it('marks unopenable artifacts as pending integration', () => {
    render(
      <BrowserPanelFallback
        artifacts={[artifact('locked.bin')]}
        canOpenPreview={() => false}
        onOpenPreview={noopPreview}
        onOpenUrl={() => {}}
      />,
    );
    expect(screen.getByText('待接入')).toBeTruthy();
  });

  it('renders the empty browser fallback waiting copy', () => {
    render(<BrowserPanelFallback artifacts={[]} onOpenUrl={() => {}} />);
    expect(screen.getByText('浏览器预览已启用')).toBeTruthy();
    expect(screen.getByText('等待 run 产出可预览地址或 artifact。')).toBeTruthy();
  });

  it('renders files panel empty and fallback copy', () => {
    const { unmount } = render(<FilesPanel files={[]} />);
    expect(screen.getByText('暂无变更文件')).toBeTruthy();
    expect(screen.getByText('等待 run 产出文件、diff 或 artifact evidence。')).toBeTruthy();
    unmount();

    render(
      <FilesPanel
        files={[]}
        fallbackFiles={[{ name: 'src/a.ts', type: 'ts' }]}
        onFallbackFileClick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '打开文件 src/a.ts' })).toBeTruthy();
    expect(screen.getByText('预览')).toBeTruthy();
  });

  it('renders openable evidence files through sharedWorkbench keys', () => {
    render(<FilesPanel files={[fileRef('notes.md')]} onOpenPreview={noopPreview} />);
    expect(screen.getByRole('button', { name: '打开文件 notes.md' })).toBeTruthy();
    expect(screen.getByText('打开')).toBeTruthy();
  });

  it('renders deploy status bar aria with the translated label', () => {
    render(<DeployStatusBar status="deployed" />);
    expect(screen.getByRole('status', { name: '部署状态: 已就绪' })).toBeTruthy();
    expect(screen.getByText('已就绪')).toBeTruthy();
  });
});

describe('InspectorModePanelParts en convergence (#2032)', () => {
  beforeAll(async () => {
    await useTestI18nLanguage('en');
  });

  it('renders natural English browser fallback copy', () => {
    render(
      <BrowserPanelFallback
        artifacts={[artifact('report.md'), artifact('chart.png')]}
        onOpenPreview={noopPreview}
        onOpenUrl={() => {}}
      />,
    );
    expect(screen.getByText('Browser preview is enabled')).toBeTruthy();
    expect(screen.getByText('2 previewable artifacts detected.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open artifact report.md' })).toBeTruthy();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
  });

  it('marks unopenable artifacts as pending in English', () => {
    render(
      <BrowserPanelFallback
        artifacts={[artifact('locked.bin')]}
        canOpenPreview={() => false}
        onOpenPreview={noopPreview}
        onOpenUrl={() => {}}
      />,
    );
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('renders the empty browser fallback waiting copy in English', () => {
    render(<BrowserPanelFallback artifacts={[]} onOpenUrl={() => {}} />);
    expect(screen.getByText('Browser preview is enabled')).toBeTruthy();
    expect(screen.getByText('Waiting for a run preview URL or artifact.')).toBeTruthy();
  });

  it('renders files panel empty and fallback copy in English', () => {
    const { unmount } = render(<FilesPanel files={[]} />);
    expect(screen.getByText('No changed files')).toBeTruthy();
    expect(screen.getByText('Waiting for run file, diff or artifact evidence.')).toBeTruthy();
    unmount();

    render(
      <FilesPanel
        files={[]}
        fallbackFiles={[{ name: 'src/a.ts', type: 'ts' }]}
        onFallbackFileClick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open file src/a.ts' })).toBeTruthy();
    expect(screen.getByText('Preview')).toBeTruthy();
  });

  it('renders openable evidence files in English', () => {
    render(<FilesPanel files={[fileRef('notes.md')]} onOpenPreview={noopPreview} />);
    expect(screen.getByRole('button', { name: 'Open file notes.md' })).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('renders deploy status bar aria in English', () => {
    render(<DeployStatusBar status="deployed" />);
    expect(screen.getByRole('status', { name: 'Deploy status: Ready' })).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
