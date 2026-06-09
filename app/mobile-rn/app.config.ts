import type { ExpoConfig } from 'expo/config';

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

function resolveDefaultHubBaseUrl(): string {
  if (env?.EXPO_PUBLIC_AGENTHUB_HUB_URL) {
    return env.EXPO_PUBLIC_AGENTHUB_HUB_URL;
  }
  if (env?.AGENTHUB_MOBILE_NATIVE_TARGET === 'android-emulator') {
    return 'http://10.0.2.2:8088';
  }

  return 'http://127.0.0.1:8088';
}

const config = {
  name: 'AgentHub Mobile',
  slug: 'agenthub-mobile',
  scheme: 'agenthub',
  version: '0.1.0',
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
      'expo-notifications',
      {
        color: '#0a84ff',
        icon: './assets/agenthub-notification-icon.png',
      },
    ],
    [
      'expo-secure-store',
      {
        faceIDPermission: 'Allow AgentHub to unlock the local Hub session with device biometrics.',
      },
    ],
  ],
  extra: {
    hubBaseUrl: resolveDefaultHubBaseUrl(),
    oidcIssuer: env?.EXPO_PUBLIC_TOKENDANCE_ID_ISSUER ?? 'https://id.vectorcontrol.tech',
  },
} as ExpoConfig;

export default config;
