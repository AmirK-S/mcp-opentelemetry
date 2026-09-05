// Fails when a published text file contains an em dash or an en dash.
// These characters are banned from everything this repository publishes.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['README.md', 'CHANGELOG.md', 'src', 'test', 'examples', 'docs'];
const banned = /[–—]/;
const offenders = [];

function walk(path) {
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry));
    return;
  }
  if (!/\.(md|ts|mts|js|mjs|json|yml|yaml)$/.test(path)) return;
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => { if (banned.test(line)) offenders.push(`${path}:${i + 1}`); });
}

for (const root of roots) walk(root);
if (offenders.length > 0) {
  console.error('Em dash or en dash found in:\n' + offenders.join('\n'));
  process.exit(1);
}
console.log('typography: ok');
