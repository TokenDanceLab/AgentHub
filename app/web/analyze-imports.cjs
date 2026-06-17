const fs = require('fs');
const path = require('path');

// Strategy: use esbuild's metafile from a failed build or trace imports differently.
// Instead, let's do a per-package analysis by checking all files in the dep tree
// and doing a comprehensive disk + import analysis.

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}

function getDirSize(dir) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') total += getDirSize(full);
      else if (e.isFile()) try { total += fs.statSync(full).size; } catch(_) {}
    }
  } catch(_) {}
  return total;
}

// ============================================================
// Comprehensive analysis using multi-source evidence
// ============================================================

// 1. Check pnpm store for all resolved packages relevant to the web app
const appDir = path.resolve(__dirname, '..');
const parentPnpm = path.join(appDir, 'node_modules', '.pnpm');

// 2. Find the direct web dependencies + shared/src imports
const sharedSrc = path.join(appDir, 'shared', 'src');
const webSrc = path.resolve('src');

// 3. Check shared/src for all import statements
function findImports(dir) {
  const imports = new Set();
  function walk(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__tests__' && e.name !== 'node_modules') {
          walk(full);
        } else if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name) && !e.name.includes('.test.') && !e.name.includes('.stories.')) {
          const content = fs.readFileSync(full, 'utf-8');
          for (const line of content.split('\n')) {
            const m = line.match(/from\s+['"]([^'"]+)['"]/);
            if (m) {
              const spec = m[1];
              if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('@shared')) {
                // External package
                const pkgName = spec.startsWith('@') ? spec.split('/').slice(0,2).join('/') : spec.split('/')[0];
                imports.add(pkgName);
              }
            }
          }
        }
      }
    } catch(_) {}
  }
  walk(dir);
  return imports;
}

const webImports = findImports(webSrc);
const sharedImports = findImports(sharedSrc);
const allImports = new Set([...webImports, ...sharedImports]);

console.log('=== Web src imports:');
[...webImports].sort().forEach(i => console.log('  ' + i));
console.log('');
console.log('=== Shared src imports (additional):');
[...sharedImports].filter(i => !webImports.has(i)).sort().forEach(i => console.log('  ' + i));
console.log('');

// 4. For each import, find the resolved pnpm package and measure disk size
console.log('=== Package sizes (disk, from pnpm store):');
console.log('');

const results = [];
for (const pkgName of allImports) {
  let pkgDir = null;
  const cleanName = pkgName.replace('/', '+');

  // Find in .pnpm
  const entries = fs.readdirSync(parentPnpm).filter(e => e.startsWith(cleanName + '@'));
  if (entries.length > 0) {
    // Find the actual pkg dir
    const entry = entries[0];
    const nodeModDir = path.join(parentPnpm, entry, 'node_modules');
    if (fs.existsSync(nodeModDir)) {
      const subs = fs.readdirSync(nodeModDir);
      for (const sub of subs) {
        const d = path.join(nodeModDir, sub);
        if (fs.statSync(d).isDirectory()) {
          pkgDir = d;
          break;
        }
      }
    }
  }

  if (pkgDir) {
    const size = getDirSize(pkgDir);
    results.push({ name: pkgName, size, dir: pkgDir });
  }
}

results.sort((a, b) => b.size - a.size);
results.forEach((r, i) => {
  console.log((i+1).toString().padStart(3) + '. ' + formatSize(r.size).padStart(10) + '  ' + r.name);
});

// 5. Special: Check transitive deps pulled in through the above
console.log('');
console.log('=== Key transitive deps (pulled by the above):');
console.log('');

// Check react-syntax-highlighter -> prismjs, refractor
function resolvePnpmPkg(name) {
  const cleanName = name.replace('/', '+');
  const entries = fs.readdirSync(parentPnpm).filter(e => e.startsWith(cleanName + '@'));
  if (entries.length === 0) return null;
  const entry = entries[0];
  const nm = path.join(parentPnpm, entry, 'node_modules', name);
  if (fs.existsSync(nm)) return { dir: nm, entry };
  // Check nested
  const nodeModDir = path.join(parentPnpm, entry, 'node_modules');
  if (fs.existsSync(nodeModDir)) {
    const subs = fs.readdirSync(nodeModDir);
    for (const sub of subs) {
      const d = path.join(nodeModDir, sub);
      if (fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'package.json'))) {
        return { dir: d, entry };
      }
    }
  }
  return null;
}

const transientChecks = [
  'prismjs',
  'refractor',
  'lowlight',
  'fault',
  'highlight.js',
  'es-toolkit',
  'polished',
  'antd-style',
  'motion',
  'framer-motion',
  'antd',
  '@lobehub/ui',
  '@lobehub/fluent-emoji',
];

transientChecks.forEach(name => {
  const pkg = resolvePnpmPkg(name);
  if (pkg) {
    const size = getDirSize(pkg.dir);
    console.log(formatSize(size).padStart(10) + '  ' + name + ' (transient, from pnpm)');
  } else {
    console.log('  NOT_FOUND  ' + name);
  }
});

console.log('');
console.log('=== Source code sizes:');
console.log(formatSize(getDirSize(sharedSrc)).padStart(10) + '  shared/src (276 files)');
console.log(formatSize(getDirSize(webSrc)).padStart(10) + '  web/src (144 files)');
