import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import WelcomeScreen from './WelcomeScreen';

describe('WelcomeScreen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the no-runtime state through shared EmptyState', () => {
    render(
      <WelcomeScreen
        online
        agents={[]}
        onCreateThread={() => {}}
        onSendMessage={() => {}}
      />,
    );

    expect(screen.getByRole('region', { name: 'No Runtime adapters detected' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Runtime adapters detected' })).toBeInTheDocument();
    expect(screen.getByText('Connect a Desktop runtime or refresh Hub session state before dispatching from this workspace.')).toBeInTheDocument();
  });

  it('renders offline runtime guidance through shared EmptyState', async () => {
    render(
      <WelcomeScreen
        online={false}
        agents={[]}
        onCreateThread={() => {}}
        onSendMessage={() => {}}
      />,
    );

    expect(screen.getByRole('region', { name: 'Runtime route unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Runtime route unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Runtime routing is unavailable. Keep this workspace open while the Desktop runtime reconnects.')).toBeInTheDocument();
  });
});
