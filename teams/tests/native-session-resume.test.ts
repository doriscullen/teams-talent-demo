import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { queueTaskPreparation, taskAutomation } from '../src/task-automation.js';
import { ProjectWorkService, type WorkTransport } from '../server/project-work.js';
import { readFixtures } from '../server/http-shared.js';
import { codeRoot } from '../server/config.js';
import { nativeProcessActive } from '../scripts/native/session-liveness.mjs';
import { focusWorkTerminal } from '../server/terminal-focus.js';
// @ts-ignore the TUI bridge also runs directly under Node.
import { copyPreparedSession } from '../scripts/native/run-project-tui.mjs';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('native liveness distinguishes exited/zombie/reused PID and rejects an older unrelated owner', async () => {
  const owner = { pid: 42, startedAt: '2026-10-27T12:00:02Z' }, record = { pid: 42, startedAt: '2026-10-27T12:00:00Z' };
  assert.equal(await nativeProcessActive(owner, record, async () => null), false);
  assert.equal(await nativeProcessActive(owner, record, async () => ({ state: 'Z', startedAt: record.startedAt })), false);
  assert.equal(await nativeProcessActive(owner, record, async () => ({ state: 'S', startedAt: '2026-10-27T12:05:00Z' })), false);
  assert.equal(await nativeProcessActive(owner, record, async () => ({ state: 'S', startedAt: record.startedAt })), true);
  await assert.rejects(nativeProcessActive(owner, record, async () => ({ state: 'S', startedAt: '2026-10-27T11:00:00Z' })), /归属/);
  await assert.rejects(nativeProcessActive(owner, record, async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); }), /denied/);
});

