import { sharedPaths, type PublishedArtifact, type TalentsKnowledge } from '../../shared/contracts.js';
import {nodeResultFixture} from './node-contract-fixtures.js';
import type {RequirementNode} from '../src/delivery-requirements.js';
/** Isolated HTTP integration. No browser, native tool, real payment, or external model is invoked. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import {randomUUID, createHash} from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DemoState } from '../src/domain.js';
import { initialState } from '../src/domain.js';
import { campaign } from '../src/cashback.js';

const root = resolve(import.meta.dirname, '..');
async function unusedPort(): Promise<number> {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())); return port;
}
const directory = await realpath(await mkdtemp(join(tmpdir(), 'talent-workflow-http-')));
let children: ChildProcess[] = [], logs = '';
const port = await unusedPort(); let talentPort = await unusedPort(); while (talentPort === port) talentPort = await unusedPort();
const teams = `http://127.0.0.1:${port}`, talent = `http://127.0.0.1:${talentPort}`;
const statePath = join(directory, 'teams', 'state.json');
const shared = join(directory, 'shared');
const published: PublishedArtifact[] = [];
async function publishFromTalents(projectId: string, id: string) {
  published.push({id,projectId,name:projectId+' 项目知识',description:'隔离共享产物',capability:'doc-extract',capabilityName:'文档知识',category:'doc',kind:'files',version:1,publishedAt:'2026-10-27T10:00:00.000Z',note:'隔离协议夹具',delivery:'local',files:[]});
  await mkdir(join(shared,'talents'),{recursive:true});
  await writeFile(join(shared,sharedPaths.talentsKnowledge),JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),artifacts:published} satisfies TalentsKnowledge));
}
const env = { ...process.env, DEMO_PORT: String(port), DEMO_TALENT_PORT: String(talentPort), DEMO_STATE_DIR: join(directory, 'teams'), DEMO_SHARED_DIR: shared, DEMO_SHARED_SEED_DIR: join(directory, 'no-seed'), DEMO_NATIVE_DISABLED: '1' };
const get = async (base: string, path: string) => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(3000) });
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
};
const state = async (): Promise<DemoState> => get(teams, '/api/state');
async function post(base: string, path: string, body: Record<string, unknown>, expected = 200) {
  const { token } = await get(base, '/api/session');
  const response = await fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(5000), headers: { Origin: base, 'Content-Type': 'application/json', 'X-Demo-Token': token }, body: JSON.stringify({ revision: (await state()).revision, role: 'owner', projectId: 'carddemo', ...body }) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const action = (name: string, role = 'owner', expected = 200) => post(teams, '/api/action', { action: name, role, ...(name==='assign'?{assigneeId:'member'}:{}) }, expected);
async function start() {
  for (const script of ['server/index.ts']) {
    const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => logs += data); child.stderr!.on('data', data => logs += data); children.push(child);
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (children.some(child => child.exitCode !== null)) throw new Error('Service exited before readiness: ' + logs);
    try { await get(teams, '/api/health'); return; } catch { await delay(100); }
  }
  throw new Error('Service startup timeout: ' + logs);
}
async function stop() {
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
    try { await exited; } finally { clearTimeout(timer); }
  })); children = [];
}
try {
  await start();
  const first = await state(), a = await get(teams, '/api/health');
  assert.ok(a.pid); assert.equal(a.workspaceRoot,root); assert.equal(first.campaignId,campaign.id);
  await action('assign', 'member', 403); await action('knowledge', 'member', 400);
  await action('accept', 'owner', 409); await action('prepare', 'member', 409);
  await post(teams, '/api/action', { action: 'knowledge' }, 400);
  await post(teams, '/api/reset', { role: 'member' }, 403);
  assert.deepEqual(await state(), first);
  console.log('PASS 1/5: isolated services, role enforcement and unmet prerequisites preserve state');

  await publishFromTalents('carddemo','card-knowledge');
  const knowledge = await get(teams, '/api/talents/knowledge?project=carddemo');
  assert.equal(knowledge.artifacts.length, 1); assert.ok(knowledge.artifacts.every((asset: any) => asset.projectId === 'carddemo'));
  await action('assign'); const staleRevision = (await state()).revision - 1;
  await post(teams, '/api/action', { action: 'assign', revision: staleRevision }, 409);
  const scope={projectId:'carddemo',taskId:'DEMO-MKT-001'},runId=randomUUID(),sessionId=randomUUID();
  const task=async()=> (await state()).workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!;
  // Existing main task has no preparation job; later node imports are triggered by its real result submissions.
  const adopt=async(nodeId:string)=>{if(nodeId==='develop'||nodeId==='verify'){const deadline=Date.now()+35000;while(true){const job=(await state()).workspace.taskAutomation?.find(item=>item.taskId===scope.taskId)?.nodeKnowledge?.[nodeId];if(!job||job.status==='ready')break;assert.notEqual(job.status,'failed',job.error);assert.ok(Date.now()<deadline,'node import timeout');await delay(80);}}const context=await get(teams,'/api/collaboration/context?'+new URLSearchParams({...scope,nodeId}));return post(teams,'/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,expectedRevision:context.revision,basisDigest:context.basisDigest,readReferences:context.skills.map((skill:any)=>skill.id)}});};
  const result=async(nodeId:string,adoptionId:string,checks?:unknown,expected=200)=>post(teams,'/api/collaboration',{role:'member',kind:'result.submit',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,adoptionId,expectedRevision:(await state()).revision,summary:'隔离协议检查',...nodeResultFixture(nodeId as RequirementNode,{failed:Array.isArray(checks)&&checks.some(check=>check.status==='failed')}),...(checks?{checks}:nodeId==='verify'?{checks:undefined}:{})}},expected);
  const prepared=await adopt('prepare');assert.equal((await task()).stage,'preparing');await result('prepare',prepared.receipt.adoptionId);const frozen=structuredClone((await task()).talentInputsSnapshot);
  for(const actionName of ['replay','check-fail','fix','submit'])await action(actionName,'member',409);
  await post(teams,'/api/workspace',{kind:'progress.sync',role:'member',payload:{text:'旧进度写入口'}},409);
  const development=await adopt('develop');await result('develop',development.receipt.adoptionId);
  let verification=await adopt('verify');await result('verify',verification.receipt.adoptionId,nodeResultFixture('verify',{failed:true}).checks);
  assert.equal((await task()).stage,'verifying');await post(teams,'/api/delivery-requirements',{...scope,action:'accept'},409);
  await result('verify',verification.receipt.adoptionId,nodeResultFixture('verify').checks);
  await post(teams,'/api/delivery-requirements',{...scope,action:'return',reason:'补充边界'});
  const repeat=await adopt('develop');await result('develop',repeat.receipt.adoptionId);verification=await adopt('verify');await result('verify',verification.receipt.adoptionId,undefined,409);
  await result('verify',verification.receipt.adoptionId,nodeResultFixture('verify').checks);
  const nativeRoot=join(directory,'teams','work-contexts',runId+'.native'),sessionRoot=join(nativeRoot,'session-root');
  const documentDirectory=join(sessionRoot,'sessions',sessionId.replaceAll('-','').slice(0,12));await mkdir(documentDirectory,{recursive:true});
  await writeFile(join(documentDirectory,'session.json'),JSON.stringify({meta:{session_id:sessionId},state:{fixture:'isolated protocol; no model invoked'}}));
  await writeFile(join(nativeRoot,'native-session.json'),JSON.stringify({source:'icode-active-session-owner',...scope,runId,sessionId,sessionRoot}));
  await writeFile(join(nativeRoot,'result.json'),JSON.stringify({runId,sessionId,status:'completed'}));
  await post(teams,'/api/delivery-requirements',{...scope,action:'accept',role:'member'},403);
  await post(teams,'/api/delivery-requirements',{...scope,action:'accept'});
  const collection=async()=> (await state()).workspace.taskAutomation!.find(item=>item.taskId===scope.taskId)!.collection!;
  for(let i=0;i<80&&(await collection()).reporting?.status!=='reported';i++)await delay(100);
  assert.equal((await collection()).reporting?.status,'reported',JSON.stringify(await collection()));assert.equal((await collection()).reporting?.receipt?.documentHashes?.length,1);
  await post(teams, '/api/workspace', { kind: 'session.report', role: 'member', payload: {} },409);
  await post(teams, '/api/workspace', { kind: 'analysis.run', role: 'member', payload: { scope: 'project' } }, 400);
  await post(teams, '/api/workspace', { kind: 'analysis.run', payload: { scope: 'project' } },400);
  await action('candidate','owner',400);
  const completed=await state();assert.equal((await task()).stage,'accepted');assert.equal(completed.evolution,'none');assert.equal(completed.security,'unverified');assert.deepEqual((await task()).talentInputsSnapshot,frozen);assert.deepEqual(completed.transactions,first.transactions);assert.equal(completed.stage,first.stage);
  const receipt = (await collection()).reporting!.receipt!;
  assert.match(receipt.id,/^SHARED-/);
  const sharedPath = join(shared,'teams','task-sessions',receipt.id.slice('SHARED-'.length)+'.json');
  const sharedBytes = await readFile(sharedPath,'utf8'), exported = JSON.parse(sharedBytes);
  assert.equal(exported.payload.projectId,scope.projectId);assert.equal(exported.payload.taskId,scope.taskId);
  assert.equal(exported.payload.sessionDocuments[0].sessionId,sessionId);
  assert.equal(createHash('sha256').update(exported.payload.sessionDocuments[0].content).digest('hex'),receipt.documentHashes![0].sha256);
  assert.deepEqual(exported.receipt,receipt);
  console.log('PASS 2/5: unified CLI delivery, mixed-check gate, fresh recheck after return and scoped shared export receipt');

  await stop(); await start(); assert.deepEqual(await state(), completed);
  assert.equal(await readFile(sharedPath,'utf8'),sharedBytes);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), completed);
  console.log('PASS 3/5: Teams state and exact shared session export survive restart without changing frozen context');

  const projectId = 'df7c9722-3878-4ae4-b047-0785f844b5bb';
  await post(teams, '/api/workspace', { kind: 'project.create', payload: { id: projectId, name: '独立项目', description: '', remoteUrl: 'https://example.test/project', repositoryIdentity: 'example.test/project' } });
  assert.deepEqual((await get(teams, '/api/talents/knowledge?project=' + projectId)).artifacts, []);
  await post(teams, '/api/action', { action: 'knowledge', projectId }, 400);
  await post(teams, '/api/workspace', { kind: 'asset.link', payload: { projectId, sourceAssetId: 'design-library:teams:AGENTS.md' } });
  await publishFromTalents(projectId,'separate-knowledge');
  const separate = await get(teams, '/api/talents/knowledge?project=' + projectId); assert.equal(separate.artifacts.length, 1); assert.equal(separate.artifacts[0].projectId, projectId);
  assert.equal((await get(teams, '/api/talents/knowledge?project=carddemo')).artifacts.length, 1);
  const publishedBytes=await readFile(join(shared,sharedPaths.talentsKnowledge),'utf8');
  await post(teams, '/api/reset', {});
  assert.equal((await state()).stage, 'draft'); assert.equal((await state()).transactions.length, 0);
  assert.equal(await readFile(join(shared,sharedPaths.talentsKnowledge),'utf8'),publishedBytes,'Teams reset cannot delete independently published Talents knowledge');
  assert.equal((await get(teams, '/api/talents/knowledge?project=carddemo')).artifacts.length,1);
  console.log('PASS 4/5: project knowledge isolation and deliberate Teams reset preserve independently published Talents data');

  await stop(); await rm(statePath+'.pre-unified-delivery.json',{force:true}); const legacy = initialState(); delete legacy.campaignId;
  await mkdir(join(directory, 'teams'), { recursive: true }); await writeFile(statePath, JSON.stringify(legacy));
  await start(); const oldBytes = await readFile(statePath, 'utf8');
  await action('assign', 'owner', 409);
  await post(teams, '/api/workspace', { kind: 'project.update', payload: { name: 'Changed', description: 'Changed', repository: 'Changed' } }, 409);
  assert.equal(await readFile(statePath, 'utf8'), oldBytes);
  await post(teams, '/api/reset', { role: 'member' }, 403); await post(teams, '/api/reset', {});
  assert.equal((await state()).campaignId, campaign.id); await action('assign'); assert.equal((await state()).workspace.deliveryRequirements!.find(item=>item.id==='DEMO-MKT-001')!.assigneeId,'member');
  console.log('PASS 5/5: old campaign is preserved/readable, writes blocked, explicit Owner reset restores operation');
  console.log('HTTP integration: 5/5 passed');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
