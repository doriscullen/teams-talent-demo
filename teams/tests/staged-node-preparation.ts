/** Real node timers and persisted CLI protocol; native session transport is an explicit fixture. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { RequirementNode } from '../src/delivery-requirements.js';
import type { NativePreparationReceipt } from '../src/native-preparation.js';

const worker = process.argv[2] === '--worker';
const directory = worker ? process.env.STAGED_TEST_ROOT! : await mkdtemp(join(tmpdir(), 'staged-node-preparation-'));
Object.assign(process.env, { DEMO_STATE_DIR: join(directory, 'state'), DEMO_SHARED_DIR: join(directory, 'shared'), DEMO_SHARED_SEED_DIR: resolve('../shared/seed'), DEMO_NATIVE_DISABLED: '1' });
const [{ Store, atomicJson }, { readFixtures }, { createDeliveryRequirement, deliveryRequirement }, { queueTaskPreparation, taskAutomation, taskNodeKnowledge }, { TaskPreparationService }, { collaborationContext, collaborationWrite }, { readTalentNodeInputs }, { nodeResultFixture }] = await Promise.all([
  import('../server/store.js'), import('../server/http-shared.js'), import('../src/delivery-requirements.js'), import('../src/task-automation.js'), import('../server/task-preparation.js'), import('../server/collaboration-service.js'), import('../server/talent-node-client.js'), import('./node-contract-fixtures.js'),
]);
const data = await readFixtures();
const keepAlive = setInterval(() => {}, 1000);
const wait = async (predicate: () => boolean | Promise<boolean>, timeout = 3000) => { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error('Expected isolated state was not reached'); await new Promise(done => setTimeout(done, 20)); } };
if (worker) {
  try {
    const store = new Store(process.argv[3]); await store.init();
    const scheduler = new TaskPreparationService(store, data, { prepareSession: async () => { throw new Error('Downstream must not create another native session'); } });
    await scheduler.scheduleNode({ projectId: 'carddemo', taskId: process.argv[4] }, 'verify');
  } finally { clearInterval(keepAlive); }
} else {
  const path = join(directory, 'state.json'), store = new Store(path), checks: string[] = [], elapsed: Record<string, number> = {};
  const scope = { projectId: 'carddemo', taskId: 'REQ-' + randomUUID() }, runId = randomUUID(), sessionId = randomUUID();
  let nativeCalls = 0;
  const receipt = (id: string): NativePreparationReceipt => ({ status: 'ready', runId: id, sessionId, directory: '/isolated/native-fixture', preparedAt: new Date().toISOString(), contextPath: '/isolated/context', contextSha256: 'a'.repeat(64), skillPath: '/isolated/skill', sessionSha256: 'b'.repeat(64), agent: 'fixture', agentLabel: 'Fixture', model: 'fixture', modelLabel: 'Fixture', readEvidence: [{ path: '/isolated/context', callId: 'fixture-read', sha256: 'a'.repeat(64) }], summary: '测试传输回执，非真实 iCode 调用' });
  const scheduler = new TaskPreparationService(store, data, { prepareSession: async (_actor, _scope, id) => { nativeCalls++; return receipt(id); } });
  const auto = () => taskAutomation(store.state, scope)!;
  const task = () => deliveryRequirement(store.state, scope.projectId, scope.taskId)!;
  const context = (nodeId: RequirementNode) => collaborationContext(store.state, data, { ...scope, nodeId, tab: 'delivery' });
  const adopted = new Map<string, string>();
  const write = async (nodeId: RequirementNode, kind: string, extra: object) => collaborationWrite(store, data, { role: 'member', kind, operationId: randomUUID(), input: { ...scope, nodeId, tab: 'delivery', runId, sessionId, expectedRevision: store.state.revision, ...extra } });
  const adopt = async (node: RequirementNode) => { const c = await context(node); const response = await write(node, 'inputs.adopt', { basisDigest: c.basisDigest, readReferences: c.skills.map(item => item.id) }); adopted.set(node, response.receipt.adoptionId); return c; };
  const result = (node: RequirementNode) => ({ role: 'member', kind: 'result.submit', operationId: randomUUID(), input: { ...scope, nodeId: node, tab: 'delivery', runId, sessionId, expectedRevision: store.state.revision, adoptionId: adopted.get(node), summary: '独立节点时序协议验证；非真实模型执行', ...nodeResultFixture(node, { codeVersion: 'isolated-code-v7' }) } });
  const blocked = async (node: RequirementNode) => { const c = await context(node); assert.deepEqual(c.skills, []); assert.deepEqual(c.knowledge.assets, []); assert.deepEqual(c.availableActions, ['context.get']); await assert.rejects(write(node, 'inputs.adopt', { basisDigest: c.basisDigest, readReferences: [] }), /尚未.*完成/); };
  const recordTime = (node: 'prepare' | 'develop' | 'verify') => { const job = taskNodeKnowledge(auto(), node)!; const duration = Date.parse(job.finishedAt!) - Date.parse(job.startedAt); assert.ok(duration >= 20000, node + ' completed before 20 seconds: ' + duration); elapsed[node] = duration; };
  try {
    await store.init(); const oldMain = JSON.stringify(store.state.workspace.deliveryRequirements?.find(item => item.id === 'DEMO-MKT-001'));
    await store.transact(current => { const next = structuredClone(current), at = new Date().toISOString(); createDeliveryRequirement(next, 'owner', { ...scope, id: scope.taskId, title: '白金卡消费返现权益说明页', description: '白金卡未来3个月额外0.5%；只增加权益入口和说明页，日期范围等待确认。', assigneeId: 'member' }, at); queueTaskPreparation(next, scope, at); return next; });
    assert.equal(auto().nodeKnowledge?.develop?.status, 'waiting-upstream'); assert.equal(auto().nodeKnowledge?.verify?.status, 'waiting-upstream');
    await blocked('develop'); await blocked('verify');
    const preparing = scheduler.schedule(scope); assert.equal(scheduler.schedule(scope), preparing);
    await wait(() => auto().knowledge?.status === 'running'); await blocked('prepare');
    assert.ok(Object.values(task().nodes).every(node => node.status === 'pending')); assert.equal(nativeCalls, 0);
    await preparing; recordTime('prepare'); assert.equal(nativeCalls, 1); assert.equal(auto().preparation?.status, 'ready');
    assert.ok(Object.values(task().nodes).every(node => node.status === 'pending')); assert.equal(store.state.workspace.collaboration, undefined);
    checks.push('prepare waits the real 20 seconds; inputs stay hidden and no adoption/business execution occurs; only this stage invokes the explicit native fixture');
    const prepareKnowledge = JSON.stringify(auto().knowledge), initialSession = JSON.stringify(auto().preparation?.session);
    await adopt('prepare');
    const beforeInvalid = JSON.stringify(store.state);
    await assert.rejects(write('prepare', 'result.submit', { adoptionId: adopted.get('prepare'), summary: 'missing PRD', evidence: [], completedCriteria: [] }), /引用|交付物/); assert.equal(JSON.stringify(store.state), beforeInvalid); assert.equal(auto().nodeKnowledge?.develop?.status, 'waiting-upstream');
    const preparedResult = result('prepare'); await collaborationWrite(store, data, preparedResult); const developId = auto().nodeKnowledge!.develop!.id;
    assert.equal(auto().nodeKnowledge!.develop!.status, 'queued'); assert.equal(auto().preparation!.status, 'ready');
    const replayState = JSON.stringify(store.state); assert.equal((await collaborationWrite(store, data, preparedResult)).replayed, true); assert.equal(JSON.stringify(store.state), replayState);
    const prepareSnapshot = JSON.stringify(task().nodeInputSnapshots?.prepare);
    const developing = scheduler.scheduleNode(scope, 'develop'); assert.equal(scheduler.scheduleNode(scope, 'develop'), developing);
    await wait(() => auto().nodeKnowledge!.develop!.status === 'running'); await blocked('develop'); await blocked('verify');
    assert.equal(task().nodes.develop.status, 'pending'); assert.equal(auto().preparation?.status, 'ready');
    await developing; recordTime('develop'); assert.equal(auto().nodeKnowledge!.develop!.id, developId); assert.equal(nativeCalls, 1);
    const developContext = await context('develop'), prd = developContext.nodeContract!.inputs.find(item => item.id === 'prd')!.references;
    assert.equal(prd.length, 1); assert.equal(prd[0].version, 'fixture-v1'); assert.equal(prd[0].sourceNode, 'prepare'); assert.deepEqual(auto().nodeKnowledge!.develop!.upstream, prd);
    assert.equal((await context('prepare')).nodeInputs!.nodeId, 'prepare'); assert.equal(developContext.nodeInputs!.nodeId, 'develop'); assert.equal(JSON.stringify(auto().knowledge), prepareKnowledge); assert.equal(JSON.stringify(task().nodeInputSnapshots?.prepare), prepareSnapshot);
    checks.push('only compliant PRD submission queues develop; replay is idempotent; develop independently waits 20 seconds and pins exact PRD ID/version without replacing prepare cache or session');
    await adopt('develop'); const developmentResult = result('develop'); await collaborationWrite(store, data, developmentResult);
    assert.equal(auto().nodeKnowledge!.verify!.status, 'queued'); const verifyId = auto().nodeKnowledge!.verify!.id, frozenDevelop = JSON.stringify(task().nodeInputSnapshots?.develop);
    // A separate persisted branch proves failure/retry without contaminating the real-time restart case.
    const failedPath = join(directory, 'failed-state.json'); await atomicJson(failedPath, store.state); const failedStore = new Store(failedPath); await failedStore.init(); let loads = 0;
    const retry = new TaskPreparationService(failedStore, data, { delayMs: 0, prepareSession: async () => { throw new Error('no additional native session'); }, loadInputs: async (state, target) => { if (++loads === 1) throw new Error('isolated published input transport failure'); return readTalentNodeInputs(state, data, { ...target, nodeId: target.nodeId! }, { forImport: true }); } });
    await retry.scheduleNode(scope, 'verify'); let failed = taskAutomation(failedStore.state, scope)!.nodeKnowledge!.verify!; assert.equal(failed.status, 'failed'); assert.equal(failed.nodeInputs, undefined); assert.match(failed.error!, /transport failure/);
    await retry.scheduleNode(scope, 'verify'); assert.equal(loads, 1); await retry.scheduleNode(scope, 'verify', true); failed = taskAutomation(failedStore.state, scope)!.nodeKnowledge!.verify!; assert.equal(failed.status, 'ready'); assert.equal(failed.id, verifyId); assert.equal(loads, 2);
    checks.push('a failed downstream import remains failed and empty until an explicit retry of the same job; retry never recreates the native session');
    let workerLogs = '';
    const start = () => { const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', path, scope.taskId], { env: { ...process.env, STAGED_TEST_ROOT: directory }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', value => { workerLogs += value; }); child.stderr.on('data', value => { workerLogs += value; }); return child; };
    const persisted = async () => JSON.parse(await readFile(path, 'utf8'));
    const first = start(); await wait(async () => taskAutomation(await persisted(), scope)!.nodeKnowledge!.verify!.status === 'running');
    await new Promise(done => setTimeout(done, 1100)); const closing = once(first, 'close'); first.kill('SIGTERM'); await closing;
    const recorded = taskAutomation(await persisted(), scope)!.nodeKnowledge!.verify!, startTime = recorded.startedAt; assert.equal(recorded.id, verifyId);
    const restarted = start(); const [exitCode] = await once(restarted, 'close'); assert.equal(exitCode, 0, workerLogs);
    // Reopen actual persisted state after the worker restart; never patch it from the parent.
    await store.init(); recordTime('verify'); assert.equal(auto().nodeKnowledge!.verify!.startedAt, startTime); assert.equal(auto().nodeKnowledge!.verify!.attempts, 1); assert.equal(auto().nodeKnowledge!.verify!.id, verifyId);
    assert.equal(task().nodes.verify.status, 'pending'); assert.equal(auto().preparation!.status, 'ready'); assert.equal(nativeCalls, 1); assert.equal(JSON.stringify(auto().preparation?.session), initialSession);
    const verifyContext = await context('verify'), upstream = verifyContext.nodeContract!.inputs.filter(item => ['prd', 'software-design', 'code-change'].includes(item.id)).flatMap(item => item.references);
    assert.ok(upstream.some(item => item.artifact === 'prd' && item.version === 'fixture-v1')); assert.ok(upstream.some(item => item.artifact === 'code-change' && item.codeVersion === 'isolated-code-v7'));
    assert.ok(upstream.every(item => auto().nodeKnowledge!.verify!.upstream!.some(saved => saved.id === item.id && saved.version === item.version)));
    assert.equal(JSON.stringify(task().nodeInputSnapshots?.develop), frozenDevelop); assert.equal(JSON.stringify(task().nodeInputSnapshots?.prepare), prepareSnapshot); assert.equal(JSON.stringify(auto().knowledge), prepareKnowledge);
    await adopt('verify'); assert.equal(new Set(store.state.workspace.collaboration!.adoptions.filter(item => item.taskId === scope.taskId).map(item => item.sessionId)).size, 1);
    const stable = await readFile(path); new TaskPreparationService(store, data, { prepareSession: async () => { throw new Error('must not prepare twice'); } }).resumeQueued(); await scheduler.schedule(scope); await scheduler.scheduleNode(scope, 'develop'); await scheduler.scheduleNode(scope, 'verify'); assert.deepEqual(await readFile(path), stable);
    assert.equal(JSON.stringify(store.state.workspace.deliveryRequirements?.find(item => item.id === 'DEMO-MKT-001')), oldMain);
    checks.push('verify resumes its persisted timer after a real worker termination/restart, completes no earlier than 20 seconds, retains one attempt/job and exact upstream versions; only CLI adoption starts node work');
    checks.push('three independent caches and adopted snapshots survive scope switching/reload; one session ID is reused; completed jobs and legacy main record are unchanged');
    const report = { passed: true, taskId: scope.taskId, elapsedMs: elapsed, nativeCalls, nativeTransport: 'explicit fixture only; no native process or model invoked', liveStateTouched: false, checks };
    await mkdir('test-results/staged-node-preparation', { recursive: true }); await writeFile('test-results/staged-node-preparation/result.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { clearInterval(keepAlive); await rm(directory, { recursive: true, force: true }); }
}
