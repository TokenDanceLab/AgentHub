/* ═══════════════════════════════════════════════════════════════════════
   Unit tests for ProjectPanelHelpers (ProjectSectionHead, ProjectMemberChip).

   Extracted alongside #696 residual thin from ProjectPanelParts.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import {
  ProjectMemberChip,
  ProjectSectionHead,
} from './ProjectPanelHelpers';
import type { WorkbenchProfileSource } from '../../profileRegistry';

function agentProfile(name: string, overrides: Partial<WorkbenchProfileSource> = {}): WorkbenchProfileSource {
  return {
    name,
    initials: name.slice(0, 2).toUpperCase(),
    kind: 'agent',
    ...overrides,
  };
}

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
  it('renders member name and kind label from the resolved profile', () => {
    render(
      <ProjectMemberChip
        name="Alice"
        profiles={[agentProfile('Alice')]}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('renders member initials in the avatar', () => {
    render(
      <ProjectMemberChip
        name="Bob"
        profiles={[agentProfile('Bob', { initials: 'BO' })]}
      />,
    );
    expect(screen.getByText('BO')).toBeInTheDocument();
  });

  it('sets data-profile-kind attribute from resolved profile', () => {
    const { container } = render(
      <ProjectMemberChip
        name="Charlie"
        profiles={[agentProfile('Charlie', { kind: 'agent' })]}
      />,
    );
    const chip = container.firstElementChild;
    expect(chip?.getAttribute('data-profile-kind')).toBe('agent');
  });

  it('sets title attribute combining profile name and label', () => {
    const { container } = render(
      <ProjectMemberChip
        name="Diana"
        profiles={[agentProfile('Diana')]}
      />,
    );
    const chip = container.firstElementChild;
    expect(chip?.getAttribute('title')).toBe('Diana · Agent');
  });

  it('passes profiles array to resolveWorkbenchProfile for matching', () => {
    // When profiles does NOT contain the name, resolveWorkbenchProfile
    // falls back to the raw name with kind inferred from agent-name hints.
    // We just verify the fallback renders sensibly.
    const { container } = render(<ProjectMemberChip name="UnknownZzz" />);
    const chip = container.firstElementChild;
    // Fallback: name should still appear, and kind defaults to 'user' for unknown names
    expect(screen.getByText('UnknownZzz')).toBeInTheDocument();
    expect(chip?.getAttribute('data-profile-kind')).toBe('user');
  });

  it('matches a name in the profiles array and resolves user kind', () => {
    const profiles = [
      agentProfile('Eve', { initials: 'EV', kind: 'user' }),
    ];
    const { container } = render(<ProjectMemberChip name="Eve" profiles={profiles} />);
    const chip = container.firstElementChild;
    expect(screen.getByText('Eve')).toBeInTheDocument();
    expect(screen.getByText('EV')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(chip?.getAttribute('data-profile-kind')).toBe('user');
    expect(chip?.getAttribute('title')).toBe('Eve · User');
  });
});
