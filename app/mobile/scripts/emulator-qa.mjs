import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packageName = process.env.AGENTHUB_MOBILE_PACKAGE ?? "com.agenthub.mobile";
const screenshotDir = join(process.cwd(), "screenshots");
const launchDelayMs = Number(process.env.AGENTHUB_EMULATOR_LAUNCH_DELAY_MS ?? "4200");
let selectedDevice = process.env.ADB_SERIAL ?? null;

function resolveAdb() {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : null,
    process.env.ANDROID_SDK_ROOT ? join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe") : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe") : null,
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "adb" || existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("adb was not found. Set ANDROID_HOME or ADB before running emulator:qa.");
}

const adb = resolveAdb();
function adbArgs(args) {
  return selectedDevice ? ["-s", selectedDevice, ...args] : args;
}

function adbText(args) {
  return execFileSync(adb, adbArgs(args), { encoding: "utf8" });
}

function adbBuffer(args) {
  return execFileSync(adb, adbArgs(args));
}

function listDevices() {
  return adbText(["devices"])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

function ensureDevice() {
  if (selectedDevice) {
    return selectedDevice;
  }
  const devices = listDevices();
  if (!devices.length) {
    throw new Error("No online Android device found for emulator:qa.");
  }
  selectedDevice = devices[0];
  return selectedDevice;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentDisplaySize() {
  const displayInfo = adbText(["shell", "dumpsys", "window", "displays"]);
  const currentMatch = displayInfo.match(/\bcur=(\d+)x(\d+)/);
  if (currentMatch) {
    return { width: Number(currentMatch[1]), height: Number(currentMatch[2]) };
  }

  const sizeInfo = adbText(["shell", "wm", "size"]);
  const sizeMatch = sizeInfo.match(/Physical size:\s*(\d+)x(\d+)/);
  if (sizeMatch) {
    return { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) };
  }
  throw new Error("Could not read Android display size.");
}

function tapRatio(xRatio, yRatio) {
  const { width, height } = currentDisplaySize();
  const x = Math.round(width * xRatio);
  const y = Math.round(height * yRatio);
  adbText(["shell", "input", "tap", String(x), String(y)]);
}

function capture(fileName) {
  mkdirSync(screenshotDir, { recursive: true });
  const filePath = join(screenshotDir, fileName);
  writeFileSync(filePath, adbBuffer(["exec-out", "screencap", "-p"]));
  return filePath;
}

function viewportTapPoints() {
  const { width, height } = currentDisplaySize();
  if (width > height) {
    return {
      threadsTab: [0.335, 0.94],
      chatTab: [0.447, 0.94],
      runsTab: [0.556, 0.94],
      settingsTab: [0.666, 0.94],
      signIn: [0.337, 0.675],
    };
  }
  return {
    threadsTab: [0.125, 0.94],
    chatTab: [0.375, 0.94],
    runsTab: [0.625, 0.94],
    settingsTab: [0.875, 0.94],
    signIn: [0.19, 0.54],
  };
}

const device = ensureDevice();
adbText(["shell", "am", "force-stop", packageName]);
adbText(["shell", "monkey", "-p", packageName, "1"]);
await sleep(launchDelayMs);

const taps = viewportTapPoints();
const currentPath = capture("mobile-ui-current-emulator.png");
const threadsPath = capture("mobile-ui-threads-emulator-current.png");
tapRatio(...taps.chatTab);
await sleep(900);
const chatPath = capture("mobile-ui-chat-emulator-current.png");
tapRatio(...taps.runsTab);
await sleep(1200);
const runsPath = capture("mobile-ui-runs-emulator-current.png");
tapRatio(...taps.settingsTab);
await sleep(1000);
const settingsPath = capture("mobile-ui-settings-emulator-current.png");
tapRatio(...taps.signIn);
await sleep(1500);
const recoveryPath = capture("mobile-ui-settings-login-recovery-emulator.png");

console.log(JSON.stringify({
  device,
  packageName,
  screenshots: [currentPath, threadsPath, chatPath, runsPath, settingsPath, recoveryPath],
}, null, 2));
