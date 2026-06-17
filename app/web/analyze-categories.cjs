const fs = require('fs');
const html = fs.readFileSync('dist/stats.html', 'utf-8');
const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
const bigBlock = scriptBlocks[1].replace(/<script[^>]*>/, '').replace(/<\/script>/, '');

const dataStart = bigBlock.indexOf('const data = ');
const jsonStart = dataStart + 'const data = '.length;
let depth = 0, inString = false, jsonEnd = -1;
for (let i = jsonStart; i < bigBlock.length; i++) {
  const ch = bigBlock[i];
  if (ch === '\\' && inString) { i++; continue; }
  if (ch === '"') inString = !inString;
  if (inString) continue;
  if (ch === '{' || ch === '[') depth++;
  else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
}
const jsonStr = bigBlock.substring(jsonStart, jsonEnd);
const data = JSON.parse(jsonStr);

const nodeParts = data.nodeParts || {};
const tree = data.tree;

function sumValues(node) {
  if (node.children && node.children.length > 0) {
    return node.children.reduce((s, c) => s + sumValues(c), 0);
  }
  if (node.uid && nodeParts[node.uid]) {
    return nodeParts[node.uid].renderedLength || nodeParts[node.uid].gzipLength || 0;
  }
  return 0;
}

function collectAllLeaves(node, path, minSize) {
  const leaves = [];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childPath = path ? path + '/' + child.name : child.name;
      const childSize = sumValues(child);
      if (child.children && child.children.length > 0) {
        leaves.push(...collectAllLeaves(child, childPath, minSize));
      } else if (childSize > minSize) {
        leaves.push({ name: childPath, size: childSize });
      }
    }
  }
  return leaves;
}

const mainChunk = (tree.children || []).find(c => c.name && c.name.includes('index-C176XA6B'));
if (!mainChunk) { console.log('Main chunk not found'); process.exit(1); }

const categories = {
  '@lobehub/icons': 0,
  'react-syntax-highlighter + prismjs + refractor': 0,
  'react-markdown + unified + remark + mdast': 0,
  'chatview (components + adapter)': 0,
  'workbench pages': 0,
  'demo fixtures': 0,
  'workbench core (non-page)': 0,
  'xlsx': 0,
  'jszip': 0,
  'react-dom': 0,
  'i18n (shared)': 0,
  'transcript': 0,
  'other source': 0,
  'other node_modules': 0,
};

const allLeaves = collectAllLeaves(mainChunk, '', 1024);
allLeaves.sort((a, b) => b.size - a.size);

allLeaves.forEach(leaf => {
  const name = leaf.name;
  if (name.includes('lobehub/icons')) categories['@lobehub/icons'] += leaf.size;
  else if (name.includes('react-syntax-highlighter') || name.includes('prismjs') || name.includes('refractor') || name.includes('lowlight') || name.includes('fault')) categories['react-syntax-highlighter + prismjs + refractor'] += leaf.size;
  else if (name.includes('react-markdown') || name.includes('unified') || name.includes('remark') || name.includes('mdast')) categories['react-markdown + unified + remark + mdast'] += leaf.size;
  else if (name.includes('chatview')) categories['chatview (components + adapter)'] += leaf.size;
  else if (name.includes('transcript')) categories['transcript'] += leaf.size;
  else if (name.includes('workbench/pages/') || name.includes('workbench\\pages\\')) categories['workbench pages'] += leaf.size;
  else if (name.includes('demo/') || name.includes('demo\\')) categories['demo fixtures'] += leaf.size;
  else if (name.includes('workbench/') || name.includes('workbench\\')) categories['workbench core (non-page)'] += leaf.size;
  else if (name.includes('xlsx')) categories['xlsx'] += leaf.size;
  else if (name.includes('jszip')) categories['jszip'] += leaf.size;
  else if (name.includes('react-dom')) categories['react-dom'] += leaf.size;
  else if (name.includes('i18n')) categories['i18n (shared)'] += leaf.size;
  else if (name.includes('shared/src') || name.includes('shared\\src') || name.includes('web/src') || name.includes('web\\src')) categories['other source'] += leaf.size;
  else categories['other node_modules'] += leaf.size;
});

console.log('=== CATEGORY BREAKDOWN (main chunk, unminified, >1 KB leaves) ===\n');
for (const [cat, size] of Object.entries(categories).sort((a,b) => b[1] - a[1])) {
  console.log((size/1024).toFixed(1).padStart(10) + ' KB  ' + cat);
}

const total = allLeaves.reduce((s, l) => s + l.size, 0);
console.log('\nSum of >1KB leaves: ' + (total/1024).toFixed(0) + ' KB');
console.log('Main chunk total (all): ' + (sumValues(mainChunk)/1024).toFixed(0) + ' KB');

// Chatview detail
console.log('\n=== CHATVIEW MODULE LEAVES (in main chunk) ===');
const chatviewLeaves = allLeaves.filter(l => l.name.includes('chatview'));
chatviewLeaves.sort((a,b) => b.size - a.size);
chatviewLeaves.forEach((l, i) => {
  // Extract the relative part after 'chatview/'
  const idx = l.name.indexOf('chatview/');
  const short = idx >= 0 ? l.name.substring(idx) : l.name;
  console.log((i+1).toString().padStart(3) + '. ' + (l.size/1024).toFixed(1).padStart(8) + ' KB  ' + short);
});
const chatviewTotal = chatviewLeaves.reduce((s, l) => s + l.size, 0);
console.log('\nCHATVIEW SUBTOTAL: ' + (chatviewTotal/1024).toFixed(1) + ' KB');

// Top 15 largest leaves overall
console.log('\n=== TOP 15 LARGEST LEAVES (main chunk) ===');
allLeaves.slice(0, 15).forEach((l, i) => {
  // Shorten path for readability
  let name = l.name;
  name = name.replace(/D:\/Code\/TokenDance\/AgentHub\/\.worktrees\/chatview-migration\/app\//g, '');
  name = name.replace(/node_modules\/\.pnpm\//g, '');
  name = name.replace(/\/node_modules\//g, '/');
  console.log((i+1).toString().padStart(3) + '. ' + (l.size/1024).toFixed(1).padStart(8) + ' KB  ' + name.substring(0, 120));
});

// Second chunk analysis
const secondChunk = (tree.children || []).find(c => c.name && c.name.includes('index-CbyYv4_k'));
if (secondChunk) {
  console.log('\n=== SECOND CHUNK LEAVES >5 KB ===');
  const s2leaves = collectAllLeaves(secondChunk, '', 5120);
  s2leaves.sort((a,b) => b.size - a.size);
  s2leaves.forEach((l, i) => {
    let name = l.name;
    name = name.replace(/D:\/Code\/TokenDance\/AgentHub\/\.worktrees\/chatview-migration\/app\//g, '');
    name = name.replace(/node_modules\/\.pnpm\//g, '');
    name = name.replace(/\/node_modules\//g, '/');
    console.log((i+1).toString().padStart(3) + '. ' + (l.size/1024).toFixed(1).padStart(8) + ' KB  ' + name.substring(0, 120));
  });
  console.log('\nSecond chunk total: ' + (sumValues(secondChunk)/1024).toFixed(0) + ' KB');
}
