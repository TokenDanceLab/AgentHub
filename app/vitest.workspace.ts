import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'shared/vitest.config.ts',
  'desktop/vitest.config.ts',
  'web/vitest.config.ts',
]);
