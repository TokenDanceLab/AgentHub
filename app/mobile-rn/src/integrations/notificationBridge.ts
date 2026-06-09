import {
  parseNotificationIntent,
  type MobileNavigationTarget,
  type NotificationIntentErrorReason,
  type NotificationIntentIgnoreReason,
} from './notificationIntents';

export interface NotificationResponseLike {
  notification: {
    request: {
      identifier?: string;
      content: {
        data?: unknown;
      };
    };
  };
}

export interface NotificationSubscriptionLike {
  remove: () => void;
}

export interface NotificationsLike {
  getLastNotificationResponseAsync?: () => Promise<NotificationResponseLike | null>;
  addNotificationResponseReceivedListener?: (
    listener: (response: NotificationResponseLike) => void,
  ) => NotificationSubscriptionLike;
}

export interface NotificationChannelLike {
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

export interface AgentHubNotificationBridge {
  stop: () => void;
}

export interface StartAgentHubNotificationBridgeOptions {
  notifications: NotificationsLike;
  onNavigate?: (target: MobileNavigationTarget) => void;
  onIgnored?: (reason: NotificationIntentIgnoreReason) => void;
  onError?: (reason: NotificationIntentErrorReason) => void;
}

export async function startAgentHubNotificationBridge(
  options: StartAgentHubNotificationBridgeOptions,
): Promise<AgentHubNotificationBridge> {
  const handledNotificationIds = new Set<string>();

  const handleResponse = (response: NotificationResponseLike) => {
    const notificationId = response.notification.request.identifier;
    if (notificationId) {
      if (handledNotificationIds.has(notificationId)) {
        return;
      }
      handledNotificationIds.add(notificationId);
    }

    const result = parseNotificationIntent(response.notification.request.content.data);

    if (result.kind === 'navigate') {
      options.onNavigate?.(result.target);
      return;
    }

    if (result.kind === 'ignore') {
      options.onIgnored?.(result.reason);
      return;
    }

    options.onError?.(result.reason);
  };

  const lastResponse = await options.notifications.getLastNotificationResponseAsync?.();
  if (lastResponse) {
    handleResponse(lastResponse);
  }

  const subscription = options.notifications.addNotificationResponseReceivedListener?.((response) => {
    handleResponse(response);
  });

  return {
    stop() {
      subscription?.remove();
    },
  };
}

export async function startExpoAgentHubNotificationBridge(
  options: Omit<StartAgentHubNotificationBridgeOptions, 'notifications'>,
): Promise<AgentHubNotificationBridge> {
  const notifications = await import('expo-notifications');
  return startAgentHubNotificationBridge({
    ...options,
    notifications: {
      async getLastNotificationResponseAsync() {
        return notifications.getLastNotificationResponseAsync();
      },
      addNotificationResponseReceivedListener(listener) {
        return notifications.addNotificationResponseReceivedListener(
          listener as (response: Awaited<ReturnType<typeof notifications.getLastNotificationResponseAsync>>) => void,
        );
      },
    },
  });
}

export async function configureAgentHubAndroidNotificationChannel(
  notifications: NotificationChannelLike,
): Promise<void> {
  await notifications.setNotificationChannelAsync?.('agenthub-review', {
    name: 'AgentHub review',
    importance: notifications.AndroidImportance?.HIGH ?? notifications.AndroidImportance?.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#0071BC',
  });
}

export async function configureExpoAgentHubAndroidNotificationChannel(): Promise<void> {
  const notifications = await import('expo-notifications');
  await notifications.setNotificationChannelAsync('agenthub-review', {
    name: 'AgentHub review',
    importance: notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#0071BC',
  });
}
