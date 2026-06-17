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
  if (node.children && node.children.length > 0) return node.children.reduce((s, c) => s + sumValues(c), 0);
  if (node.uid && nodeParts[node.uid]) return nodeParts[node.uid].renderedLength || nodeParts[node.uid].gzipLength || 0;
  return 0;
}

const second = (tree.children || []).find(c => c.name && c.name.includes('index-CbyYv4_k'));
if (!second) { console.log('Second chunk not found'); process.exit(0); }

function collectLeaves(node, path, minSize) {
  const leaves = [];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childPath = path ? path + '/' + child.name : child.name;
      const childSize = sumValues(child);
      if (child.children && child.children.length > 0) leaves.push(...collectLeaves(child, childPath, minSize));
      else if (childSize > minSize) leaves.push({ name: childPath, size: childSize });
    }
  }
  return leaves;
}

const prefix = 'D:/Code/TokenDance/AgentHub/.worktrees/chatview-migration/app/';

const leaves = collectLeaves(second, '', 5120);
leaves.sort((a,b) => b.size - a.size);
console.log('=== SECOND CHUNK LEAVES >5 KB ===');
leaves.forEach((l,i) => {
  let name = l.name.replace(/\\/g, '/');
  name = name.replace(prefix, '');
  name = name.replace(/node_modules\/\.pnpm\//g, '');
  name = name.replace(/\/node_modules\//g, '/');
  console.log((i+1).toString().padStart(3) + '. ' + (l.size/1024).toFixed(1).padStart(8) + ' KB  ' + name.substring(0, 130));
});
console.log('Second chunk total: ' + (sumValues(second)/1024).toFixed(0) + ' KB');
