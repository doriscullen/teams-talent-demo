/** Manual, explicit runtime relocation. No service startup or business-state write. */
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { nativeSessionMigrationFile, nativeSessionRootMatches, type NativeSessionLocationMigration } from '../server/native-session-location.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--runtime', '--previous-runtime', '--runs', '--apply'].includes(key) || !value || args.has(key)) throw new Error('参数：--runtime ABS --previous-runtime ABS --runs UUID,UUID [--apply yes]；默认只预检');
  args.set(key, value);
}
const runtime = args.get('--runtime'), previous = args.get('--previous-runtime'), runs = args.get('--runs')?.split(',');
if (!runtime || !previous || !isAbsolute(runtime) || !isAbsolute(previous) || resolve(previous) !== previous || !runs?.length || new Set(runs).size !== runs.length || runs.some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) || (args.has('--apply') && args.get('--apply') !== 'yes')) throw new Error('必须显式给出当前/原 runtime 绝对路径和唯一 run UUID 清单');
const root = await realpath(runtime), file = join(root, nativeSessionMigrationFile);
if (root !== resolve(runtime) || root === previous) throw new Error('当前 runtime 必须是未经过符号链接的新目录');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let existing: { version: number; entries: NativeSessionLocationMigration[] } = { version: 1, entries: [] }, original: Buffer | null = null;
try { if (await realpath(file) !== file) throw new Error('迁移文件不能是符号链接'); original = await readFile(file); existing = JSON.parse(original.toString('utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (existing.version !== 1 || !Array.isArray(existing.entries)) throw new Error('已有迁移文件格式无效');
const entries = [...existing.entries], noPersistedDocumentRuns: string[] = [];
for (const runId of runs) {
  const runRoot = join(root, 'work-contexts', runId + '.native');
  const ownerPath = join(runRoot, 'native-session.json'), manifestPath = join(runRoot, 'manifest.json');
  for (const path of [runRoot, ownerPath, manifestPath, join(runRoot, 'session-root')]) if (await realpath(path) !== path) throw new Error('迁移来源目录或文件不允许符号链接');
  const ownerBytes = await readFile(ownerPath), manifestBytes = await readFile(manifestPath), owner = JSON.parse(ownerBytes.toString('utf8')), manifest = JSON.parse(manifestBytes.toString('utf8'));
  const oldRoot = join(previous, 'work-contexts', runId + '.native', 'session-root');
  if (owner.runId !== runId || owner.source !== 'icode-active-session-owner' || owner.sessionRoot !== oldRoot || manifest.runId !== runId || ['projectId', 'taskId', 'nodeId'].some(key => manifest.scope?.[key] !== owner[key]) || manifest.taskFile !== join(previous, 'work-contexts', runId + '.md')) throw new Error('run/scope 或原路径不匹配：' + runId);
  const taskFile = join(root, 'work-contexts', runId + '.md');
  if (await realpath(taskFile) !== taskFile || sha(await readFile(taskFile)) !== manifest.taskSha256) throw new Error('原任务文件 hash 不匹配：' + runId);
  const sessionDir = join(runRoot, 'session-root', 'sessions', String(owner.sessionId).replaceAll('-', '').slice(0, 12));
  let documents = 0;
  for (const name of ['session.json', 'session.recovery.json']) {
    const path = join(sessionDir, name);
    try { if (await realpath(path) !== path || !(await stat(path)).isFile() || JSON.parse(await readFile(path, 'utf8')).meta?.session_id !== owner.sessionId) throw new Error('原会话身份不匹配：' + runId); documents++; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!documents) noPersistedDocumentRuns.push(runId);
  const entry: NativeSessionLocationMigration = { runId, projectId: owner.projectId, taskId: owner.taskId, nodeId: owner.nodeId, sessionId: owner.sessionId, previousSessionRoot: oldRoot, sessionRoot: join(runRoot, 'session-root'), ownerSha256: sha(ownerBytes), manifestSha256: sha(manifestBytes) };
  const old = entries.find(value => value.runId === runId);
  if (old && JSON.stringify(old) !== JSON.stringify(entry)) throw new Error('已有迁移范围不一致：' + runId);
  if (!old) entries.push(entry);
}
if (args.get('--apply') === 'yes') {
  const content = JSON.stringify({ version: 1, entries }, null, 2) + '\n';
  if (original && original.toString('utf8') !== content) { const backup = await open(file + '.' + randomUUID() + '.backup', 'wx', 0o600); try { await backup.writeFile(original); await backup.sync(); } finally { await backup.close(); } }
  if (original?.toString('utf8') !== content) {
    const temp = file + '.' + randomUUID() + '.tmp', handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temp, file); } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  for (const runId of runs) { const runRoot = join(root, 'work-contexts', runId + '.native'); if (!await nativeSessionRootMatches(root, runRoot, JSON.parse(await readFile(join(runRoot, 'native-session.json'), 'utf8')))) throw new Error('迁移核验失败'); }
}
console.log(JSON.stringify({ applied: args.get('--apply') === 'yes', file, runs, entries: entries.length, noPersistedDocumentRuns, originalEvidenceRewritten: false }));
