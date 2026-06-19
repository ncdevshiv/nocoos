#!/usr/bin/env node
// Lint all .js files in os/src and os/public using the kernel parser.
// Catches syntax errors before they hit the browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const parser = (await import('../os/src/kernel/parser.js')).default;

const ROOTS = [
  path.join(ROOT, 'os', 'src'),
  path.join(ROOT, 'os', 'public', 'js')
];

let totalChecked = 0;
let totalFailed = 0;
const failed = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && (full.endsWith('.js') || full.endsWith('.mjs'))) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap(walk);

for (const file of files) {
  totalChecked++;
  const result = await parser.validateFile(file);
  if (!result.ok) {
    totalFailed++;
    failed.push({ file, error: result.error });
  }
}

console.log(`Checked ${totalChecked} files.`);
if (totalFailed) {
  console.error(`\n${totalFailed} file(s) have syntax errors:\n`);
  for (const f of failed) {
    const rel = path.relative(ROOT, f.file);
    const loc = f.error.line ? `:${f.error.line}${f.error.column ? ':' + f.error.column : ''}` : '';
    console.error(`  ${rel}${loc}`);
    console.error(`    ${f.error.message}\n`);
  }
  process.exit(1);
}
console.log('All files OK.');
