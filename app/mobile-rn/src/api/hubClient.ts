import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';

export interface HubClient {
  getMobileSnapshot: () => Promise<MobileAppFixture>;
}

export function createMockHubClient(delayMs = 80): HubClient {
  return {
    async getMobileSnapshot() {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });

      return mobileFixture;
    },
  };
}

export function createHubWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v1/events';

  return url.toString();
}
