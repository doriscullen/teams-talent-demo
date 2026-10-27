import { projectSessionTurns } from './task-session-turns.js';
import { nativeSessionRootMatches } from './native-session-location.js';
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { DomainError, type DemoState, type Role } from '../src/domain.js';
import { deliveryRequirement, type RequirementNode } from '../src/delivery-requirements.js';
import { projectMembers } from '../src/teams-domain.js';
import { taskVisibleTo } from '../src/task-visibility.js';
import type { TaskSessionTurn, TaskSessionStreamQuery, TaskSessionStreamResponse, TaskSessionSummary } from '../src/task-session-stream.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const nodes = new Set(['prepare', 'develop', 'verify', 'accept']);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
type Json = Record<string, any>;
type Binding = TaskSessionSummary & { runs: Map<string, Json>; points: Array<{ at: string; nodeId: RequirementNode; runId?: string }> };
type Cache = { epoch: string; touched: number; events: Map<string, TaskSessionTurn>; journal: Array<{ sequence: number; event: TaskSessionTurn }>; sequence: number };

/** Fixed trusted paths only. ENOENT is the expected not-yet-written runtime state. */
async function readBounded(root: string, path: string, max: number): Promise<string | null> {
  let actual: string;
  try { actual = await realpath(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new DomainError('会话文件不可读取', 503); }
  if (actual !== resolve(path) || !actual.startsWith(root + sep)) throw new DomainError('会话文件路径校验失败', 409);
  const handle = await open(actual, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) throw new DomainError('会话文件超过可读取范围', 413);
    // Read only the measured prefix. An active JSONL writer may append meanwhile.
    const buffer = Buffer.alloc(stat.size); let read = 0;
    while (read < buffer.length) { const result = await handle.read(buffer, read, buffer.length - read, read); if (!result.bytesRead) break; read += result.bytesRead; }
    return buffer.subarray(0, read).toString('utf8');
  } finally { await handle.close(); }
}
async function readJson(root: string, path: string, max = 64 * 1024): Promise<Json | null> {
  const text = await readBounded(root, path, max); if (text === null) return null;
  try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new DomainError('会话记录格式无效，未使用替代内容', 409); }
}

