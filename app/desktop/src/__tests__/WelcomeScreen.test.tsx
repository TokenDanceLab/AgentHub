vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WelcomeScreen from '@/components/WelcomeScreen';

describe('WelcomeScreen', () => {
  it('renders when online with prompt suggestions', () => {
    render(
      <WelcomeScreen
        online={true}
        onCreateThread={vi.fn()}
        onSendMessage={vi.fn()}
      />,
    );

    // Brand
    expect(screen.getByText('AgentHub')).toBeInTheDocument();
    expect(screen.getByText('welcome.subtitle')).toBeInTheDocument();
    // Description
    expect(screen.getByText('welcome.description')).toBeInTheDocument();
    // Create Thread button
    expect(screen.getByText('welcome.createThread')).toBeInTheDocument();
    // Suggestions label
    expect(screen.getByText('welcome.suggestionsLabel')).toBeInTheDocument();
    // Suggestion chips
    expect(screen.getByText('welcome.suggestion1')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestion2')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestion3')).toBeInTheDocument();
  });

  it('calls onCreateThread when Create Thread button is clicked', () => {
    const onCreateThread = vi.fn();
    render(
      <WelcomeScreen
        online={true}
        onCreateThread={onCreateThread}
        onSendMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('welcome.createThread'));
    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });

  it('calls onCreateThread then onSendMessage when suggestion chip is clicked', () => {
    const onCreateThread = vi.fn();
    const onSendMessage = vi.fn();
    render(
      <WelcomeScreen
        online={true}
        onCreateThread={onCreateThread}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(screen.getByText('welcome.suggestion1'));

    expect(onCreateThread).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('welcome.suggestion1');
    // onCreateThread must be called before onSendMessage
    expect(onCreateThread.mock.invocationCallOrder[0]).toBeLessThan(
      onSendMessage.mock.invocationCallOrder[0],
    );
  });
});
