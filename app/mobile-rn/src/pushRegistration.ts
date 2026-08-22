// Push notification registration for AgentHub Mobile.
//
// Pipeline: request permission → get Expo push token → keep the token for
// LOCAL notification handling. Device registration with the Hub is optional
// (injected client); the token itself is never forwarded.
//
// Server-side push boundary (verified lane C-1824, 2026-08-23): hub-server
// has NO push delivery facility — no FCM/APNs/Expo push consumer, no device
// push_token column, and registerDevice (hub-server/internal/handler/device.go
// / shared HubRegisterDeviceRequest) carries no token field. Forwarding the
// token would not reach any delivery path, so mobile keeps the push token
// local and the capability boundary is documented in README (evidence table +
// 'Push and notification capabilities'). Revisit only when the Hub side ships
// a delivery path (device token storage + sender).
//
// Pure, injectable core + an expo-runtime entry that lazy-imports native deps.

import { configureExpoAgentHubAndroidNotificationChannel } from '@/integrations/notificationBridge';

export type PushPermissionState = 'granted' | 'denied' | 'unavailable';

export interface PushRegistrationResult {
  status: PushPermissionState;
  pushToken?: string;
  deviceId?: string;
}

export interface PushPermissionLike {
  status?: string;
  canAskAgain?: boolean;
  granted?: boolean;
}

export interface PushNotificationsLike {
  getPermissionsAsync?: () => Promise<PushPermissionLike>;
  requestPermissionsAsync?: (permissions?: unknown) => Promise<PushPermissionLike>;
  getExpoPushTokenAsync?: (options?: unknown) => Promise<{ data?: string }>;
  setNotificationChannelAsync?: (
    channelId: string,
    channel: {
      name: string;
      importance?: unknown;
      vibrationPattern?: number[];
      lightColor?: string;
    },
  ) => Promise<unknown>;
  AndroidImportance?: {
    DEFAULT?: unknown;
    HIGH?: unknown;
  };
}

export interface ConstantsLike {
  deviceId?: string | null;
  expoConfig?: { version?: string } | null;
}

export interface HubRegisterClient {
  registerDevice: (body: {
    device_id: string;
    device_type?: string;
    device_name?: string;
    app_version?: string;
    capabilities?: string[];
  }) => Promise<unknown>;
}

export interface RegisterForPushNotificationsOptions {
  notifications: PushNotificationsLike;
  constants: ConstantsLike;
  client?: HubRegisterClient;
  deviceType?: string;
}

export async function registerForPushNotificationsAsync(
  options: RegisterForPushNotificationsOptions,
): Promise<PushRegistrationResult> {
  const { notifications, constants } = options;
  const deviceType = options.deviceType ?? 'mobile';

  const current = await callOptional(notifications, 'getPermissionsAsync') ?? { status: 'unavailable' };
  let permission = current;

  if (!isGranted(permission)) {
    permission = await callOptional(notifications, 'requestPermissionsAsync', [{ alert: true, badge: true, sound: true }]) ?? permission;
  }

  if (!isGranted(permission)) {
    return { status: permission.status === 'denied' ? 'denied' : 'unavailable' };
  }

  const pushToken = await resolveExpoPushToken(notifications);
  const deviceId = constants.deviceId ?? undefined;
  const client = options.client;

  if (client && deviceId) {
    try {
      await client.registerDevice({
        device_id: deviceId,
        device_type: deviceType,
        ...(constants.expoConfig?.version ? { app_version: constants.expoConfig.version } : {}),
        capabilities: ['push'],
      });
    } catch {
      // Device registration failure is non-fatal: the push token is still
      // returned so local notification handling keeps working. The Hub will
      // reconcile device records on the next authenticated call.
    }
  }

  return {
    status: 'granted',
    ...(pushToken ? { pushToken } : {}),
    ...(deviceId ? { deviceId } : {}),
  };
}

export async function registerExpoForPushNotificationsAsync(
  options: {
    client?: HubRegisterClient;
    deviceType?: string;
    platform?: 'android' | 'ios' | 'web';
  } = {},
): Promise<PushRegistrationResult> {
  const [notifications, constants] = await Promise.all([
    import('expo-notifications'),
    import('expo-constants'),
  ]);

  if (options.platform === 'android' || options.platform == null) {
    const maybePlatform = options.platform ?? guessPlatform();
    if (maybePlatform === 'android') {
      await configureExpoAgentHubAndroidNotificationChannel();
    }
  }

  return registerForPushNotificationsAsync({
    notifications: notifications as unknown as PushNotificationsLike,
    constants: constants as unknown as ConstantsLike,
    ...(options.client ? { client: options.client } : {}),
    ...(options.deviceType ? { deviceType: options.deviceType } : {}),
  });
}

function isGranted(permission: PushPermissionLike | null | undefined): boolean {
  return Boolean(permission?.granted) || permission?.status === 'granted';
}

async function resolveExpoPushToken(notifications: PushNotificationsLike): Promise<string | undefined> {
  try {
    const response = await notifications.getExpoPushTokenAsync?.();
    return response?.data;
  } catch {
    return undefined;
  }
}

async function callOptional<
  Notifications extends PushNotificationsLike,
  MethodName extends 'getPermissionsAsync' | 'requestPermissionsAsync',
>(
  notifications: Notifications,
  method: MethodName,
  args?: unknown[],
): Promise<PushPermissionLike | undefined> {
  const fn = notifications[method] as
    | ((...a: unknown[]) => Promise<PushPermissionLike>)
    | undefined;
  if (typeof fn !== 'function') {
    return undefined;
  }
  try {
    return await (args ? fn(...args) : fn());
  } catch {
    return undefined;
  }
}

function guessPlatform(): 'android' | 'ios' | 'web' {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'ios';
  }
  return 'web';
}