/** Only visible natural-language text is eligible. No reasoning, arguments, tool output or environment is projected. */
export function visibleSessionText(value: string): string {
  return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[已隐藏凭据]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, '[已隐藏凭据]')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/g, '[已隐藏凭据]')
    .replace(/(?:["']?[\w-]*(?:token|secret|password|api[_-]?key|authorization|cookie)[\w-]*["']?)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '[已隐藏凭据]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/g, '[已隐藏含凭据地址]')
    .replace(/(?:\/(?:Users|home)\/[^\s"'<>]+|[A-Z]:\\(?:Users\\)?[^\s"'<>]+)/gi, '[本机路径]')
    .replace(/\b[A-Za-z0-9_+/=-]{100,}\b/g, '[已省略长编码内容]');
}
function nodeAt(binding: Binding, runId: string, at: string): RequirementNode {
  const points = binding.points.filter(point => (!point.runId || point.runId === runId) && Date.parse(point.at) <= Date.parse(at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return points.at(-1)?.nodeId ?? binding.runs.get(runId)!.nodeId;
}
function cursorValue(value: string, key: string) {
  if (value.length > 1000) throw new DomainError('会话游标无效', 400);
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.key !== key || !uuid.test(parsed.epoch) || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0) throw new Error();
    return parsed as { key: string; epoch: string; sequence: number };
  } catch { throw new DomainError('会话游标与当前任务、节点或身份不匹配', 400); }
}

/** A read-only observer. The cache contains presentation deltas, never business progress. */
export function createTaskSessionStream(runtime: string, options: { isAlive?: (pid: number) => boolean } = {}) {
  const caches = new Map<string, Cache>();
  const isAlive = options.isAlive ?? ((pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new DomainError('无法核验原生会话进程', 503); } });
  return async (state: DemoState, role: Role, query: TaskSessionStreamQuery): Promise<TaskSessionStreamResponse> => {
    if (role !== 'owner' && role !== 'member') throw new DomainError('角色无效', 400);
    if (typeof query.projectId !== 'string' || typeof query.taskId !== 'string' || !nodes.has(query.nodeId)) throw new DomainError('需要明确项目、任务和节点', 400);
    const task = deliveryRequirement(state, query.projectId, query.taskId);
    if (!task) throw new DomainError('当前任务没有可读取的本地交付会话', 404);
    if (!taskVisibleTo(role, task.assigneeId) || !projectMembers(state, query.projectId).some(member => member.id === role && member.status === 'active')) throw new DomainError('无权读取当前任务会话', 403);
    const scopeMatches = (value: Json) => value.projectId === query.projectId && value.taskId === query.taskId;
    const bindings = new Map<string, Binding>();
    const bind = (id: string, tool: 'icode' | 'opencode', nodeId: string, at: string, runId?: string) => {
      if (!id || !nodes.has(nodeId)) return;
      let binding = bindings.get(id);
      if (!binding) { binding = { id, tool, title: 'iCode 会话', nodeIds: [], runIds: [], status: 'unavailable', lastAt: timestamp(at), runs: new Map(), points: [] }; bindings.set(id, binding); }
      if (binding.tool !== tool) throw new DomainError('关联会话工具身份不一致', 409);
      if (!binding.nodeIds.includes(nodeId)) binding.nodeIds.push(nodeId);
      if (runId && uuid.test(runId) && !binding.runIds.includes(runId)) binding.runIds.push(runId);
      if (timestamp(at)) { binding.points.push({ at, nodeId: nodeId as RequirementNode, runId }); if (!binding.lastAt || Date.parse(at) > Date.parse(binding.lastAt)) binding.lastAt = at; }
    };
    for (const record of [...state.workspace.collaboration?.adoptions ?? [], ...state.workspace.collaboration?.events ?? []]) if (scopeMatches(record) && record.sessionId) bind(record.sessionId, 'icode', record.nodeId ?? '', record.at, record.runId);
    for (const record of state.workspace.taskAutomation ?? []) if (scopeMatches(record)) for (const link of record.sessions) bind(link.sessionId, link.tool, link.nodeId, link.at);

    let root: string | null = null;
    try { root = await realpath(runtime); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError('无法读取会话运行目录', 503); }
    if (root) {
      let names: string[] = [];
      try { names = await readdir(join(root, 'work-contexts')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError('无法读取原生会话索引', 503); }
      names = names.filter(name => uuid.test(name.replace(/\.native$/, '')) && name.endsWith('.native'));
      if (names.length > 1000) throw new DomainError('原生运行记录超过本次读取上限', 413);
      for (const name of names) {
        const runRoot = join(root, 'work-contexts', name), owner = await readJson(root, join(runRoot, 'native-session.json'));
        if (!owner || !scopeMatches(owner)) continue;
        const runId = name.slice(0, -7), manifest = await readJson(root, join(runRoot, 'manifest.json'));
        if (!uuid.test(owner.sessionId) || owner.runId !== runId || owner.source !== 'icode-active-session-owner' || !nodes.has(owner.nodeId) || !timestamp(owner.startedAt) || !await nativeSessionRootMatches(root, runRoot, owner, runtime) || !manifest || manifest.runId !== runId || !scopeMatches(manifest.scope ?? {}) || manifest.scope.nodeId !== owner.nodeId) throw new DomainError('原生会话与任务绑定校验失败', 409);
        bind(owner.sessionId, 'icode', owner.nodeId, owner.startedAt, runId);
        bindings.get(owner.sessionId)!.runs.set(runId, { ...owner, ...(manifest.preparedSession ? {preparedSession:manifest.preparedSession} : {}), sessionRoot: join(runRoot, 'session-root') });
      }
    }
    for (const binding of bindings.values()) {
      if (!binding.runs.size) { binding.note = '没有当前 Teams 启动记录可核验的原生会话文件'; continue; }
      const results: Array<{ status: TaskSessionSummary['status']; at: string; note?: string }> = [];
      for (const [runId, owner] of binding.runs) {
        const result = await readJson(root!, join(root!, 'work-contexts', runId + '.native', 'result.json'));
        if (result) {
          if (result.runId !== runId || result.sessionId !== binding.id || !scopeMatches(result) || !['completed', 'failed'].includes(result.status) || !timestamp(result.finishedAt)) throw new DomainError('原生执行回执身份或状态不匹配', 409);
          results.push({ status: result.status, at: result.finishedAt, note: result.status === 'failed' ? '原生执行失败，请检查本机运行记录' : undefined });
        } else {
          if (!Number.isSafeInteger(owner.pid) || owner.pid < 2) throw new DomainError('原生进程身份无效', 409);
          const active = await readJson(root!, join(owner.sessionRoot, 'sessions', '.locks', binding.id.replaceAll('-', '').slice(0, 12) + '.active.json'));
          if (active && (active.session_id !== binding.id || active.pid !== owner.pid || active.started_at !== owner.startedAt)) throw new DomainError('原生进程当前归属与会话记录不匹配', 409);
          const alive = !!active && isAlive(owner.pid);
          results.push({ status: alive ? 'running' : 'unknown', at: owner.startedAt, note: alive ? undefined : '未发现当前会话的活动进程，且尚无完成回执；未判定成功' });
        }
      }
      const latest = results.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      binding.status = results.some(result => result.status === 'running') ? 'running' : latest.status;
      binding.note = latest.note;
      if (!binding.lastAt || Date.parse(latest.at) > Date.parse(binding.lastAt)) binding.lastAt = latest.at;
      binding.title = `${binding.tool === 'icode' ? 'iCode' : 'OpenCode'} · ${binding.id.slice(0, 8)}`;
    }
    const visible = [...bindings.values()].filter(binding => binding.nodeIds.includes(query.nodeId)).sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || Date.parse(b.lastAt ?? '') - Date.parse(a.lastAt ?? ''));
    const selected = query.sessionId ? visible.find(binding => binding.id === query.sessionId) : visible[0];
    if (query.sessionId && !selected) throw new DomainError('会话不属于当前任务节点', 404);
    const summaries = visible.map(({ runs, points, ...summary }) => summary);
    const base = { sessions: summaries, selectedSessionId: selected?.id ?? null, observedAt: new Date().toISOString(), pollAfterMs: 2000, note: '按原生对话轮次展示用户输入和模型可见回复；敏感凭据已隐藏。' };
    if (!selected) return { ...base, turns: [], cursor: null, reset: true, hasMore: false };
    const key = hash(JSON.stringify([role, query.projectId, query.taskId, query.nodeId, selected.id]));
    const cursor = query.cursor ? cursorValue(query.cursor, key) : null;
    const turns: TaskSessionTurn[] = [];
    for (const [runId, owner] of selected.runs) {
      const sessionDir = join(owner.sessionRoot, 'sessions', selected.id.replaceAll('-', '').slice(0, 12));
      // Native iCode persists active checkpoints separately from settled turns.
      // Read both trusted files and select by native metadata; never hide a corrupt candidate.
      const primary = await readJson(root!, join(sessionDir, 'session.json'), 8 * 1024 * 1024);
      const recovery = await readJson(root!, join(sessionDir, 'session.recovery.json'), 8 * 1024 * 1024);
      for (const candidate of [primary, recovery]) if (candidate && (candidate.meta?.session_id !== selected.id || !Array.isArray(candidate.state?.messages))) throw new DomainError('原生会话正文身份或结构不匹配', 409);
      if (recovery && (!timestamp(recovery.meta.updated_at) || primary && !timestamp(primary.meta.updated_at))) throw new DomainError('原生会话持久化时间无效，未猜测应读取的版本', 409);
      const document = recovery && (!primary || Date.parse(recovery.meta.updated_at) > Date.parse(primary.meta.updated_at)) ? recovery : primary;
      const trajectory = await readBounded(root!, join(sessionDir, 'trajectory', 'events.jsonl'), 16 * 1024 * 1024);
      const rows: Json[] = [];
      if (trajectory !== null) {
        const lines = trajectory.split('\n'), terminated = lines.at(-1) === '';
        if (terminated) lines.pop();
        for (const [index, line] of lines.entries()) {
          let row: Json;
          try { row = JSON.parse(line); } catch {
            // Only a currently running writer may have an incomplete trailing JSON line.
            if (!terminated && index === lines.length - 1 && selected.status === 'running') break;
            throw new DomainError('原生轨迹记录损坏，未跳过错误记录', 409);
          }
          if (row.session_id !== selected.id || typeof row.event_id !== 'string' || !timestamp(row.occurred_at)) throw new DomainError('原生轨迹身份或时间无效', 409);
          rows.push(row);
        }
      }
      const projected=projectSessionTurns({ document, rows, sessionId: selected.id, runId, nodeId: query.nodeId, status: selected.status, nodeAt: at => nodeAt(selected, runId, at), points: selected.points.filter(point => !point.runId || point.runId === runId), clean: visibleSessionText });
      // Resume carries the native conversation intact. Older turns remain attached
      // to their original run/node, rather than appearing again at the new node.
      turns.push(...projected.filter(turn=>!owner.preparedSession||Date.parse(turn.startedAt)>=Date.parse(owner.startedAt)));
      if (trajectory === null && document === null) { selected.note = selected.status === 'running' ? '会话已关联，等待原生进程保存对话正文' : '运行已有记录，但未记录可读取的对话正文'; const summary = summaries.find(item => item.id === selected.id); if (summary) summary.note = selected.note; }
    }
    if (turns.length > 20000) throw new DomainError('当前节点对话轮次超过读取上限', 413);
    const current = new Map(turns.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id)).map(turn => [turn.id, turn]));
    let cache = caches.get(key), reset = !cursor || !cache || cache.epoch !== cursor.epoch;
    if (cache && [...cache.events.keys()].some(id => !current.has(id))) { cache = undefined; reset = true; }
    if (!cache) cache = { epoch: randomUUID(), touched: Date.now(), events: new Map(), journal: [], sequence: 0 };
    cache.touched = Date.now();
    for (const [id, event] of current) if (JSON.stringify(cache.events.get(id)) !== JSON.stringify(event)) { cache.events.set(id, event); cache.journal.push({ sequence: ++cache.sequence, event }); }
    if (cache.journal.length > 25000) { cache.epoch = randomUUID(); cache.sequence = 0; cache.journal = [...cache.events.values()].map(event => ({ sequence: ++cache!.sequence, event })); reset = true; }
    caches.delete(key); caches.set(key, cache); while (caches.size > 32) caches.delete(caches.keys().next().value!);
    const offset = reset ? 0 : cursor!.sequence;
    if (offset > cache.sequence) throw new DomainError('会话游标超出当前可见范围', 400);
    const batch = cache.journal.filter(item => item.sequence > offset && (!reset || cache!.events.get(item.event.id) === item.event)).slice(0, 120);
    const sequence = batch.at(-1)?.sequence ?? offset;
    return { ...base, turns: batch.map(item => item.event), reset, hasMore: sequence < cache.sequence, cursor: Buffer.from(JSON.stringify({ key, epoch: cache.epoch, sequence })).toString('base64url') };
  };
}