test('prepared TUI focuses a live exact terminal, then restores latest saved dialogue after abnormal window close', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'session-resume-'))), state = initialState(), fixtures = await readFixtures();
  const scope = { projectId: 'carddemo', taskId: 'REQ-' + randomUUID() }, now = new Date().toISOString();
  createDeliveryRequirement(state, 'owner', { id: scope.taskId, projectId: scope.projectId, title: '保留最近对话', description: '测试会话恢复', assigneeId: 'member' }, now);
  queueTaskPreparation(state, scope, now);
  const auto = taskAutomation(state, scope)!, preparation = auto.preparation!, sessionId = randomUUID(), initialRun = preparation.id, resumedRun = randomUUID();
  auto.knowledge!.status = 'ready';
  const source = join(dir, 'work-contexts', initialRun + '.native'), output = join(dir, 'work-contexts', resumedRun + '.native'), short = sessionId.replaceAll('-', '').slice(0, 12);
  const bytes = (text: string, updatedAt: string) => JSON.stringify({ meta: { session_id: sessionId, updated_at: updatedAt }, state: { messages: [{ role: 'user', contents: [{ type: 'text', text }] }] } });
  const initial = bytes('初始化', now);
  const put = async (base: string, name: string, value: unknown) => { const path = join(base, name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  await put(source, 'session-root/sessions/' + short + '/session.json', initial);
  await put(source, 'native-session.json', { runId: initialRun, ...scope, sessionId, sessionRoot: join(source, 'session-root'), pid: 2147483646, startedAt: now });
  await put(source, 'result.json', { runId: initialRun, sessionId, status: 'completed' });
  preparation.status = 'ready'; preparation.session = { status: 'ready', runId: initialRun, sessionId, directory: await realpath(codeRoot), preparedAt: now, contextPath: '/context', contextSha256: sha('context'), skillPath: '/skill', sessionSha256: sha(initial), agent: 'code', agentLabel: 'Code', model: 'model', modelLabel: 'Model', readEvidence: [{ path: '/context', callId: 'read', sha256: sha('context') }], summary: '已读取' };
  const startedAt = new Date().toISOString(), child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const owner = { runId: resumedRun, ...scope, nodeId: 'prepare', sessionId, sessionRoot: join(output, 'session-root'), pid: child.pid!, startedAt: new Date().toISOString(), executionMode: 'interactive' };
  await put(output, 'manifest.json', { runId: resumedRun, scope, preparedSession: { preparationRunId: initialRun, sessionId } });
  await put(output, 'native-session.json', owner); await put(output, 'process.json', { pid: child.pid, startedAt });
  await put(output, 'session-root/sessions/.locks/' + short + '.active.json', { pid: child.pid, session_id: sessionId, started_at: owner.startedAt });
  await put(output, 'session-root/sessions/' + short + '/session.json', initial);
  await put(output, 'terminal-receipt.json', { runId: resumedRun, ...scope, directory: preparation.session.directory, terminalKind: 'ghostty', terminal: 'Ghostty', terminalId: 'exact-surface-12345' });
  const starts: any[] = [], focuses: any[] = [];
  const transport: WorkTransport = { defaults: async () => ({ agent: 'code', agentLabel: 'Code', model: 'model', modelLabel: 'Model', terminal: { id: 'ghostty', name: 'Ghostty' } }), history: async () => ({ available: false, directory: '', title: '', active: null }), start: async input => { starts.push(input); return { terminal: 'Ghostty' }; }, focus: async input => { focuses.push(input); return { status: 'terminal-focused', note: 'focused' }; } };
  const service = new ProjectWorkService(() => state, fixtures, dir, transport, undefined, dir), target = { ...scope, tab: 'delivery', nodeId: 'prepare' }, stateBefore = JSON.stringify(state);
  try {
    const active = await service.plan('member', target);
    assert.equal(active.defaultAction, 'focus'); assert.equal(active.history?.active?.pid, child.pid);
    if (process.platform === 'darwin') {
      assert.equal(active.actions[0].enabled, true); assert.equal(active.history?.active?.terminal?.id, 'exact-surface-12345');
      const request = { requestId: randomUUID(), target, action: 'focus' as const, planToken: active.planToken };
      assert.equal((await service.start('member', request)).status, 'terminal-focused'); await service.start('member', request); assert.equal(focuses.length, 1); assert.equal(starts.length, 0);
    } else assert.equal(active.actions[0].enabled, false);
    const closed = once(child, 'close'); child.kill(); await closed;
    const latest = bytes('用户关闭前的新对话', new Date(Date.now() + 1000).toISOString());
    await put(output, 'session-root/sessions/' + short + '/session.recovery.json', latest);
    await put(output, 'result.json', { runId: resumedRun, sessionId, status: 'failed', executionMode: 'interactive', nativeExitCode: 120 });
    // A stale lock is preserved; a dead owner is not an active process.
    const plan = await service.plan('member', target); assert.equal(plan.defaultAction, 'resume'); assert.equal(plan.actions[0].enabled, true); assert.equal(plan.history?.prepared?.sourceRunId, resumedRun); assert.equal(plan.history?.prepared?.sessionSha256, sha(latest)); assert.match(plan.history!.diagnostic!, /异常退出/);
    const destination = join(dir, 'work-contexts', randomUUID() + '.native'); await mkdir(destination);
    await copyPreparedSession({ runId: randomUUID(), scope, preparedSession: { ...plan.history!.prepared, sessionId } }, destination);
    assert.equal(await readFile(join(destination, 'session-root/sessions', short, 'session.recovery.json'), 'utf8'), latest);
    assert.equal(await readFile(join(source, 'session-root/sessions', short, 'session.json'), 'utf8'), initial);
    assert.equal(await readFile(join(output, 'session-root/sessions', short, 'session.recovery.json'), 'utf8'), latest); assert.equal(JSON.stringify(state), stateBefore);
    await put(output, 'session-root/sessions/' + short + '/session.recovery.json', '{broken');
    await assert.rejects(service.plan('member', target), /JSON/); // Never silently fall back to the old initialization.
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test('exact Ghostty focus sends only focus by persisted surface ID, with no input or new window fallback', async () => {
  const history: any = { directory: '/work', active: { pid: 42, terminal: { kind: 'ghostty', id: 'surface-123', title: 'Ghostty', directory: '/work' } } }, calls: any[] = [];
  const old = process.env.DEMO_NATIVE_DISABLED; delete process.env.DEMO_NATIVE_DISABLED;
  try {
    const opts = { platform: 'darwin' as const, terminals: async () => [{ id: 'ghostty', name: 'Ghostty', path: '/Applications/Ghostty.app' }], execute: async (file: string, args: string[]) => { calls.push({ file, args }); return { stdout: 'focused\n' }; } };
    assert.equal((await focusWorkTerminal(history, opts)).status, 'terminal-focused'); assert.equal(calls.length, 1); assert.equal(calls[0].args.at(-1), 'surface-123'); assert.match(calls[0].args[1], /focus \(item 1 of matches\)/); assert.doesNotMatch(calls[0].args[1], /new window|do script|input text|send key/);
    await assert.rejects(focusWorkTerminal(history, { ...opts, execute: async () => { throw new Error('surface closed'); } }), /surface closed/); assert.equal(calls.length, 1);
    process.env.DEMO_NATIVE_DISABLED = '1'; await assert.rejects(focusWorkTerminal(history, opts), /未开放/); assert.equal(calls.length, 1);
  } finally { if (old === undefined) delete process.env.DEMO_NATIVE_DISABLED; else process.env.DEMO_NATIVE_DISABLED = old; }
});
