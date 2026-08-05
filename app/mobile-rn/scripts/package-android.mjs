import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, 'package-android.py');
const forwardedArgs = process.argv.slice(2);

if (forwardedArgs[0] === '--') {
  forwardedArgs.shift();
}

const python = process.env.PYTHON_EXE || 'python';
const result = spawnSync(
  python,
  [scriptPath, ...forwardedArgs],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
