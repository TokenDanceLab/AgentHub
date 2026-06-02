import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtifactVersionTimeline from './ArtifactVersionTimeline';
import type { ArtifactVersion } from './ArtifactVersionTimeline';

const versions: ArtifactVersion[] = [
  { version: 3, artifactId: 'art-1', runId: 'run-3', createdAt: '2026-06-02T10:00:00Z', summary: 'Added dark mode support' },
  { version: 2, artifactId: 'art-1', runId: 'run-2', createdAt: '2026-06-01T09:00:00Z', summary: 'Fixed layout bug' },
  { version: 1, artifactId: 'art-1', runId: 'run-1', createdAt: '2026-05-31T08:00:00Z' },
];

describe('ArtifactVersionTimeline', () => {
  it('renders header with count', () => {
    render(<ArtifactVersionTimeline artifactId="art-1" artifactTitle="Dashboard" versions={versions} />);
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('3 versions')).toBeDefined();
  });

  it('renders all versions with latest badge', () => {
    render(<ArtifactVersionTimeline artifactId="art-1" artifactTitle="Dash" versions={versions} />);
    expect(screen.getByText('v3')).toBeDefined();
    expect(screen.getByText('v2')).toBeDefined();
    expect(screen.getByText('v1')).toBeDefined();
    expect(screen.getByText('current')).toBeDefined();
  });

  it('expands version details on click', () => {
    render(<ArtifactVersionTimeline artifactId="art-1" artifactTitle="Dash" versions={versions} />);
    const v2Header = screen.getByText('v2');
    fireEvent.click(v2Header);
    expect(screen.getByText('Fixed layout bug')).toBeDefined();
  });

  it('shows compare button only for non-latest versions', () => {
    render(
      <ArtifactVersionTimeline
        artifactId="art-1"
        artifactTitle="Dash"
        versions={versions}
        onCompare={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('v2'));
    expect(screen.getByText('Compare with current')).toBeDefined();

    fireEvent.click(screen.getByText('v3'));
    expect(screen.queryByText('Compare with current')).toBeNull();
  });

  it('calls onRevert when revert button is clicked', () => {
    const onRevert = vi.fn();
    render(
      <ArtifactVersionTimeline
        artifactId="art-1"
        artifactTitle="Dash"
        versions={versions}
        onRevert={onRevert}
      />,
    );
    fireEvent.click(screen.getByText('v2'));
    fireEvent.click(screen.getByText('Revert to v2'));
    expect(onRevert).toHaveBeenCalledWith(2);
  });

  it('returns null for empty versions', () => {
    const { container } = render(<ArtifactVersionTimeline artifactId="art-1" artifactTitle="Empty" versions={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('sorts versions descending', () => {
    const unsorted = [versions[2], versions[0], versions[1]];
    render(<ArtifactVersionTimeline artifactId="art-1" artifactTitle="Dash" versions={unsorted} />);
    const labels = screen.getAllByText(/v[1-3]/);
    expect(labels[0].textContent).toBe('v3');
    expect(labels[1].textContent).toBe('v2');
    expect(labels[2].textContent).toBe('v1');
  });
});
