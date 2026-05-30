import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import IMContactList from './IMContactList';
import IMMessageView from './IMMessageView';
import type { IMContact } from './types';

const contact: IMContact = {
  id: 'agent-1',
  name: 'Code Agent',
  type: 'agent',
  authority: 'hub',
  online: true,
};

describe('IM empty states', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders contact list empty state with shared semantics', () => {
    render(<IMContactList contacts={[]} />);

    expect(screen.getByRole('region', { name: 'No conversations yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No conversations yet' })).toBeInTheDocument();
    expect(screen.getByText('Hub contacts and agent sessions will appear here after sign-in or sync.')).toBeInTheDocument();
  });

  it('renders search no-match empty state with a description', () => {
    render(<IMContactList contacts={[contact]} />);

    fireEvent.change(screen.getByLabelText('Search contacts and sessions...'), {
      target: { value: 'missing' },
    });

    expect(screen.getByRole('region', { name: 'No conversations match your search' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No conversations match your search' })).toBeInTheDocument();
    expect(screen.getByText('Try another contact name, agent, or group session.')).toBeInTheDocument();
  });

  it('renders message timeline empty state with shared semantics', () => {
    render(<IMMessageView messages={[]} />);

    expect(screen.getByRole('region', { name: 'No messages yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No messages yet' })).toBeInTheDocument();
    expect(screen.getByText('Start a Hub conversation to begin.')).toBeInTheDocument();
  });
});
