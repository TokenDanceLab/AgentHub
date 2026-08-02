import { defineConfig } from 'vitest/config';
import path from 'node:path';

const projectRoot = (name: string) => path.resolve(__dirname, name);

// Vitest 4 replaced the removed `defineWorkspace` API with projects. Keep the
// app-level command explicit so it cannot fall back to Vitest's broad default
// glob and accidentally collect Playwright specs as unit tests.
export default defineConfig({
  test: {
    projects: [
      {
        extends: 'shared/vitest.config.ts',
        root: projectRoot('shared'),
        test: { name: 'shared', sequence: { groupOrder: 1 } },
      },
      {
        extends: 'desktop/vitest.desktop-ci.config.ts',
        root: projectRoot('desktop'),
        test: { name: 'desktop', sequence: { groupOrder: 2 } },
      },
      {
        extends: 'web/vitest.config.ts',
        root: projectRoot('web'),
        test: { name: 'web', sequence: { groupOrder: 3 } },
      },
      {
        extends: 'mobile-rn/vitest.config.ts',
        root: projectRoot('mobile-rn'),
        test: { name: 'mobile-rn', sequence: { groupOrder: 4 } },
      },
    ],
  },
});
