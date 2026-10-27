/** One explicit schedule patch. Stop the owning Teams service before applying. */
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { approvedRequirementSchedule, planRequirementSchedule } from '../src/requirement-schedule.js';
import type { DemoState } from '../src/domain.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--state', '--apply', '--expect-revision', '--expect-sha256', '--service-stopped'].includes(key) || !value || args.has(key)) throw new Error('用法：--state ABS [--apply yes --expect-revision N --expect-sha256 SHA256 --service-stopped yes]；默认仅预检');
  args.set(key, value);
}
const requested = args.get('--state');
if (!requested || !isAbsolute(requested) || (args.has('--apply') && args.get('--apply') !== 'yes')) throw new Error('请明确状态文件绝对路径；--apply 只能为 yes');
const path = await realpath(requested);
if (path !== resolve(requested)) throw new Error('状态文件路径不能经过符号链接');
const original = await readFile(path), sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const state = JSON.parse(original.toString('utf8')) as DemoState;
if (state.schemaVersion !== 2 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.workspace?.deliveryRequirements)) throw new Error('状态文件格式无效');
const plan = planRequirementSchedule(state), apply = args.get('--apply') === 'yes';
let backup: string | undefined;
if (apply) {
  if (args.get('--service-stopped') !== 'yes' || args.get('--expect-revision') !== String(state.revision) || args.get('--expect-sha256') !== sha(original)) throw new Error('应用必须确认服务已停止，并匹配最新预检的 revision 和 SHA256');
  let pid: number | undefined;
  try { const text = (await readFile(join(dirname(path), 'server.pid'), 'utf8')).trim(); if (!/^\d+$/.test(text) || Number(text) < 2) throw new Error('服务 PID 文件无效'); pid = Number(text); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (pid !== undefined) {
    let running = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; running = false; }
    if (running) throw new Error('Teams 进程仍在运行，未修改状态');
  }
  if (plan.changes.length) {
    backup = path + '.pre-schedule-' + randomUUID() + '.json';
    const saved = await open(backup, 'wx', 0o600);
    try { await saved.writeFile(original); await saved.sync(); } finally { await saved.close(); }
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(plan.state, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
      if (sha(await readFile(path)) !== sha(original)) throw new Error('状态已在预检后改变；未覆盖');
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
console.log(JSON.stringify({ applied: apply, file: path, revision: state.revision, sha256: sha(original), changes: plan.changes, preserved: plan.preserved, sourceSchedules: Object.entries(approvedRequirementSchedule).filter(([, value]) => value.storage === 'requirements-plugin').map(([id, value]) => ({ id, plannedEnd: value.due })), backup, revisionUnchanged: true }, null, 2));
