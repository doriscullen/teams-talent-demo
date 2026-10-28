import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,realpath,utimes,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { nativeTaskSessionDocuments, readNativeTuiEnvelope } from '../server/task-session-documents.js';
import type { CollectedSession } from '../src/task-automation.js';
import { nativeSessionMigrationFile } from '../server/native-session-location.js';
import { taskSessionPayload } from '../server/talent-intake.js';

test('native upload reads exact completed session bytes, verifies scope and rejects unfinished or foreign content',async()=>{
 const runtime=await mkdtemp(join(tmpdir(),'task-session-doc-'));const runId=randomUUID(),sessionId=randomUUID(),scope={projectId:'carddemo',taskId:'MKT-TEST-001'};
 const root=join(runtime,'work-contexts',runId+'.native'),sessionRoot=join(root,'session-root'),path=join(sessionRoot,'sessions',sessionId.replaceAll('-','').slice(0,12),'session.json');
 const content=JSON.stringify({meta:{session_id:sessionId},state:{messages:[{content:'真实格式测试材料；只验证读取，不代表原生执行'}]}},null,2)+'\n';
 const session:CollectedSession={tool:'icode',sessionId,nodeIds:['develop','verify'],runIds:[runId],sources:['Teams CLI 回传'],firstAt:'2026-10-27T00:00:00Z',lastAt:'2026-10-27T00:01:00Z'};
 try{
  await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content);
  const owner={...scope,runId,sessionId,sessionRoot,source:'icode-active-session-owner'};
  await writeFile(join(root,'native-session.json'),JSON.stringify(owner));await writeFile(join(root,'result.json'),JSON.stringify({runId,sessionId,status:'completed'}));
  const docs=await nativeTaskSessionDocuments(runtime,scope,[session]);assert.deepEqual(docs,[{sessionId,content,sha256:createHash('sha256').update(content).digest('hex')}]);
  const relocatedOwner={...owner,nodeId:'prepare',sessionRoot:join(runtime,'previous','work-contexts',runId+'.native','session-root')};
  const manifestBytes=Buffer.from(JSON.stringify({runId,scope:{...scope,nodeId:'prepare'}})),ownerBytes=Buffer.from(JSON.stringify(relocatedOwner)),sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
  await writeFile(join(root,'native-session.json'),ownerBytes);await writeFile(join(root,'manifest.json'),manifestBytes);
  await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[session]),/范围不匹配/);
  await writeFile(join(runtime,nativeSessionMigrationFile),JSON.stringify({version:1,entries:[{...scope,nodeId:'prepare',runId,sessionId,previousSessionRoot:relocatedOwner.sessionRoot,sessionRoot:await realpath(sessionRoot),ownerSha256:sha(ownerBytes),manifestSha256:sha(manifestBytes)}]}));
  assert.deepEqual(await nativeTaskSessionDocuments(runtime,scope,[session]),docs);assert.deepEqual(await readFile(join(root,'native-session.json')),ownerBytes);
  await assert.rejects(nativeTaskSessionDocuments(runtime,{...scope,taskId:'MKT-FOREIGN'},[session]),/范围/);
  await writeFile(join(root,'result.json'),JSON.stringify({runId,sessionId,status:'running'}));await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[session]),/完成回执/);
  await writeFile(join(root,'result.json'),JSON.stringify({runId,sessionId,status:'completed'}));await writeFile(path,JSON.stringify({meta:{session_id:randomUUID()}}));await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[session]),/正文身份/);
  await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[{...session,tool:'opencode'}]),/可核验/);
 }finally{await rm(runtime,{recursive:true,force:true});}
});

