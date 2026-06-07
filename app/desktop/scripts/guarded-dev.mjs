import { spawn } from 'node:child_process';

const DEV_URL = 'http://127.0.0.1:5173';
const MAIN_URL = `${DEV_URL}/src/main.tsx`;

async function readText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function assertExistingServerIsDesktop() {
  const main = await readText(MAIN_URL);
  if (!main) return false;

  const isDesktopEntry =
    main.includes('/src/App.tsx') &&
    main.includes('/src/styles/themes.css') &&
    main.includes('/src/styles/tokens.css') &&
    main.includes('/app/desktop/src/main.tsx') &&
    main.includes('QueryClientProvider');

  if (!isDesktopEntry) {
    console.error(
      [
        `[agenthub-desktop] ${DEV_URL} is already serving a non-Desktop app.`,
        'Stop the process on port 5173 before launching AgentHub Desktop.',
        'Desktop must load app/desktop/src/main.tsx; Web uses port 5174.',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log(`[agenthub-desktop] Reusing verified Desktop dev server at ${DEV_URL}`);
  return true;
}

function startVite() {
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'corepack';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'corepack.cmd pnpm exec vite']
      : ['pnpm', 'exec', 'vite'];
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

if (!(await assertExistingServerIsDesktop())) {
  startVite();
}
