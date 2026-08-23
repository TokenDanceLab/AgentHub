import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ErrorBoundary from './ErrorBoundary';
import { Button } from './Button';

const meta: Meta<typeof ErrorBoundary> = {
  title: 'UI/ErrorBoundary',
  component: ErrorBoundary,
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

function HealthyContent({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '1rem', border: '1px solid var(--td-line, #888)' }}>
      {children}
    </div>
  );
}

/** Renders a React element whose component throws during render. */
function ThrowingContent({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

export const Healthy: Story = {
  render: () => (
    <ErrorBoundary>
      <HealthyContent>App content that renders fine.</HealthyContent>
    </ErrorBoundary>
  ),
};

export const CaughtUnknownError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowingContent message="Something went wrong while rendering this card." />
    </ErrorBoundary>
  ),
};

export const CaughtNetworkError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowingContent message="NetworkError: Failed to fetch data from the server" />
    </ErrorBoundary>
  ),
};

export const WithOnReset: Story = {
  render: () => (
    <ErrorBoundary
      onReset={() => {
        console.log('reset requested');
      }}
    >
      <ThrowingContent message="A transient render error." />
    </ErrorBoundary>
  ),
};

export const WithStack: Story = {
  render: () => (
    <ErrorBoundary showStack>
      <ThrowingContent message="A render error with a stack trace visible." />
    </ErrorBoundary>
  ),
};

export const WithExtension: Story = {
  render: () => (
    <ErrorBoundary
      extensions={[
        {
          matches: (error) => /custom/.test(error.message),
          config: {
            icon: <Button variant="secondary" size="sm">Custom</Button>,
            iconClass: undefined,
            titleKey: 'custom.title',
            titleFallback: 'Custom Failure',
            descKey: 'custom.desc',
            descFallback: 'A matching extension handled this error.',
            primaryLabelKey: 'custom.action',
            primaryLabelFallback: 'Take Custom Action',
          },
          onPrimary: () => {
            console.log('custom primary action');
          },
        },
      ]}
    >
      <ThrowingContent message="custom handler matched" />
    </ErrorBoundary>
  ),
};
