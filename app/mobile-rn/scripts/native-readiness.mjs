import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const checks = [];

check('package declares Expo entrypoint', packageJson.main === 'index.ts');
check('android script uses Expo native runner', packageJson.scripts?.android === 'expo run:android');
check('ios script uses Expo native runner', packageJson.scripts?.ios === 'expo run:ios');
check('Expo config declares agenthub scheme', appConfigSource.includes("scheme: 'agenthub'"));
check('Expo config declares Android package', appConfigSource.includes("package: 'tech.vectorcontrol.agenthub.mobile'"));
check('Expo config declares iOS bundle identifier', appConfigSource.includes("bundleIdentifier: 'tech.vectorcontrol.agenthub.mobile'"));
check('Expo config supports tablet layout', appConfigSource.includes('supportsTablet: true'));
check('Expo app icon uses AgentHub product asset', appConfigSource.includes("icon: './assets/agenthub-icon.png'"));
check('Expo splash uses AgentHub product asset', appConfigSource.includes("image: './assets/agenthub-splash-icon.png'"));
check('Android adaptive icon uses AgentHub product asset', appConfigSource.includes("foregroundImage: './assets/agenthub-adaptive-icon.png'"));
check('Web favicon uses AgentHub product asset', appConfigSource.includes("favicon: './assets/agenthub-favicon.png'"));
check('Notification icon uses AgentHub product asset', appConfigSource.includes("icon: './assets/agenthub-notification-icon.png'"));
check('Native config does not reference legacy TokenDance asset filenames', !legacyTokenDanceAssetPattern.test(appConfigSource));
check('Native config does not use TokenDance org icon assets for AgentHub', !/assets\/tokendance-/i.test(appConfigSource));
check('Expo config includes localization plugin', appConfigSource.includes("'expo-localization'"));
check('Expo config includes notifications plugin', appConfigSource.includes("'expo-notifications'"));
check('Expo config includes SecureStore plugin', appConfigSource.includes("'expo-secure-store'"));
check('Expo config reads Hub URL from EXPO_PUBLIC_AGENTHUB_HUB_URL', appConfigSource.includes('EXPO_PUBLIC_AGENTHUB_HUB_URL'));
check('Expo config reads TokenDance ID issuer from EXPO_PUBLIC_TOKENDANCE_ID_ISSUER', appConfigSource.includes('EXPO_PUBLIC_TOKENDANCE_ID_ISSUER'));
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
  ? ['android-emulator', 'ios-simulator']
  : [target];

for (const item of targets) {
  if (item === 'android-emulator') {
    const hubUrl = envHubUrl ?? 'http://10.0.2.2:8088';
    check('Android emulator Hub URL uses emulator host loopback', hubUrl.startsWith('http://10.0.2.2:'));
  }

  if (item === 'ios-simulator') {
    const hubUrl = envHubUrl ?? 'http://127.0.0.1:8088';
    check('iOS simulator Hub URL uses simulator localhost', hubUrl.startsWith('http://127.0.0.1:') || hubUrl.startsWith('http://localhost:'));
  }

  if (item === 'physical') {
    check('Physical device Hub URL is provided explicitly', typeof envHubUrl === 'string' && envHubUrl.length > 0);
    check('Physical device Hub URL does not use host-only loopback', typeof envHubUrl === 'string' && !/^https?:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::|\/|$)/.test(envHubUrl));
  }
}

if (envIssuer) {
  check('TokenDance ID issuer is HTTPS when overridden', envIssuer.startsWith('https://'));
}

const failures = checks.filter((item) => !item.ok);
const summary = {
  target,
  checkedTargets: targets,
  hubUrl: envHubUrl ?? '(target default)',
  oidcIssuer: envIssuer ?? '(app default)',
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
