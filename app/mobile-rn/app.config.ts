import type { ExpoConfig } from 'expo/config';

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

export function resolveDefaultHubBaseUrl(): string {
  if (env?.EXPO_PUBLIC_AGENTHUB_HUB_URL) {
    return env.EXPO_PUBLIC_AGENTHUB_HUB_URL;
  }
  if (env?.AGENTHUB_MOBILE_NATIVE_TARGET === 'android-emulator') {
    return 'http://10.0.2.2:8088';
  }

  return 'http://127.0.0.1:8088';
}

const config = {
  name: 'AgentHub',
  slug: 'agenthub-mobile',
  scheme: 'agenthub',
  version: '0.4.1',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/agenthub-icon.png',
  splash: {
    image: './assets/agenthub-splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    bundleIdentifier: 'tech.vectorcontrol.agenthub.mobile',
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/agenthub-adaptive-icon.png',
      backgroundColor: '#0A84FF',
    },
    package: 'tech.vectorcontrol.agenthub.mobile',
  },
  web: {
    favicon: './assets/agenthub-favicon.png',
  },
  plugins: [
    'expo-localization',
    [
      'expo-image-picker',
      {
        cameraPermission: '允许 AgentHub 拍摄任务审查证据照片 / Allow AgentHub to capture evidence photos for task reviews.',
        photosPermission: '允许 AgentHub 选择照片或视频作为任务证据 / Allow AgentHub to attach selected photos or videos as task evidence.',
        microphonePermission: false,
      },
    ],
    'expo-document-picker',
    [
      'expo-notifications',
      {
        color: '#0a84ff',
        icon: './assets/agenthub-notification-icon.png',
      },
    ],
    [
      'expo-secure-store',
      {
        faceIDPermission: '允许 AgentHub 使用设备生物识别解锁本地 Hub 会话 / Allow AgentHub to unlock the local Hub session with device biometrics.',
      },
    ],
    'expo-web-browser',
  ],
  extra: {
    hubBaseUrl: resolveDefaultHubBaseUrl(),
    // Empty by default: publishing a build without EXPO_PUBLIC_TOKENDANCE_ID_ISSUER
    // must fail loudly at runtime (login disabled) instead of shipping a
    // placeholder issuer that can never succeed.
    oidcIssuer: env?.EXPO_PUBLIC_TOKENDANCE_ID_ISSUER ?? '',
  },
} as ExpoConfig;

export default config;
