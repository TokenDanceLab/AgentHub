import type { Preview } from '@storybook/react';
import '../src/styles/tokens.css';
import '../src/styles/themes.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1d24' },
        { name: 'light', value: '#f8f9fc' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: '2rem', fontFamily: 'var(--font-sans, sans-serif)' }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
