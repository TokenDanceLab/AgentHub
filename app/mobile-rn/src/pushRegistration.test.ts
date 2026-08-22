import { describe, expect, it } from 'vitest';
import {
  registerForPushNotificationsAsync,
  type HubRegisterClient,
  type PushNotificationsLike,
  type ConstantsLike,
} from '@/pushRegistration';

function createFakeNotifications(overrides: Partial<PushNotificationsLike> = {}): PushNotificationsLike {
  return {
    async getPermissionsAsync() {
      return { status: 'undetermined', canAskAgain: true };
    },
    async requestPermissionsAsync() {
      return { status: 'granted', granted: true };
    },
    async getExpoPushTokenAsync() {
      return { data: 'ExponentPushToken[fake]' };
    },
    ...overrides,
  };
}

function createFakeConstants(overrides: Partial<ConstantsLike> = {}): ConstantsLike {
  return {
    deviceId: 'fake-device-id',
    expoConfig: { version: '0.4.1' },
    ...overrides,
  };
}

function createFakeClient(): HubRegisterClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    async registerDevice(body) {
      calls.push(body);
      return { id: body.device_id };
    },
    calls,
  };
}

describe('registerForPushNotificationsAsync', () => {
  it('requests permission, fetches the push token, and registers the device', async () => {
    const notifications = createFakeNotifications();
    const client = createFakeClient();

    const result = await registerForPushNotificationsAsync({
      notifications,
      constants: createFakeConstants(),
      client,
    });

    expect(result.status).toBe('granted');
    expect(result.pushToken).toBe('ExponentPushToken[fake]');
    expect(result.deviceId).toBe('fake-device-id');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      device_id: 'fake-device-id',
      device_type: 'mobile',
      app_version: '0.4.1',
      capabilities: ['push'],
    });
  });

  it('returns denied without registering when permission is denied', async () => {
    const notifications = createFakeNotifications({
      async getPermissionsAsync() {
        return { status: 'denied', canAskAgain: false };
      },
      async requestPermissionsAsync() {
        return { status: 'denied', canAskAgain: false };
      },
    });
    const client = createFakeClient();

    const result = await registerForPushNotificationsAsync({
      notifications,
      constants: createFakeConstants(),
      client,
    });

    expect(result.status).toBe('denied');
    expect(result.pushToken).toBeUndefined();
    expect(client.calls).toHaveLength(0);
  });

  it('returns granted without a token when getExpoPushTokenAsync throws', async () => {
    const notifications = createFakeNotifications({
      async getExpoPushTokenAsync() {
        throw new Error('network');
      },
    });
    const client = createFakeClient();

    const result = await registerForPushNotificationsAsync({
      notifications,
      constants: createFakeConstants(),
      client,
    });

    expect(result.status).toBe('granted');
    expect(result.pushToken).toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });

  it('still returns the push token when registerDevice throws', async () => {
    const notifications = createFakeNotifications();
    const client: HubRegisterClient = {
      async registerDevice() {
        throw new Error('hub down');
      },
    };

    const result = await registerForPushNotificationsAsync({
      notifications,
      constants: createFakeConstants(),
      client,
    });

    expect(result.status).toBe('granted');
    expect(result.pushToken).toBe('ExponentPushToken[fake]');
  });

  it('skips device registration when no device id is available', async () => {
    const notifications = createFakeNotifications();
    const client = createFakeClient();

    const result = await registerForPushNotificationsAsync({
      notifications,
      constants: createFakeConstants({ deviceId: null }),
      client,
    });

    expect(result.status).toBe('granted');
    expect(result.pushToken).toBe('ExponentPushToken[fake]');
    expect(result.deviceId).toBeUndefined();
    expect(client.calls).toHaveLength(0);
  });
});
