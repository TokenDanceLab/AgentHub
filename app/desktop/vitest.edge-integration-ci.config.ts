import { desktopVitest } from './vitest.base';

export default desktopVitest({
  include: ['src/__tests__/integration/edge-integration.test.ts'],
  memoryLimit: '512MB',
  maxWorkers: 1,
});
