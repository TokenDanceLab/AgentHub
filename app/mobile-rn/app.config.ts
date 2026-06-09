import type { ExpoConfig } from 'expo/config';

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

const config: ExpoConfig = {
  name: 'AgentHub Mobile',
  slug: 'agenthub-mobile',
  scheme: 'agenthub',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'tech.vectorcontrol.agenthub.mobile',
    supportsTablet: true,
  },
  android: {
    package: 'tech.vectorcontrol.agenthub.mobile',
  },
  plugins: [
    'expo-localization',
    [
      'expo-notifications',
      {
        color: '#0a84ff',
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
    hubBaseUrl: env?.EXPO_PUBLIC_AGENTHUB_HUB_URL ?? 'http://127.0.0.1:8080',
    oidcIssuer: env?.EXPO_PUBLIC_TOKENDANCE_ID_ISSUER ?? 'https://id.vectorcontrol.tech',
  },
};

export default config;
