import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      '@testing-library/react': path.resolve(__dirname, 'node_modules', '@testing-library', 'react'),
      'lucide-react': path.resolve(__dirname, 'node_modules', 'lucide-react'),
      'react': path.resolve(__dirname, 'node_modules', 'react'),
      'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
      'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
    },
  },
  server: { fs: { allow: ['..'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['../shared/src/**/*.test.ts', '../shared/src/**/*.test.tsx'],
    exclude: ['../shared/src/events.test.ts', '../shared/src/components/__tests__/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    execArgv: ['--max-old-space-size=4096'],
    memoryLimit: '512MB',
    maxWorkers: 4,
  },
});
