import { desktopVitest } from './vitest.base';

export default desktopVitest({
  include: ['src/**/*.test.ts'],
  exclude: ['src/__tests__/integration/**'],
  memoryLimit: '512MB',
});
