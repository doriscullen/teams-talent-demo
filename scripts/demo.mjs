// Starts and stops Teams and Talents together. Each project can still be started on its own from its directory.
//   node scripts/demo.mjs dev     build both, run in the foreground, Ctrl+C stops both
//   node scripts/demo.mjs start   build both, run in the background (logs in <project>/.runtime/server.log)
//   node scripts/demo.mjs stop    stop the background services
// Add --open to open Teams in the browser (macOS).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredProjects, projectHealth as health } from './service-projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = configuredProjects(root);
const mode = process.argv[2] ?? 'dev';
const npm = (dir, args) => spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
const url = project => `http://127.0.0.1:${project.port}${project.page}`;

function prepare(project) {
  if (!existsSync(join(project.dir, 'node_modules')) && npm(project.dir, ['ci', '--no-audit', '--no-fund']).status !== 0) process.exit(1);
  // Teams embeds the trace monitor; without its dependencies the build skips it and only that page is unavailable.
  const traceMonitor = join(project.dir, 'trace-monitor');
  if (existsSync(join(traceMonitor, 'package.json')) && !existsSync(join(traceMonitor, 'node_modules')) && npm(traceMonitor, ['ci', '--no-audit', '--no-fund']).status !== 0) console.warn('trace-monitor 依赖安装失败，「开发会话轨迹」页面不可用');
  if (npm(project.dir, ['run', 'build']).status !== 0) process.exit(1);
}
const server = (project, stdio, detached = false) => spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: project.dir, env: project.env, stdio, detached, windowsHide: true });
async function waitReady(project) {
  for (let n = 0; n < 80; n++) { if (await health(project)) return; await new Promise(done => setTimeout(done, 250)); }
  throw new Error(`${project.id} 启动未完成，请查看 ${join(project.dir, '.runtime', 'server.log')}`);
}
function open() { if (process.argv.includes('--open') && process.platform === 'darwin') spawn('open', [url(projects[0])], { stdio: 'ignore' }).unref(); }

if (mode === 'stop') {
  for (const project of projects) {
    const data = await health(project);
    if (!data) { console.log(`${project.id} 未运行`); continue; }
    process.kill(data.pid, 'SIGTERM'); console.log(`${project.id} 已停止`);
  }
} else if (mode === 'start') {
  for (const project of projects) {
    if (await health(project)) { console.log(`${project.id} 已在运行：${url(project)}`); continue; }
    prepare(project);
    mkdirSync(join(project.dir, '.runtime'), { recursive: true });
    const log = openSync(join(project.dir, '.runtime', 'server.log'), 'a');
    server(project, ['ignore', log, log], true).unref(); closeSync(log);
    await waitReady(project); console.log(`${project.id}: ${url(project)}`);
  }
  open();
} else if (mode === 'dev') {
  for (const project of projects) if (await health(project)) throw new Error(`${project.id} 已在运行，请先执行 node scripts/demo.mjs stop`);
  projects.forEach(prepare);
  const children = projects.map(project => server(project, 'inherit'));
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; for (const child of children) if (child.exitCode === null) child.kill('SIGTERM'); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  for (const child of children) child.on('exit', code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
  await Promise.all(projects.map(waitReady));
  for (const project of projects) console.log(`${project.id}: ${url(project)}`);
  open();
} else {
  console.error('用法：node scripts/demo.mjs [dev|start|stop] [--open]'); process.exit(2);
}
