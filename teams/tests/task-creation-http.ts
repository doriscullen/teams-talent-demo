import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectOverview } from '../src/project-overview.js';

const directory = await mkdtemp(join(tmpdir(), 'teams-task-create-http-')), origin = 'http://127.0.0.1:46233';
const env = { ...process.env, DEMO_PORT: '46233', DEMO_STATE_DIR: join(directory, 'state'), DEMO_SHARED_DIR: join(directory, 'shared'), DEMO_SHARED_SEED_DIR: join(directory, 'empty-seed'), DEMO_NATIVE_DISABLED: '1' };
let logs = '', child: ReturnType<typeof spawn>;
const start = () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout!.on('data', value => logs += value); child.stderr!.on('data', value => logs += value); };
const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } };
const get = async (path: string) => { const response = await fetch(origin + path); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const ready = async () => { for (let attempt = 0; attempt < 100; attempt++) { try { await get('/api/health'); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } } throw new Error(logs); };
const post = async (path: string, body: object, expected = 200) => {
  const { token } = await get('/api/session'), revision = (await get('/api/state')).revision;
  const response = await fetch(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-demo-token': token }, body: JSON.stringify({ role: 'owner', revision, ...body }) });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
};
start();
try {
  await ready(); const original = await get('/api/state'), { data } = await get('/api/bootstrap');
  for (const projectId of ['carddemo', 'teams']) {
    const before = await get('/api/state'), model = projectOverview(before, data, projectId);
    const input = { projectId, id: 'REQ-' + randomUUID(), title: 'HTTP 新需求', description: '仅验证持久化与权限\n无预置执行记录', due: '2026-12-12' };
    await post('/api/delivery-requirements', { role: 'member', action: 'create', input }, 403);
    await post('/api/delivery-requirements', { action: 'create', input: { ...input, due: '2026-02-30' } }, 400);
    assert.deepEqual(await get('/api/state'), before);
    const created = await post('/api/delivery-requirements', { action: 'create', input });
    assert.deepEqual(created.workspace.deliveryRequirements.find((task: any) => task.id === input.id).skillIds, []);
    await post('/api/delivery-requirements', { action: 'assign', input: { projectId, taskId: input.id, assigneeId: 'member' } });
    // Wait for the one automatic scheduler transition before asserting rejected/idempotent requests are side-effect-free.
    for(let attempt=0;attempt<100;attempt++){if((await get('/api/state')).workspace.taskAutomation?.find((record:any)=>record.taskId===input.id)?.preparation?.status==='importing')break;await new Promise(resolve=>setTimeout(resolve,10));}
    const assigned = await get('/api/state');
    assert.equal(assigned.workspace.taskAutomation.find((record:any)=>record.taskId===input.id).preparation.status,'importing');
    assert.deepEqual(await post('/api/delivery-requirements', { action: 'create', revision: before.revision, input }), assigned);
    await post('/api/delivery-requirements', { action: 'create', input: { ...input, title: 'overwrite' } }, 409);
    await post('/api/delivery-requirements', { role: 'member', action: 'assign', input: { projectId, taskId: input.id, assigneeId: 'owner' } }, 403);
    assert.deepEqual(await get('/api/state'), assigned);
    const query = new URLSearchParams({ role: 'member', projectId, taskId: input.id, nodeId: 'prepare' });
    const context = await get('/api/collaboration/context?' + query), node = await get('/api/task-node-inputs?' + query);
    assert.equal(context.agreement.background, input.description); assert.deepEqual(context.nodeInputs, node); assert.equal(node.selection.status, 'not-configured'); assert.deepEqual(node.skills, []); assert.deepEqual(node.knowledge.assets, []);
    await post('/api/collaboration', { role: 'owner', kind: 'inputs.adopt', operationId: randomUUID(), input: { projectId, taskId: input.id, nodeId: 'prepare', runId: randomUUID(), sessionId: randomUUID(), expectedRevision: assigned.revision, basisDigest: context.basisDigest, readReferences: [] } }, 403);
    const issue = { projectId, id: 'ISSUE-' + randomUUID(), title: 'HTTP 新问题', description: '明确本地来源', severity: 'critical' };
    const revision = assigned.revision, saved = await post('/api/workspace', { kind: 'issue.create', payload: issue });
    assert.deepEqual(await post('/api/workspace', { kind: 'issue.create', revision, payload: issue }), saved);
    await post('/api/workspace', { kind: 'issue.create', payload: { ...issue, severity: 'low' } }, 409);
    await post('/api/workspace', { role: 'member', kind: 'issue.create', payload: { ...issue, id: 'ISSUE-' + randomUUID() } }, 403);
    const after = await get('/api/state'), next = projectOverview(after, data, projectId);
    assert.equal(next.counts.all, model.counts.all + 1); assert.equal(next.counts.issues, model.counts.issues + 1); assert.equal(next.counts.open, model.counts.open + 1);
    assert.deepEqual(after.workspace.deliveryRequirements[0], original.workspace.deliveryRequirements[0]);
    assert.deepEqual(after.workspace.team, original.workspace.team); assert.equal(after.stage, original.stage);
  }
  const beforeRestart = await get('/api/state'), bytes = await readFile(join(directory, 'state', 'state.json'));
  await stop(); start(); await ready(); assert.deepEqual(await get('/api/state'), beforeRestart); assert.deepEqual(await readFile(join(directory, 'state', 'state.json')), bytes);
  console.log('PASS create/assign/issues in both projects, stale-revision replay, role/scope validation, honest pending-import inputs, exact restart persistence');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
