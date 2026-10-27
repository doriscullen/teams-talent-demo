import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, open, mkdir, link, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { CollectedSession, TaskScope } from '../src/task-automation.js';
import type { TalentTaskSessionPayload } from '../src/talent-contract.js';
import { nativeSessionRootMatches } from './native-session-location.js';

type Documents = NonNullable<TalentTaskSessionPayload['sessionDocuments']>;
interface Capture { id: string; acceptedAt: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
async function optionalJson(path: string) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function verifyDocuments(documents: Documents) {
  if (!Array.isArray(documents)) throw new Error('验收会话快照格式无效');
  for (const document of documents) if (digest(document.content) !== document.sha256 || JSON.parse(document.content)?.meta?.session_id !== document.sessionId) throw new Error('验收会话快照身份或摘要无效');
}
/** iCode 0.31 stores in-flight checkpoints in session.recovery.json and settled turns in session.json.
 * Match the native effective-envelope timestamp rule without healing, deleting, or hiding errors. */
export async function readNativeTuiEnvelope(runRoot: string, sessionId: string) {
  runRoot = await realpath(runRoot);
  const candidates: Array<{content:string;mtime:number;sourceFile:string;updatedAt:number}> = [];
  for (const sourceFile of ['session.json', 'session.recovery.json']) {
    const file = join(runRoot, 'session-root', 'sessions', sessionId.replaceAll('-', '').slice(0, 12), sourceFile);
    let path: string;
    try { path = await realpath(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!path.startsWith(join(runRoot, 'session-root') + sep)) throw new Error('会话文件超出当前运行目录');
    const value = await readStableEnvelope(path, sessionId);
    const updatedAt = Date.parse(JSON.parse(value.content).meta.updated_at);
    if (!Number.isFinite(updatedAt)) throw new Error('TUI 会话持久化时间无效，未猜测主文件或恢复记录');
    candidates.push({...value, sourceFile, updatedAt});
  }
  if (!candidates.length) throw new Error('TUI 尚未保存会话正文或运行中检查点，请稍后重试上报');
  return candidates.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
}
async function readStableEnvelope(path: string, sessionId: string) {
  const handle = await open(path, 'r'); let content: string, mtime: number;
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('原生会话文件无效或超过 8 MiB');
    content = await handle.readFile('utf8'); const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('会话正文正在更新，本次未生成快照，请重试上报');
    mtime = info.mtimeMs;
  } finally { await handle.close(); }
  if (JSON.parse(content)?.meta?.session_id !== sessionId) throw new Error('原生会话正文身份不匹配');
  return {content,mtime};
}
/** Freeze the persisted session bytes at the first accepted collection attempt. TUI lifetime is independent of task acceptance. */
export async function nativeTaskSessionDocuments(runtime: string, scope: TaskScope, sessions: CollectedSession[], capture?: Capture): Promise<Documents> {
  const runtimeRoot = await realpath(runtime), identity = digest(JSON.stringify({ scope, sessions, acceptedAt: capture?.acceptedAt }));
  if (capture && (!uuid.test(capture.id) || !Number.isFinite(Date.parse(capture.acceptedAt)))) throw new Error('验收快照标识或时间无效');
  const snapshotPath = capture ? join(runtimeRoot, 'task-session-snapshots', capture.id + '.json') : undefined;
  const saved = snapshotPath ? await optionalJson(snapshotPath) : null;
  if (saved) { if (saved.identity !== identity) throw new Error('同一验收快照不能用于不同任务、会话或验收时间'); verifyDocuments(saved.documents); return saved.documents; }
  const documents = new Map<string, { sessionId: string; sha256: string; content: string; mtime: number; kind: string; sourceFile:string }>();
  for (const session of sessions) {
    if (session.tool !== 'icode' || !session.runIds.length || !uuid.test(session.sessionId)) throw new Error('缺少可核验的原生 iCode 会话身份，未上报会话正文');
    for (const runId of session.runIds) {
      if (!uuid.test(runId)) throw new Error('原生运行标识无效');
      const runRoot = await realpath(join(runtime, 'work-contexts', runId + '.native'));
      if (runRoot !== resolve(runtimeRoot, 'work-contexts', runId + '.native')) throw new Error('原生运行目录不允许符号链接替换');
      const owner = JSON.parse(await readFile(join(runRoot, 'native-session.json'), 'utf8')), result = await optionalJson(join(runRoot, 'result.json'));
      if (owner.source !== 'icode-active-session-owner' || owner.projectId !== scope.projectId || owner.taskId !== scope.taskId || owner.runId !== runId || owner.sessionId !== session.sessionId || !await nativeSessionRootMatches(runtimeRoot, runRoot, owner, runtime)) throw new Error('原生会话范围不匹配，未上报会话正文');
      let kind = 'completed-session';
      if (owner.executionMode === 'interactive') {
        const manifest = JSON.parse(await readFile(join(runRoot, 'manifest.json'), 'utf8'));
        if (!capture || manifest.executionMode !== 'interactive' || manifest.runId !== runId || manifest.scope?.projectId !== scope.projectId || manifest.scope?.taskId !== scope.taskId || manifest.scope?.nodeId !== owner.nodeId) throw new Error('TUI 会话需要明确验收范围与固定快照标识');
        if (!result) {
          const active = await optionalJson(join(runRoot, 'session-root', 'sessions', '.locks', session.sessionId.replaceAll('-', '').slice(0, 12) + '.active.json'));
          if (!active || active.session_id !== session.sessionId || active.pid !== owner.pid || active.started_at !== owner.startedAt || !Number.isSafeInteger(owner.pid) || owner.pid < 2) throw new Error('TUI 当前会话归属无法核验，未读取快照');
          process.kill(owner.pid, 0); kind = 'live-tui-persisted-snapshot';
        } else if (result.executionMode !== 'interactive' || result.runId !== runId || result.sessionId !== session.sessionId || !['completed', 'failed'].includes(result.status)) throw new Error('TUI 退出回执身份不匹配');
        else kind = 'closed-tui-persisted-snapshot';
      } else if (!result || result.runId !== runId || result.sessionId !== session.sessionId || result.status !== 'completed') throw new Error('原生会话范围或完成回执不匹配，未上报会话正文');
      let content:string,mtime:number,sourceFile='session.json';
      if (owner.executionMode === 'interactive') ({content,mtime,sourceFile}=await readNativeTuiEnvelope(runRoot,session.sessionId));
      else {
        const path = await realpath(join(runRoot, 'session-root', 'sessions', session.sessionId.replaceAll('-', '').slice(0, 12), sourceFile));
        if (!path.startsWith(join(runRoot, 'session-root') + sep)) throw new Error('会话文件超出当前运行目录');
        ({content,mtime}=await readStableEnvelope(path,session.sessionId));
      }
      const current = documents.get(session.sessionId); if (!current || mtime > current.mtime) documents.set(session.sessionId, { sessionId: session.sessionId, sha256: digest(content), content, mtime, kind, sourceFile });
    }
  }
  const result = [...documents.values()].map(({ mtime, kind, sourceFile, ...document }) => document);
  if (snapshotPath) {
    await mkdir(join(runtimeRoot, 'task-session-snapshots'), { recursive: true });
    const temp = snapshotPath + '.' + randomUUID() + '.tmp', handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ identity, ...scope, captureId: capture!.id, acceptedAt: capture!.acceptedAt, capturedAt: new Date().toISOString(), sources: [...documents.values()].map(({ content, mtime, ...source }) => source), documents: result }, null, 2)); await handle.sync(); } finally { await handle.close(); }
    // Publish without replacement: concurrent retry must reuse the first fixed bytes.
    try { await link(temp, snapshotPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } finally { await unlink(temp); }
    const pinned = await optionalJson(snapshotPath); if (pinned.identity !== identity) throw new Error('验收会话快照范围冲突'); verifyDocuments(pinned.documents); return pinned.documents;
  }
  return result;
}
