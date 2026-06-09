import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from 'expo/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const target = process.env.AGENTHUB_MOBILE_NATIVE_TARGET ?? 'all';
const envHubUrl = process.env.EXPO_PUBLIC_AGENTHUB_HUB_URL;
const envIssuer = process.env.EXPO_PUBLIC_TOKENDANCE_ID_ISSUER;

const allowedTargets = new Set(['all', 'android-emulator', 'ios-simulator', 'physical']);
const secretPattern = /(client_secret|password|private_key|api[_-]?key|bearer\s+[a-z0-9._-]{12,}|token\s*[:=]\s*['"][^'"]{12,})/i;
const legacyTokenDanceAssetPattern = new RegExp(`${['token', 'dance'].join('-')}[-/]`, 'i');

if (!allowedTargets.has(target)) {
  fail(`Unsupported AGENTHUB_MOBILE_NATIVE_TARGET: ${target}`);
}

const [packageJson, easJson, appConfigSource] = await Promise.all([
  readJson('package.json'),
  readJson('eas.json'),
  readText('app.config.ts'),
]);
const expoConfig = getConfig(projectRoot, { isPublicConfig: true }).exp;
const plugins = (expoConfig.plugins ?? []).map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);
const hubBaseUrl = typeof expoConfig.extra?.hubBaseUrl === 'string' ? expoConfig.extra.hubBaseUrl : '';
const oidcIssuer = typeof expoConfig.extra?.oidcIssuer === 'string' ? expoConfig.extra.oidcIssuer : '';

const checks = [];

check('package declares Expo entrypoint', packageJson.main === 'index.ts');
check('android script uses Expo native runner', packageJson.scripts?.android === 'expo run:android');
check('ios script uses Expo native runner', packageJson.scripts?.ios === 'expo run:ios');
check('Resolved Expo config declares agenthub scheme', expoConfig.scheme === 'agenthub');
check('Resolved Expo config declares Android package', expoConfig.android?.package === 'tech.vectorcontrol.agenthub.mobile');
check('Resolved Expo config declares iOS bundle identifier', expoConfig.ios?.bundleIdentifier === 'tech.vectorcontrol.agenthub.mobile');
check('Resolved Expo config supports tablet layout', expoConfig.ios?.supportsTablet === true);
check('Resolved Expo app icon uses AgentHub product asset', expoConfig.icon === './assets/agenthub-icon.png');
check('Resolved Expo splash uses AgentHub product asset', expoConfig.splash?.image === './assets/agenthub-splash-icon.png');
check('Resolved Android adaptive icon uses AgentHub product asset', expoConfig.android?.adaptiveIcon?.foregroundImage === './assets/agenthub-adaptive-icon.png');
check('Resolved Web favicon uses AgentHub product asset', expoConfig.web?.favicon === './assets/agenthub-favicon.png');
check('Resolved notification icon uses AgentHub product asset', getNotificationPluginIcon(expoConfig) === './assets/agenthub-notification-icon.png');
check('Native config does not reference legacy TokenDance asset filenames', !legacyTokenDanceAssetPattern.test(appConfigSource));
check('Native config does not use TokenDance org icon assets for AgentHub', !/assets\/tokendance-/i.test(appConfigSource));
check('Resolved Expo config includes localization plugin', plugins.includes('expo-localization'));
check('Resolved Expo config includes notifications plugin', plugins.includes('expo-notifications'));
check('Resolved Expo config includes SecureStore plugin', plugins.includes('expo-secure-store'));
check('Expo config reads Hub URL from EXPO_PUBLIC_AGENTHUB_HUB_URL', appConfigSource.includes('EXPO_PUBLIC_AGENTHUB_HUB_URL'));
check('Expo config reads TokenDance ID issuer from EXPO_PUBLIC_TOKENDANCE_ID_ISSUER', appConfigSource.includes('EXPO_PUBLIC_TOKENDANCE_ID_ISSUER'));
check('Resolved Expo config exposes Hub base URL', /^https?:\/\//.test(hubBaseUrl));
check('Resolved Expo config exposes TokenDance ID issuer', oidcIssuer.startsWith('https://'));
check('EAS development profile enables development client', easJson.build?.development?.developmentClient === true);
check('EAS development Android profile builds an APK', easJson.build?.development?.android?.buildType === 'apk');
check('EAS development iOS profile targets simulator', easJson.build?.development?.ios?.simulator === true);
check('Native config files do not contain obvious secrets', !secretPattern.test(`${appConfigSource}\n${JSON.stringify(easJson)}\n${JSON.stringify(packageJson)}`));

await Promise.all([
  checkAssetExists('AgentHub app icon asset exists', 'assets/agenthub-icon.png'),
  checkAssetExists('AgentHub adaptive icon asset exists', 'assets/agenthub-adaptive-icon.png'),
  checkAssetExists('AgentHub splash icon asset exists', 'assets/agenthub-splash-icon.png'),
  checkAssetExists('AgentHub favicon asset exists', 'assets/agenthub-favicon.png'),
  checkAssetExists('AgentHub notification icon asset exists', 'assets/agenthub-notification-icon.png'),
]);

const targets = target === 'all'
  ? []
  : [target];

for (const item of targets) {
  if (item === 'android-emulator') {
    check('Android emulator Hub URL uses emulator host loopback', hubBaseUrl.startsWith('http://10.0.2.2:'));
  }

  if (item === 'ios-simulator') {
    check('iOS simulator Hub URL uses simulator localhost', hubBaseUrl.startsWith('http://127.0.0.1:') || hubBaseUrl.startsWith('http://localhost:'));
  }

  if (item === 'physical') {
    check('Physical device Hub URL is provided explicitly', typeof envHubUrl === 'string' && envHubUrl.length > 0);
    check('Physical device Hub URL does not use host-only loopback', !/^https?:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::|\/|$)/.test(hubBaseUrl));
  }
}

if (envIssuer) {
  check('TokenDance ID issuer is HTTPS when overridden', envIssuer.startsWith('https://'));
}

const failures = checks.filter((item) => !item.ok);
const summary = {
  target,
  checkedTargets: targets,
  hubUrl: hubBaseUrl,
  oidcIssuer,
  checks,
  remainingDeviceProof: [
    'Install Android development build on emulator or device.',
    'Install iOS development build through simulator or EAS Build.',
    'Complete TokenDance ID AuthSession round trip in a development build.',
    'Verify SecureStore persistence and logout clearing on device.',
    'Verify notification delivery and tap routing on device.',
    'Verify Hub REST and update stream against mock/local/live Hub from a development build.',
  ],
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`Native readiness failed:\n${failures.map((item) => `- ${item.name}`).join('\n')}\n`);
  process.exitCode = 1;
}

function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

async function readText(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function checkAssetExists(name, relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    check(name, true);
  } catch {
    check(name, false);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function getNotificationPluginIcon(config) {
  const notificationPlugin = (config.plugins ?? []).find((plugin) => (
    Array.isArray(plugin) && plugin[0] === 'expo-notifications'
  ));

  return Array.isArray(notificationPlugin) && notificationPlugin[1]
    ? notificationPlugin[1].icon
    : undefined;
}
