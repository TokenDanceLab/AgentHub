import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(ts|tsx)',
    '../../shared/src/ui/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    Object.assign(config.resolve.alias, {
      '@': path.resolve(__dirname, '..', 'src'),
      '@shared': path.resolve(__dirname, '..', '..', 'shared', 'src'),
    });
    config.css ??= {};
    config.css.modules = { localsConvention: 'camelCase' };
    return config;
  },
};

export default config;
