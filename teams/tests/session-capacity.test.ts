import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import type { CollectedSession } from '../src/task-automation.js';
import { collectTaskSessions } from '../src/task-automation.js';
import { nativeTaskSessionDocuments } from '../server/task-session-documents.js';
import { exportTaskSessions, taskSessionPayload, validateTaskIntakes } from '../server/talent-intake.js';
import { MAX_NATIVE_SESSION_BYTES, MAX_NATIVE_TRAJECTORY_BYTES, MAX_TASK_SESSION_DOCUMENT_BYTES, validateSessionDocumentCapacity } from '../server/session-capacity.js';

const MiB = 1024 * 1024, at = '2026-10-28T00:00:00.000Z';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const runtime = await realpath(await mkdtemp(join(tmpdir(), 'session-capacity-'))), state = initialState();
  const scope = { projectId: 'carddemo', taskId: 'MKT-CAPACITY-001' };
  const task = createDeliveryRequirement(state, 'owner', { ...scope, id: scope.taskId, title: '隔离容量协议测试', description: '不代表真实模型执行', assigneeId: 'member', skillIds: [] }, at);
  task.stage = 'accepted'; task.acceptedAt = at; task.inputDigest = 'a'.repeat(64);
  const sessions: CollectedSession[] = [];
  async function add(bytes: number) {
    const sessionId = randomUUID(), runId = randomUUID(), runRoot = join(runtime, 'work-contexts', runId + '.native'), sessionRoot = join(runRoot, 'session-root');
    const path = join(sessionRoot, 'sessions', sessionId.replaceAll('-', '').slice(0, 12), 'session.json');
    const content = JSON.stringify({ meta: { session_id: sessionId }, state: { messages: [{ role: 'assistant', content: '完整正文：中文与换行\n保留' }], compressed_msgs: 'x'.repeat(bytes) } });
    await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content);
    await writeFile(join(runRoot, 'native-session.json'), JSON.stringify({ ...scope, runId, sessionId, sessionRoot, source: 'icode-active-session-owner' }));
    await writeFile(join(runRoot, 'result.json'), JSON.stringify({ runId, sessionId, status: 'completed' }));
    const session: CollectedSession = { tool: 'icode', sessionId, nodeIds: ['develop'], runIds: [runId], sources: ['Teams CLI 回传'], firstAt: at, lastAt: at };
    sessions.push(session);
    state.workspace.taskAutomation = [{ ...scope, sessions: sessions.map(item => ({ ...scope, nodeId: 'develop', tool: 'icode', sessionId: item.sessionId, source: 'manual', at })) }];
    return { path, content, session };
  }
  return { runtime, state, scope, task, sessions, add, cleanup: () => rm(runtime, { recursive: true, force: true }) };
}

test('session capacity is bounded by UTF-8 bytes: 32 MiB each, 64 MiB trajectory, 128 MiB per collection', () => {
  assert.equal(MAX_NATIVE_SESSION_BYTES, 32 * MiB); assert.equal(MAX_NATIVE_TRAJECTORY_BYTES, 64 * MiB); assert.equal(MAX_TASK_SESSION_DOCUMENT_BYTES, 128 * MiB);
  const content = 'x'.repeat(MAX_NATIVE_SESSION_BYTES);
  assert.doesNotThrow(() => validateSessionDocumentCapacity(Array.from({ length: 4 }, () => ({ content }))));
  assert.throws(() => validateSessionDocumentCapacity([{ content: content + '中' }]), /32 MiB/);
  assert.throws(() => validateSessionDocumentCapacity(Array.from({ length: 5 }, () => ({ content }))), /128 MiB/);
});

test('9 MiB native document is frozen, shared and retried byte-for-byte with the original SHA', async () => {
  const f = await fixture();
  try {
    const item = await f.add(9 * MiB), capture = { id: randomUUID(), acceptedAt: at };
    const before = await readFile(item.path), docs = await nativeTaskSessionDocuments(f.runtime, f.scope, f.sessions, capture);
    assert.ok(Buffer.byteLength(docs[0].content) > 9 * MiB);
    assert.equal(docs[0].content, item.content); assert.equal(docs[0].sha256, sha(before));
    assert.deepEqual(await nativeTaskSessionDocuments(f.runtime, f.scope, f.sessions, capture), docs);
    const payload = { ...f.scope, deliveryId: capture.id, idempotencyKey: capture.id, acceptedAt: at, inputDigest: f.task.inputDigest!, sessions: collectTaskSessions(f.state, f.scope), sessionDocuments: docs };
    const directory = join(f.runtime, 'shared'), receipt = await exportTaskSessions(f.state, payload, directory);
    const path = join(directory, 'teams', 'task-sessions', sha(capture.id) + '.json');
    const persisted = JSON.parse(await readFile(path, 'utf8')); validateTaskIntakes([persisted]);
    assert.equal(persisted.payload.sessionDocuments[0].content, item.content);
    assert.deepEqual(receipt.documentHashes, [{ sessionId: item.session.sessionId, sha256: sha(before) }]);
    assert.deepEqual(await exportTaskSessions(f.state, payload, directory), receipt); assert.deepEqual(await readFile(item.path), before);
    const handle = await open(item.path, 'r+'); try { await handle.truncate(MAX_NATIVE_SESSION_BYTES + 1); } finally { await handle.close(); }
    await assert.rejects(nativeTaskSessionDocuments(f.runtime, f.scope, f.sessions, { ...capture, id: randomUUID() }), /32 MiB/);
    assert.equal((await readdir(join(f.runtime, 'task-session-snapshots'))).length, 1);
  } finally { await f.cleanup(); }
});

test('aggregate collection over 128 MiB fails before snapshot or shared receipt; no body is truncated', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) await f.add(26 * MiB);
    await assert.rejects(nativeTaskSessionDocuments(f.runtime, f.scope, f.sessions, { id: randomUUID(), acceptedAt: at }), /128 MiB/);
    assert.deepEqual((await readdir(f.runtime)).sort(), ['work-contexts']);
    const content = JSON.stringify({ meta: { session_id: 'irrelevant-preflight' }, retained: 'x'.repeat(26 * MiB) });
    const payload = { ...f.scope, deliveryId: randomUUID(), idempotencyKey: randomUUID(), acceptedAt: at, inputDigest: f.task.inputDigest!, sessions: f.sessions, sessionDocuments: f.sessions.map(session => ({ sessionId: session.sessionId, sha256: sha(content), content })) };
    assert.throws(() => taskSessionPayload(payload), /128 MiB/);
    await assert.rejects(exportTaskSessions(f.state, payload, join(f.runtime, 'shared')), /128 MiB/);
    assert.deepEqual((await readdir(f.runtime)).sort(), ['work-contexts']);
    payload.sessionDocuments = [{ sessionId: f.sessions[0].sessionId, sha256: 'a'.repeat(64), content: 'x'.repeat(MAX_NATIVE_SESSION_BYTES + 1) }];
    assert.throws(() => taskSessionPayload(payload), /32 MiB/);
  } finally { await f.cleanup(); }
});
