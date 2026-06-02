import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArtifactCard from './ArtifactCard';

describe('ArtifactCard', () => {
  const baseProps = {
    artifactId: 'art-1',
    artifactType: 'iframe',
    title: 'Dashboard Preview',
    artifactUrl: 'https://example.com/artifact',
    previewUrl: 'https://example.com/preview',
    size: 2048,
  };

  it('renders artifact title and type label', () => {
    render(<ArtifactCard {...baseProps} />);
    expect(screen.getByText('Dashboard Preview')).toBeDefined();
    expect(screen.getByText('iframe')).toBeDefined();
  });

  it('renders size in KB', () => {
    render(<ArtifactCard {...baseProps} />);
    expect(screen.getByText('2.0 KB')).toBeDefined();
  });

  it('does not render size when undefined', () => {
    render(<ArtifactCard {...baseProps} size={undefined} />);
    expect(screen.queryByText('2.0 KB')).toBeNull();
  });

  it('renders apply button when canApplyDiff and not diffApplied', () => {
    render(<ArtifactCard {...baseProps} canApplyDiff diffApplied={false} />);
    expect(screen.getByLabelText('Apply diff')).toBeDefined();
  });

  it('renders applied badge when diffApplied is true', () => {
    render(<ArtifactCard {...baseProps} diffApplied />);
    expect(screen.getByText('Applied')).toBeDefined();
  });

  it('renders iframe preview when previewUrl is provided', () => {
    render(<ArtifactCard {...baseProps} />);
    const iframe = screen.getByTitle('Preview: Dashboard Preview');
    expect(iframe.tagName).toBe('IFRAME');
  });

  it('renders image preview for image type', () => {
    render(<ArtifactCard {...baseProps} artifactType="image" />);
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
  });

  it('renders open and download links', () => {
    render(<ArtifactCard {...baseProps} />);
    expect(screen.getByLabelText('Open artifact')).toBeDefined();
    expect(screen.getByLabelText('Download artifact')).toBeDefined();
  });
});
