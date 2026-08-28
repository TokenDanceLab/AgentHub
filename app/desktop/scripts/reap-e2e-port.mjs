// Reap any leftover process listening on the desktop E2E port (#2003).
//
// Root cause: playwright.config.ts used `reuseExistingServer: !process.env.CI`,
// so locally a leftover dev server on the E2E port (a manual `pnpm dev` or an
// interrupted Playwright child) was silently reused and the `webServer.env`
// block never applied — HUB_URL fell back to the production default.
//
// Playwright with `reuseExistingServer: false` does NOT kill the occupant; it
// only throws "…already used…". To keep the run green while still using the
// test-env server, this script kills whatever listens on the port and blocks
// until the port is actually free, before Playwright checks availability.
//
// Usage: node reap-e2e-port.mjs <port>

import { execSync } from 'node:child_process';
import net from 'node:net';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('[reap-e2e-port] missing/invalid port argument');
  process.exit(2);
}

function isListening(probePort) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: probePort, host: '127.0.0.1' });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function killListeners(probePort) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${probePort} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore' },
      );
    } else {
      execSync(
        `pids=$(lsof -ti tcp:${probePort}); [ -n "$pids" ] && kill -9 $pids`,
        { stdio: 'ignore', shell: '/bin/sh' },
      );
    }
  } catch {
    // Best effort: if we cannot kill it, the loop times out and Playwright's
    // reuseExistingServer:false fails closed with a clear error instead.
  }
}

const DEADLINE_MS = 12000;
const deadline = Date.now() + DEADLINE_MS;
let listening = await isListening(port);
while (listening && Date.now() < deadline) {
  killListeners(port);
  await new Promise((resolve) => setTimeout(resolve, 400));
  listening = await isListening(port);
}

if (listening) {
  console.error(
    `[reap-e2e-port] port ${port} is still occupied after ${DEADLINE_MS}ms; Playwright will fail closed`,
  );
  process.exit(1);
}

console.log(`[reap-e2e-port] port ${port} is free for a fresh test-env dev server`);