test('accepted live TUI captures persisted bytes without closing the process and retries the same immutable snapshot', async () => {
 const runtime=await mkdtemp(join(tmpdir(),'tui-session-snapshot-')),runId=randomUUID(),sessionId=randomUUID(),scope={projectId:'carddemo',taskId:'MKT-TUI-ACCEPT'};
 const root=join(runtime,'work-contexts',runId+'.native'),sessionRoot=join(root,'session-root'),short=sessionId.replaceAll('-','').slice(0,12),path=join(sessionRoot,'sessions',short,'session.json'),startedAt=new Date().toISOString();
 const session:CollectedSession={tool:'icode',sessionId,nodeIds:['develop','verify'],runIds:[runId],sources:['Teams CLI 回传'],firstAt:startedAt,lastAt:startedAt};
 const capture={id:randomUUID(),acceptedAt:startedAt},content=JSON.stringify({meta:{session_id:sessionId,updated_at:startedAt},state:{messages:[{role:'assistant',content:'First persisted result'}]}});
 try{
  await mkdir(join(path,'..'),{recursive:true});await mkdir(join(sessionRoot,'sessions','.locks'));
  await writeFile(path.replace('session.json','session.recovery.json'),content);await writeFile(join(root,'native-session.json'),JSON.stringify({...scope,runId,sessionId,sessionRoot,source:'icode-active-session-owner',executionMode:'interactive',nodeId:'develop',pid:process.pid,startedAt}));
  await writeFile(join(root,'manifest.json'),JSON.stringify({executionMode:'interactive',runId,scope:{...scope,nodeId:'develop'}}));
  await writeFile(join(sessionRoot,'sessions','.locks',short+'.active.json'),JSON.stringify({session_id:sessionId,pid:process.pid,started_at:startedAt}));
  await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[session]),/明确验收范围/);
  const first=await nativeTaskSessionDocuments(runtime,scope,[session],capture);assert.equal(first[0].content,content);process.kill(process.pid,0);
  const pinned=JSON.parse(await readFile(join(runtime,'task-session-snapshots',capture.id+'.json'),'utf8'));assert.equal(pinned.sources[0].kind,'live-tui-persisted-snapshot');assert.ok(pinned.capturedAt);assert.equal(pinned.sources[0].sourceFile,'session.recovery.json');
  await writeFile(path,JSON.stringify({meta:{session_id:sessionId,updated_at:startedAt},state:{messages:[{role:'assistant',content:'Later interactive turn'}]}}));
  const retry=await nativeTaskSessionDocuments(runtime,scope,[session],capture);assert.deepEqual(retry,first);
  await assert.rejects(nativeTaskSessionDocuments(runtime,{...scope,taskId:'OTHER'},[session],capture),/不同任务/);
  await writeFile(join(sessionRoot,'sessions','.locks',short+'.active.json'),JSON.stringify({session_id:randomUUID(),pid:process.pid,started_at:startedAt}));
  await assert.rejects(nativeTaskSessionDocuments(runtime,scope,[session],{...capture,id:randomUUID()}),/归属无法核验/);
 }finally{await rm(runtime,{recursive:true,force:true});}
});

test('TUI effective persisted source uses native timestamps; invalid primary/recovery is never hidden', async()=>{
 const root=await mkdtemp(join(tmpdir(),'tui-envelope-')),sessionId=randomUUID(),directory=join(root,'session-root','sessions',sessionId.replaceAll('-','').slice(0,12));
 const document=(updated_at:string,value:string)=>JSON.stringify({meta:{session_id:sessionId,updated_at},state:{messages:[{role:'assistant',content:value}]}});
 try {
  await mkdir(directory,{recursive:true});await assert.rejects(readNativeTuiEnvelope(root,sessionId),/尚未保存/);
  const primary=document('2026-10-27T00:00:00Z','settled'),recovery=document('2026-10-27T00:01:00Z','in-flight');
  await writeFile(join(directory,'session.recovery.json'),recovery);assert.equal((await readNativeTuiEnvelope(root,sessionId)).content,recovery);
  await writeFile(join(directory,'session.json'),primary);assert.equal((await readNativeTuiEnvelope(root,sessionId)).sourceFile,'session.recovery.json');
  await writeFile(join(directory,'session.json'),document('2026-10-27T00:02:00Z','new settled'));assert.equal((await readNativeTuiEnvelope(root,sessionId)).sourceFile,'session.json');
  await writeFile(join(directory,'session.recovery.json'),'{invalid');await assert.rejects(readNativeTuiEnvelope(root,sessionId),SyntaxError);
  await writeFile(join(directory,'session.recovery.json'),recovery);await writeFile(join(directory,'session.json'),'{invalid');await assert.rejects(readNativeTuiEnvelope(root,sessionId),SyntaxError);
 }finally{await rm(root,{recursive:true,force:true});}
});

