#!/usr/bin/env node
// Regenerate only after intentionally updating the indexed Skill source files.
// Git blob bytes and executable modes are portable; checkout permissions are not.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile), repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = join(repo, 'teams/fixtures/skill-source-files.json');
if (process.argv.slice(2).some(arg => arg !== '--check') || process.argv.slice(2).length > 1) throw Error('Usage: node teams/scripts/generate-skill-source-manifest.mjs [--check]');
const inventory = JSON.parse(await readFile(join(repo, 'teams/fixtures/skill-inventory.json'), 'utf8'));
const packages = Object.fromEntries(inventory.map(item => [item.name, { files: [] }]));
const indexed = (await exec('git', ['-C', repo, 'ls-files', '--stage', '-z', '--', 'workspace/.agents/skills'], { maxBuffer: 2 * 1024 * 1024 })).stdout;
for (const entry of indexed.split('\0').filter(Boolean)) {
  const match = /^(100644|100755) ([0-9a-f]+) 0\tworkspace\/\.agents\/skills\/([^/]+)\/(.+)$/.exec(entry);
  if (!match || !packages[match[3]]) throw Error('Unregistered or non-regular indexed Skill file: ' + entry);
  const [, mode, object, id, path] = match;
  const bytes = (await exec('git', ['-C', repo, 'cat-file', 'blob', object], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  packages[id].files.push({ path, executable: mode === '100755', sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const [id, value] of Object.entries(packages)) {
  if (!value.files.some(file => file.path === 'SKILL.md')) throw Error('Indexed Skill body is missing: ' + id);
  value.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const content = JSON.stringify({ version: 1, sourceRoot: 'workspace/.agents/skills', packages }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== content) throw Error('Skill source declaration differs from the Git index; regenerate intentionally');
} else {
  const temporary = destination + '.' + randomUUID() + '.tmp', file = await open(temporary, 'wx', 0o644);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  try { await rename(temporary, destination); } catch (error) { await unlink(temporary); throw error; }
}
console.log(JSON.stringify({ checked: process.argv.includes('--check'), packages: inventory.length, files: Object.values(packages).reduce((count, value) => count + value.files.length, 0) }));
