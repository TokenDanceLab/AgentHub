import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'mock-emoji-mart-data',
      resolveId(id) {
        if (id === '@emoji-mart/data' || id.startsWith('@emoji-mart/data/')) {
          return path.resolve(__dirname, 'src/mocks/emoji-mart-data.ts');
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      '@emoji-mart/data': path.resolve(__dirname, 'src/mocks/emoji-mart-data.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.e2e.test.ts', 'src/**/*.e2e.test.tsx', 'e2e/**'],
    setupFiles: ['./src/test-setup.ts'],
    server: {
      deps: {
        inline: ['@emoji-mart/data', 'emoji-mart'],
      },
    },
  },
});
