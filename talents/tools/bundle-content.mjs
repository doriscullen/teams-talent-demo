// Bundles content/ into src/generated/content.json; the page imports it to preview artifact text without extra requests.
// Files over SERVED_BYTES (e.g. a trajectory diagnosis report) are left out; the service serves them (GET /api/content).
// Usage: node tools/bundle-content.mjs (run by npm run build and npm run typecheck)
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(root, 'content');
const outFile = join(root, 'src', 'generated', 'content.json');
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.py', '.yaml', '.yml', '.json', '.html']);
const MAX_BYTES = 1.5 * 1024 * 1024;
const SERVED_BYTES = 1024 * 1024;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === '__pycache__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TEXT_EXTENSIONS.has(extname(name).toLowerCase()) && statSync(full).size <= SERVED_BYTES) out.push(full);
  }
  return out;
}

const toKey = path => relative(contentDir, path).split(sep).join('/').normalize('NFC');
const readText = path => readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

function build(includeFile) {
  const files = {};
  const trees = {};
  for (const path of walk(contentDir)) {
    const key = toKey(path);
    const skill = key.match(/^(skills\/[^/]+)\/(.+)$/);
    if (skill && !includeFile(skill[2])) continue;
    files[key] = readText(path);
    if (skill) (trees[skill[1]] ??= []).push(skill[2]);
  }
  for (const list of Object.values(trees)) list.sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)));
  return JSON.stringify({ files, trees });
}

// Full skills first; if too large, keep SKILL.md plus first-level text files only.
let output = build(() => true);
if (Buffer.byteLength(output) > MAX_BYTES) output = build(file => !file.includes('/'));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, output);
console.log(`wrote ${relative(root, outFile)} (${Buffer.byteLength(output)} bytes)`);
