/* ═══════════════════════════════════════════════════════════════════════
   Unit tests for ProjectPanelHelpers (ProjectSectionHead, ProjectMemberChip).

   Extracted alongside #696 residual thin from ProjectPanelParts.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../__tests__/setup';
import {
  ProjectMemberChip,
  ProjectSectionHead,
} from './ProjectPanelHelpers';

// Mock resolveWorkbenchProfile to return stable test data
vi.mock('../../../profileRegistry', () => ({
  resolveWorkbenchProfile: vi.fn((name: string) => ({
    name,
    initials: name.slice(0, 2).toUpperCase(),
    color: '#888',
    kind: 'agent' as const,
    label: 'Agent',
  })),
}));

describe('ProjectSectionHead', () => {
  it('renders icon name, title, and meta text', () => {
    render(<ProjectSectionHead icon="users" title="成员" meta="3 people" />);
    expect(screen.getByText('成员')).toBeInTheDocument();
    expect(screen.getByText('3 people')).toBeInTheDocument();
  });

  it('renders as a div with sectionHead class', () => {
    const { container } = render(<ProjectSectionHead icon="running" title="运行" meta="2 runs" />);
    const head = container.firstElementChild;
    expect(head?.tagName).toBe('DIV');
  });

  it('renders an h2 heading containing the title', () => {
    render(<ProjectSectionHead icon="archive" title="归档" meta="1 check" />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('归档');
  });

  it('accepts different icon names without error', () => {
    const icons = ['grid', 'package', 'notes', 'tools', 'users', 'running', 'archive'] as const;
    for (const icon of icons) {
      const { unmount } = render(<ProjectSectionHead icon={icon} title="T" meta="M" />);
      expect(screen.getByText('T')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('ProjectMemberChip', () => {
  it('renders member name and kind label', () => {
    render(<ProjectMemberChip name="Alice" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('renders member initials in the avatar', () => {
    render(<ProjectMemberChip name="Bob" />);
    expect(screen.getByText('BO')).toBeInTheDocument();
  });

  it('sets data-profile-kind attribute from resolved profile', () => {
    const { container } = render(<ProjectMemberChip name="Charlie" />);
    const chip = container.firstElementChild;
    expect(chip?.getAttribute('data-profile-kind')).toBe('agent');
  });

  it('sets title attribute from profile name and label', () => {
    const { container } = render(<ProjectMemberChip name="Diana" />);
    const chip = container.firstElementChild;
    expect(chip?.getAttribute('title')).toBe('Diana · Agent');
  });

  it('passes profiles array to resolveWorkbenchProfile', () => {
    const { resolveWorkbenchProfile } = vi.mocked(require('../../../profileRegistry'));
    resolveWorkbenchProfile.mockClear();

    const profiles = [{ name: 'Eve', color: '#000', kind: 'user' as const, label: 'User', initials: 'EV' }];
    render(<ProjectMemberChip name="Eve" profiles={profiles} />);
    expect(resolveWorkbenchProfile).toHaveBeenCalledWith('Eve', profiles);
  });
});
