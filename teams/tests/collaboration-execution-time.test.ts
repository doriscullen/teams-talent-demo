import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.js';
import {readFixtures} from '../server/http-shared.js';
import {collaborationContext,collaborationWrite} from '../server/collaboration-service.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import {nodeResultFixture} from './node-contract-fixtures.js';

// Isolated declaration protocol, not actual model execution or test evidence.
const data=await readFixtures();
const scope={projectId:'carddemo',taskId:'MKT-E2E-001',nodeId:'develop'};
const receivedAt=Date.parse('2026-10-27T22:58:07.014Z');
async function fixture(run:(store:Store,path:string,input:Record<string,any>)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'execution-time-')),path=join(dir,'state.json'),store=new Store(path);
 try{
  await store.init();await store.transact(current=>{
   const next=structuredClone(current),at='2026-10-27T14:12:00.000Z';
   const task=createDeliveryRequirement(next,'owner',{projectId:scope.projectId,id:scope.taskId,title:'执行时间协议夹具',description:'只测试声明写入，不启动模型',assigneeId:'member'},at);
   task.preparedAt=at;task.stage='developing';task.nodes.prepare={status:'complete',updatedAt:at,summary:'已有PRD夹具'};task.nodeContractVersion='delivery-node-v2';
   next.workspace.collaboration={adoptions:[],events:[{id:randomUUID(),operationId:randomUUID(),projectId:scope.projectId,taskId:scope.taskId,nodeId:'prepare',role:'member',runId:'fixture',sessionId:'fixture',adoptionId:'fixture',phase:'result',summary:'已有PRD协议夹具',blocker:null,...nodeResultFixture('prepare'),at,revision:1}],operations:[]};return next;
  });
  const context=await collaborationContext(store.state,data,scope),runId=randomUUID(),sessionId='execution-time-fixture';
  const adopted=await collaborationWrite(store,data,{kind:'inputs.adopt',role:'member',operationId:randomUUID(),input:{...scope,runId,sessionId,expectedRevision:context.revision,basisDigest:context.basisDigest,readReferences:[]}},{now:()=>receivedAt});
  const input={...scope,runId,sessionId,expectedRevision:store.state.revision,adoptionId:adopted.receipt.adoptionId,summary:'隔离测试执行声明',...nodeResultFixture('develop',{codeVersion:'a'.repeat(40)})};
  await run(store,path,input);
 }finally{await rm(dir,{recursive:true,force:true});}
}
function withTime(input:Record<string,any>,executedAt:string){const result=structuredClone(input);result.evidence.find((item:any)=>item.artifact==='unit-test-result').execution.runs[0].executedAt=executedAt;return result;}

test('future actual execution times reject the entire result before any state or downstream job is persisted',()=>fixture(async(store,path,input)=>{
 for(const executedAt of ['2026-10-28T07:10:00+08:00','2026-10-28T07:14:00+08:00','2026-10-27T22:58:07.015Z']){
  const beforeMemory=JSON.stringify(store.state),beforeDisk=await readFile(path);let clockReads=0;
  await assert.rejects(collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:withTime(input,executedAt)},{now:()=>{clockReads++;return receivedAt;}}),error=>{
   assert.equal((error as {status:number}).status,400);assert.match((error as Error).message,/evidence\[2\]\.execution\.runs\[0\]\.executedAt.*服务器接收时点/);return true;
  });
  assert.equal(clockReads,1);assert.equal(JSON.stringify(store.state),beforeMemory);assert.deepEqual(await readFile(path),beforeDisk);
 }
}));

for(const executedAt of ['2026-10-28T06:57:20+08:00','2026-10-27T22:58:07.014Z'])test('past and exact-boundary actual execution time is accepted with timezone normalization: '+executedAt,()=>fixture(async(store,path,input)=>{
 const payload={kind:'result.submit',role:'member',operationId:randomUUID(),input:withTime(input,executedAt)};
 const written=await collaborationWrite(store,data,payload,{now:()=>receivedAt});assert.equal(written.receipt.at,'2026-10-27T22:58:07.014Z');
 assert.equal(store.state.workspace.deliveryRequirements!.find(task=>task.id===scope.taskId)!.stage,'verifying');
 const saved=await readFile(path);const replay=await collaborationWrite(store,data,payload,{now:()=>receivedAt-60*60*1000});
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,written.receipt);assert.deepEqual(await readFile(path),saved,'exact replays preserve already-recorded evidence even if the clock moved');
}));

test('future actual progress evidence is also rejected, and preset cannot disguise a unit execution',()=>fixture(async(store,path,input)=>{
 const future=withTime(input,'2026-10-28T07:10:00+08:00');const before=await readFile(path);
 await assert.rejects(collaborationWrite(store,data,{kind:'progress.add',role:'member',operationId:randomUUID(),input:{...future,phase:'blocked',blocker:'fixture'}},{now:()=>receivedAt}),/executedAt/);
 future.evidence.find((item:any)=>item.artifact==='unit-test-result').source='preset';
 await assert.rejects(collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:future},{now:()=>receivedAt}),/仅检查报告可声明为预置/);
 assert.deepEqual(await readFile(path),before);
}));
