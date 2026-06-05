import { fireEvent, render, screen } from '@testing-library/react';
import SummaryCard from './SummaryCard';

describe('SummaryCard', () => {
  it('reveals expandable detail on demand', () => {
    const fullDeviceId = '4f58beb8-44f3-41c8-90b7-0a81af13dbb3';

    render(
      <SummaryCard
        icon={<span aria-hidden="true">icon</span>}
        label="Desktop device"
        value="4f58beb8...dbb3"
        detail="4f58beb8...dbb3"
        expandedDetail={<code>{fullDeviceId}</code>}
        expandLabel="Show full device ID"
        collapseLabel="Hide full device ID"
      />,
    );

    expect(screen.queryByText(fullDeviceId)).not.toBeInTheDocument();

    const expandButton = screen.getByRole('button', { name: 'Show full device ID' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expandButton);

    expect(screen.getByText(fullDeviceId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide full device ID' })).toHaveAttribute('aria-expanded', 'true');
  });
});
