// iCode Talents demo service: serves the static front-end at /talents, keeps Talents-owned state,
// reads Teams data from the shared data directory and publishes knowledge back to it.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { root, port, origin, teamsOrigin, runtimeDir, sharedDir, publicDir, localConfiguration } from './config.ts';
import { Store } from './store.ts';
import { HttpError } from './model.ts';
import { clientState, ownedState, readSkill, readTeamsData } from './teams-data.ts';
import { KnowledgeExporter } from './export.ts';
import { readContent } from './content.ts';
import { codegraphSnapshot, withCodegraph } from './codegraph.ts';
import { submitPullRequest } from './pull-requests.ts';

const store = new Store(); await store.init();
const submissions = new Set<string>();
const exporter = new KnowledgeExporter(sharedDir);
await exporter.export(store.state, true);
const exportKnowledge = () => exporter.export(store.state).catch(error => console.error('Talents 知识导出失败：' + error.message));

async function bootstrap() {
  const teams = await readTeamsData();
  return {
    revision: store.state.revision,
    state: clientState(withCodegraph(store.state), teams.snapshot),
    teams: { origin: teamsOrigin, from: teams.from, exportedAt: teams.snapshot.exportedAt },
  };
}

async function bodyJson(request: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new HttpError('请求过大', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>; } catch { throw new HttpError('JSON 请求无效', 400); }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function staticFile(path: string, response: ServerResponse) {
  const relative = normalize(decodeURIComponent(path.slice('/talents/'.length)) || 'index.html');
  if (relative.startsWith('..') || relative.includes('\0')) return false;
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir + sep)) return false;
  let content: Buffer;
  try { content = await readFile(file); }
  catch (error) { if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
  response.writeHead(200, { 'Content-Type': (TYPES[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
  response.end(content); return true;
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const json = (code: number, value: unknown) => {
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value));
  };
  try {
    if (request.headers.host !== '127.0.0.1:' + port) { json(403, { error: '请使用本机 127.0.0.1 地址' }); return; }
    const url = new URL(request.url ?? '/', origin), path = url.pathname, method = request.method ?? 'GET';
    if (path.startsWith('/api/')) {
      if (method !== 'GET') {
        if (request.headers.origin && request.headers.origin !== origin) { json(403, { error: '请求来源不匹配' }); return; }
        if (!request.headers['content-type']?.startsWith('application/json')) { json(415, { error: '请使用 JSON 请求' }); return; }
      }
      if (method === 'GET' && path === '/api/health') { json(200, { app: 'talents-carddemo', service: 'talents', workspaceRoot: root, stateRoot: runtimeDir, sharedDir, version: '0.1.0', pid: process.pid, origin, teamsOrigin }); return; }
      if (method === 'GET' && path === '/api/bootstrap') { json(200, await bootstrap()); return; }
      // Content files too large to bundle into the page, e.g. a trajectory diagnosis report (see tools/bundle-content.mjs).
      if (method === 'GET' && path === '/api/content') {
        const key = url.searchParams.get('key') ?? '', text = readContent(key);
        if (text == null) throw new HttpError('内容不存在', 404);
        response.writeHead(200, { 'Content-Type': (TYPES[extname(key)] ?? 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(text); return;
      }
      if (method === 'GET' && path === '/api/skill') { json(200, await readSkill((await readTeamsData()).snapshot, url.searchParams.get('project') ?? '', url.searchParams.get('id') ?? '')); return; }
      if (method === 'GET' && path === '/api/codegraph/carddemo') {
        const { sources, ...graph } = codegraphSnapshot();
        json(200, graph); return;
      }
      if (method === 'GET' && path === '/api/codegraph/carddemo/source') {
        const graph = codegraphSnapshot();
        if (url.searchParams.get('snapshot') !== graph.metadata.snapshotId) throw new HttpError('图谱已更新，请刷新后重试', 409);
        const node = graph.nodes.find(n => n.id === url.searchParams.get('id'));
        if (!node) throw new HttpError('符号不存在', 404);
        const source = graph.sources[node.filePath];
        if (source === undefined) throw new HttpError('快照中没有此源码', 404);
        const start = Math.max(1, node.startLine - 3), end = Math.min(source.split('\n').length, node.endLine + 3, start + 299);
        json(200, { filePath: node.filePath, startLine: start, endLine: end, content: source.split('\n').slice(start - 1, end).join('\n') }); return;
      }
      if (method === 'PUT' && path === '/api/state') {
        const body = await bodyJson(request);
        if (!Number.isInteger(body.revision)) throw new HttpError('缺少 revision', 400);
        const state = await store.mutate(body.revision, previous => ownedState(body.state, previous));
        await exportKnowledge();
        json(200, { revision: state.revision }); return;
      }
      if (method === 'POST' && path === '/api/reset') {
        await store.reset();
        await exportKnowledge();
        json(200, await bootstrap()); return;
      }
      if (method === 'POST' && path === '/api/pull-requests') {
        const body = await bodyJson(request);
        const key = body.artifactId + '/' + (body.suggestionId ?? '');
        if (submissions.has(key)) throw new HttpError('正在提交，请稍候', 409);
        const artifact = store.state.artifacts.find(a => a.id === body.artifactId);
        if (!artifact) throw new HttpError('产物不存在', 404);
        const existing = body.suggestionId ? artifact.suggestions?.find(s => s.id === body.suggestionId)?.submission : !artifact.draft && artifact.submission;
        if (existing) { json(200, await bootstrap()); return; }
        submissions.add(key);
        try {
          const submitted = await submitPullRequest(structuredClone(artifact), { repository: body.repository, base: body.base, note: body.note, skillDirectory: body.skillDirectory }, body.suggestionId);
          await store.mutate(null, previous => {
            const next = structuredClone(previous), a = next.artifacts.find(a => a.id === body.artifactId)!;
            if (body.suggestionId) {
              a.suggestions = [...(a.suggestions ?? []).filter(s => s.id !== body.suggestionId), { id: body.suggestionId, status: 'submitted', submission: submitted, at: submitted.at }];
            } else {
              a.submission = submitted;
              a.published = { version: submitted.version, at: submitted.at, note: body.note, delivery: 'local', files: a.files, specs: a.specs,
                over: Object.fromEntries((a.files ?? []).map((key, i) => [key, { text: submitted.files[i].text }])), basis: a.draft?.basis as any };
              a.draft = null;
            }
            return next;
          });
          json(200, await bootstrap());
        } finally { submissions.delete(key); }
        return;
      }
      throw new HttpError('接口不存在', 404);
    }
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError('不支持的请求', 405);
    // Relative asset URLs in index.html need the trailing slash; the hash (#/page?project=…) survives the redirect.
    if (path === '/' || path === '/talent' || path === '/talents') { response.writeHead(302, { Location: '/talents/' + url.search }); response.end(); return; }
    if (path.startsWith('/talents/') && await staticFile(path, response)) return;
    json(404, { error: '页面不存在' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    json(status, { error: error instanceof Error ? error.message : '请求失败' });
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  if (localConfiguration.loaded) console.log('本机配置：' + localConfiguration.file);
  console.log('Talents: ' + origin + '/talents');
  console.log('共享数据目录：' + sharedDir);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.close(() => process.exit(0)); });