async function interruptedContinuationFixture() {
 const runtime=await realpath(await mkdtemp(join(tmpdir(),'continued-session-doc-'))),sessionId=randomUUID();
 const scope={projectId:'carddemo',taskId:'REQ-CONTINUED-001'},runIds=[randomUUID(),randomUUID(),randomUUID()],short=sessionId.replaceAll('-','').slice(0,12);
 const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
 const runs:Array<{runId:string;root:string;path:string;content:string;owner:Record<string,any>;result:Record<string,any>;manifest:Record<string,any>}>=[];
 for(let i=0;i<runIds.length;i++) {
  const runId=runIds[i],root=join(runtime,'work-contexts',runId+'.native'),sessionRoot=join(root,'session-root'),path=join(sessionRoot,'sessions',short,'session.json');
  const startedAt=`2026-10-28T00:0${i*2}:00.000Z`,finishedAt=`2026-10-28T00:0${i*2+1}:00.000Z`,nodeId=i===0?'develop':'verify';
  const content=JSON.stringify({meta:{session_id:sessionId,updated_at:finishedAt},state:{messages:Array.from({length:i+1},(_,j)=>({role:'assistant',content:j===1?'历史中断：保留失败事实':'隔离协议材料 '+j}))}});
  const owner={...scope,runId,sessionId,nodeId,pid:200+i,sessionRoot,source:'icode-active-session-owner',executionMode:'task-file',startedAt};
  const result={...scope,runId,sessionId,nodeId,pid:owner.pid,executionMode:'task-file',startedAt,finishedAt,status:i===1?'failed':'completed',nativeExitCode:i===1?130:0};
  const manifest={runId,scope:{...scope,nodeId},executionMode:'task-file',preparedSession:{sourceRunId:i?runIds[i-1]:randomUUID(),sessionId,sessionSha256:i?sha(runs[i-1].content):'a'.repeat(64)}};
  await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content);
  for(const [name,value] of Object.entries({'native-session.json':owner,'manifest.json':manifest,'result.json':result}))await writeFile(join(root,name),JSON.stringify(value));
  runs.push({runId,root,path,content,owner,result,manifest});
 }
 const session:CollectedSession={tool:'icode',sessionId,nodeIds:['develop','verify'],runIds:[runIds[2],runIds[0],runIds[1]],sources:['Teams CLI 回传'],firstAt:runs[0].result.startedAt,lastAt:runs[2].result.finishedAt};
 return {runtime,scope,session,runs,capture:{id:randomUUID(),acceptedAt:'2026-10-28T00:06:00.000Z'},sha};
}

