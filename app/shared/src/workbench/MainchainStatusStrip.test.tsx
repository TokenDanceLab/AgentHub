import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const summary: MainchainSummary = {
  nodes: [{ id: 'n1', label: 'Agent A', detail: 'done', state: 'done' }],
  exportEnabled: false,
  exportLabel: '导出',
  exportDetail: '',
};

describe('MainchainStatusStrip a11y', () => {
  it('renders a polite live region with the status label', () => {
    const { getByRole } = render(
      <MainchainStatusStrip summary={summary} onExportEvidence={() => {}} />
    );
    const strip = getByRole('region');
    expect(strip).toHaveAttribute('aria-live', 'polite');
    expect(strip).toHaveAttribute('aria-label', 'aria.mainChainStatus');
  });
});
