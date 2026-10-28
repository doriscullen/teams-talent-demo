import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { DomainError } from '../src/domain.js';
import { readSkillCatalog } from './skill-packages.js';
import { root, workspace, origin, talentOrigin } from './config.js';
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.html': 'text/html', '.txt': 'text/plain' };
export function headers(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.headers.origin === origin) {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Token, X-Demo-Request');
  }
}
export async function bodyJson(request: IncomingMessage, maxBytes = 65536) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw new DomainError('请求过大', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>; } catch { throw new DomainError('JSON 请求无效', 400); }
}
async function file(response: ServerResponse, path: string, type: string) {
  const content = await readFile(path);
  response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(content); return true;
}
async function traceMonitor(path: string, response: ServerResponse) {
  const base = resolve(root, 'dist', 'trace-monitor');
  const candidate = resolve(base, '.' + normalize(path.slice('/trace-monitor'.length)));
  if (candidate !== base && !candidate.startsWith(base + sep)) return false;
  const ext = extname(candidate);
  if (ext) { try { return await file(response, candidate, mime[ext] ?? 'application/octet-stream'); } catch { return false; } }
  try { return await file(response, join(base, 'index.html'), 'text/html'); } catch { return false; }
}
export async function staticFile(path: string, app: 'teams', response: ServerResponse) {
  if (path === '/trace-monitor' || path.startsWith('/trace-monitor/')) return traceMonitor(path, response);
  if (!['/', '/' + app, '/main.js', '/main.css', '/main.js.map', '/main.css.map'].includes(path)) return false;
  const name = path.startsWith('/main.') ? path.slice(1) : 'index.html';
  let content = await readFile(join(root, 'dist', name));
  if (name === 'index.html') {
    const runtime = JSON.stringify({ app, teamsOrigin: origin, talentOrigin }).replaceAll('<', '\\u003c');
    content = Buffer.from(content.toString().replace('<script type="module"', `<script type="application/json" id="demo-system-runtime">${runtime}</script><script type="module"`));
  }
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html';
  response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(content); return true;
}
export async function readFixtures() {
  const [presentation, baseline, teamsProject] = await Promise.all(['fixtures/presentation.json', 'teams-baseline.json', 'fixtures/teams-project.json'].map(path => readFile(join(root, path), 'utf8').then(JSON.parse)));
  const skills = presentation.skills.map((skill: { name: string }) => ({ ...skill, path: join(workspace, '.agents', 'skills', skill.name, 'SKILL.md') }));
  const catalog = await readSkillCatalog();
  return { ...presentation, ...catalog, skills, baseline, teamsProject, localPaths: { collaborationSkill: join(root, 'skills/teams-demo-collaboration/SKILL.md'), cli: join(root, 'scripts/teams-demo.mjs') } };
}