test('interrupted history requires an exact native continuation and shares the final completed body without changing failure evidence',async()=>{
 const f=await interruptedContinuationFixture();
 try {
  // A touched historical file must not replace the completed continuation body.
  await utimes(f.runs[1].path,new Date('2030-01-01'),new Date('2030-01-01'));
  const before=await Promise.all(f.runs.flatMap(r=>['native-session.json','manifest.json','result.json'].map(n=>readFile(join(r.root,n)))));
  const docs=await nativeTaskSessionDocuments(f.runtime,f.scope,[f.session],f.capture);
  assert.deepEqual(docs,[{sessionId:f.session.sessionId,content:f.runs[2].content,sha256:f.sha(f.runs[2].content)}]);
  const snapshot=JSON.parse(await readFile(join(f.runtime,'task-session-snapshots',f.capture.id+'.json'),'utf8'));
  assert.equal(snapshot.sources[0].runId,f.runs[2].runId);
  assert.equal(snapshot.sources[0].runs.length,3);
  const failed=snapshot.sources[0].runs.find((r:{runId:string})=>r.runId===f.runs[1].runId);
  assert.equal(failed.status,'failed');assert.equal(failed.nativeExitCode,130);assert.equal(failed.sessionSha256,f.sha(f.runs[1].content));
  const payload=taskSessionPayload({...f.scope,deliveryId:f.capture.id,idempotencyKey:f.capture.id,acceptedAt:f.capture.acceptedAt,inputDigest:'a'.repeat(64),sessions:[f.session],sessionDocuments:docs});
  assert.equal(payload.sessions[0].runIds.length,3);assert.deepEqual(payload.sessionDocuments,docs);
  assert.deepEqual(await nativeTaskSessionDocuments(f.runtime,f.scope,[f.session],f.capture),docs);
  assert.deepEqual(await Promise.all(f.runs.flatMap(r=>['native-session.json','manifest.json','result.json'].map(n=>readFile(join(r.root,n))))),before);
 }finally {await rm(f.runtime,{recursive:true,force:true});}
});

test('failed history cannot bypass scope, receipt, source SHA, complete-chain or final-completion checks',async t=>{
 const mutations:Array<[string,(f:Awaited<ReturnType<typeof interruptedContinuationFixture>>)=>Promise<void>]>=[
  ['no completed successor',async f=>{f.session.runIds=[f.runs[0].runId,f.runs[1].runId];}],
  ['missing terminal receipt',async f=>{await rm(join(f.runs[1].root,'result.json'));}],
  ['foreign result task',async f=>{await writeFile(join(f.runs[1].root,'result.json'),JSON.stringify({...f.runs[1].result,taskId:'OTHER'}));}],
  ['receipt PID differs',async f=>{await writeFile(join(f.runs[1].root,'result.json'),JSON.stringify({...f.runs[1].result,pid:999}));}],
  ['failure mislabeled exit zero',async f=>{await writeFile(join(f.runs[1].root,'result.json'),JSON.stringify({...f.runs[1].result,nativeExitCode:0}));}],
  ['source SHA changed',async f=>{await writeFile(f.runs[1].path,f.runs[1].content+'\n');}],
  ['disconnected final run',async f=>{const m=structuredClone(f.runs[2].manifest);m.preparedSession.sourceRunId=randomUUID();await writeFile(join(f.runs[2].root,'manifest.json'),JSON.stringify(m));}],
  ['fork excludes failure',async f=>{const m=structuredClone(f.runs[2].manifest);m.preparedSession.sourceRunId=f.runs[0].runId;m.preparedSession.sessionSha256=f.sha(f.runs[0].content);await writeFile(join(f.runs[2].root,'manifest.json'),JSON.stringify(m));}],
  ['future completion after acceptance',async f=>{f.capture.acceptedAt='2026-10-28T00:04:30.000Z';}],
  ['overlapping native attempts',async f=>{await writeFile(join(f.runs[2].root,'result.json'),JSON.stringify({...f.runs[2].result,startedAt:'2026-10-28T00:02:30.000Z'}));}],
 ];
 for(const [name,mutate] of mutations)await t.test(name,async()=>{
  const f=await interruptedContinuationFixture();try {
   await mutate(f);await assert.rejects(nativeTaskSessionDocuments(f.runtime,f.scope,[f.session],f.capture),/回执|续作|范围/);
   assert.deepEqual(await readdir(f.runtime),['work-contexts']);
  }finally{await rm(f.runtime,{recursive:true,force:true});}
 });
});
