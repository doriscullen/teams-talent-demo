#!/usr/bin/env node
// Test-only gh executable. All responses stay local; no network requests are made.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
const args = process.argv.slice(2), method = args[2], path = args[3];
const text = readFileSync(0, 'utf8'), body = text ? JSON.parse(text) : undefined;
appendFileSync(process.env.TEST_GH_LOG, JSON.stringify({ method, path, body }) + '\n');
const report = JSON.parse(readFileSync('content/trajectory/carddemo-19/report.json', 'utf8'));
const skill = report.suggestions.find(s => s.kind === 'skill');
const files = Object.fromEntries(skill.files.map(f => ['.agents/skills/' + skill.skill + '/' + f.path, f.before]));
files['AGENTS.md'] = '# Existing project rules\n';
let result = { sha: 'test-generated' };
if (path.includes('/commits/')) result = { sha: 'test-base', commit: { tree: { sha: 'test-tree' } } };
else if (method === 'GET' && path.includes('/git/trees/')) result = { tree: Object.keys(files).map(path => ({ path, sha: path })) };
else if (path.includes('/git/blobs/')) result = { content: Buffer.from(files[path.split('/git/blobs/')[1]]).toString('base64') };
else if (path.includes('/matching-refs/') || path.includes('/pulls?')) result = [];
else if (method === 'POST' && path.endsWith('/pulls')) {
  if (existsSync(process.env.TEST_GH_FAIL)) { unlinkSync(process.env.TEST_GH_FAIL); process.stderr.write('模拟提交失败，请重试'); process.exit(1); }
  result = { html_url: 'https://github.com/example/project/pull/42' };
}
process.stdout.write(JSON.stringify(result));
