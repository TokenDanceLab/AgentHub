import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';

// Key-echo default of the shared test i18next instance keeps the original
// identity-mock visible copy for this a11y suite (Issue #1717).

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
