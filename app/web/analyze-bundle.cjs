const esbuild = require('D:/Code/TokenDance/AgentHub/.worktrees/chatview-migration/app/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const fs = require('fs');
const path = require('path');

const sharedSrc = path.resolve('..', 'shared', 'src');
const webSrc = path.resolve('src');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(webSrc, 'main.tsx')],
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  target: ['es2021'],
  platform: 'browser',
  loader: {
    '.css': 'css',
    '.module.css': 'css',
    '.svg': 'text',
    '.png': 'empty',
  },
  absWorkingDir: process.cwd(),
  alias: {
    '@': path.resolve(webSrc),
    '@shared': sharedSrc,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  treeShaking: true,
  minify: false,
});

const meta = result.metafile;
const inputs = meta.inputs;

// Calculate per-package sizes
const packageSizes = {};
const packageFiles = {};

for (const [inputPath, info] of Object.entries(inputs)) {
  let pkg = 'app-source';
  const norm = inputPath.replace(/\\/g, '/');

  const pnpmMatch = norm.match(/node_modules\/\.pnpm\/([^/]+)\/node_modules\/([^/]+)/);
  if (pnpmMatch) {
    pkg = pnpmMatch[2];
  } else {
    const hoistedMatch = norm.match(/node_modules\/(@[^/]+\/[^/]+)/);
    if (hoistedMatch) {
      pkg = hoistedMatch[1];
    } else {
      const plainMatch = norm.match(/node_modules\/([^/]+)/);
      if (plainMatch) pkg = plainMatch[1];
    }
  }

  if (!packageSizes[pkg]) { packageSizes[pkg] = 0; packageFiles[pkg] = []; }
  packageSizes[pkg] += info.bytes;
  packageFiles[pkg].push(norm);
}

const sorted = Object.entries(packageSizes)
  .sort((a, b) => b[1] - a[1]);

console.log('Top packages by bundle contribution:');
console.log('');
sorted.slice(0, 30).forEach(([pkg, bytes], i) => {
  const files = packageFiles[pkg].length;
  console.log((i+1).toString().padStart(3) + '. ' + (bytes/1024).toFixed(1).padStart(8) + ' KB  ' + pkg.padEnd(35) + ' (' + files + ' files)');
});

console.log('');
const totalBytes = Object.values(inputs).reduce((sum, info) => sum + info.bytes, 0);
console.log('Total bundle size:', (totalBytes / (1024*1024)).toFixed(2), 'MB');
console.log('Total modules:', Object.keys(inputs).length);

// Also write results to file for reference
const report = {
  totalMB: (totalBytes / (1024*1024)).toFixed(2),
  totalModules: Object.keys(inputs).length,
  topPackages: sorted.slice(0, 30).map(([pkg, bytes]) => ({
    package: pkg,
    kb: (bytes/1024).toFixed(1),
    files: packageFiles[pkg].length,
  })),
};
fs.writeFileSync('.bundle-report.json', JSON.stringify(report, null, 2));
console.log('Report written to .bundle-report.json');
