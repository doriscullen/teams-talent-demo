import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.js';
import {readFixtures} from '../server/http-shared.js';
import {collaborationContext,collaborationWrite} from '../server/collaboration-service.js';
import {createDeliveryRequirement,deliveryRequirement} from '../src/delivery-requirements.js';
import {TaskPreparationService} from '../server/task-preparation.js';
import {talentNodeInputs} from '../server/talent-node-inputs.js';
import {registeredTaskSkill} from '../server/talent-intake.js';
import {nodeResultFixture} from './node-contract-fixtures.js';
import {taskAutomation,taskNodeKnowledge} from '../src/task-automation.js';
import {taskNodeView} from '../src/task-node-contract.js';

const data=await readFixtures(),scope={projectId:'carddemo',taskId:'MKT-E2E-001'},runId='scope-test-run',sessionId='scope-test-session';
const task=(store:Store)=>deliveryRequirement(store.state,scope.projectId,scope.taskId)!;
const context=(store:Store,nodeId:'prepare'|'develop')=>collaborationContext(store.state,data,{...scope,nodeId});
async function adopt(store:Store,nodeId:'prepare'|'develop'){
 const ctx=await context(store,nodeId);
 return (await collaborationWrite(store,data,{kind:'inputs.adopt',role:'member',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,expectedRevision:ctx.revision,basisDigest:ctx.basisDigest,readReferences:[]}})).receipt.adoptionId;
}
function progress(store:Store,nodeId:'prepare'|'develop',adoptionId:string,extra:Record<string,unknown>={}){
 return {kind:'progress.add',role:'member',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,adoptionId,expectedRevision:store.state.revision,phase:'started',summary:'Isolated declaration; no model or business execution',evidence:[],...extra}};
}
function result(store:Store,adoptionId:string){return {kind:'result.submit',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'prepare',runId,sessionId,adoptionId,expectedRevision:store.state.revision,summary:'PRD fixture',...nodeResultFixture('prepare')}};}
async function fixture(run:(store:Store,path:string,first:ReturnType<typeof progress>,completed:ReturnType<typeof result>)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'preparation-scope-')),path=join(directory,'state.json'),store=new Store(path);
 try{
  await store.init();await store.transact(current=>{const next=structuredClone(current);createDeliveryRequirement(next,'owner',{...scope,id:scope.taskId,title:'Node scope protocol fixture',description:'Isolated state only',assigneeId:'member'},new Date().toISOString());return next;});
  const adoption=await adopt(store,'prepare'),first=progress(store,'prepare',adoption);await collaborationWrite(store,data,first);const completed=result(store,adoption);await collaborationWrite(store,data,completed);
  await run(store,path,first,completed);
 }finally{await rm(directory,{recursive:true,force:true});}
}
async function developmentReady(store:Store){
 const preparation=new TaskPreparationService(store,data,{delay:async()=>{},loadInputs:(state,selected)=>talentNodeInputs({state,project:{id:'carddemo',name:'Fixture',generation:'test'}},data,selected.taskId,selected.nodeId!,'local',registeredTaskSkill,[]),prepareSession:async()=>{throw Error('must not invoke a model');}});
 await preparation.scheduleNode(scope,'develop');
}

test('stale prepare progress after PRD completion is rejected atomically, including a newly adopted old scope',()=>fixture(async(store,path)=>{
 assert.equal((await context(store,'prepare')).currentNodeId,'develop');
 const adoption=await adopt(store,'prepare');
 for(const phase of ['started','progress','blocked']){
  const before=await readFile(path),memory=JSON.stringify(store.state);
  await assert.rejects(collaborationWrite(store,data,progress(store,'prepare',adoption,{phase,...(phase==='blocked'?{blocker:'fixture'}:{})})),error=>{
   assert.equal((error as {status:number}).status,409);assert.match((error as Error).message,/nodeId=develop/);return true;
  });
  assert.deepEqual(await readFile(path),before);assert.equal(JSON.stringify(store.state),memory);assert.equal(task(store).nodes.prepare.status,'complete');
 }
}));

test('switching to develop requires its own adoption and does not change the completed PRD node',()=>fixture(async(store)=>{
 await developmentReady(store);const previous=structuredClone(task(store).nodes.prepare),adoption=await adopt(store,'develop');
 await collaborationWrite(store,data,progress(store,'develop',adoption));
 assert.deepEqual(task(store).nodes.prepare,previous);assert.equal(task(store).nodes.develop.status,'running');assert.equal(task(store).stage,'developing');
}));

test('exact operation replay stays idempotent after the node has completed',()=>fixture(async(store,path,first)=>{
 const before=await readFile(path),replay=await collaborationWrite(store,data,first);
 assert.equal(replay.replayed,true);assert.deepEqual(await readFile(path),before);assert.equal(task(store).nodes.prepare.status,'complete');
}));

test('explicit PRD rework remains possible before development adopts inputs',()=>fixture(async(store)=>{
 const history=structuredClone(store.state.workspace.collaboration!.events);
 const adoption=await adopt(store,'prepare');await collaborationWrite(store,data,progress(store,'prepare',adoption,{reopen:true}));
 assert.equal(task(store).stage,'preparing');assert.equal(task(store).nodes.prepare.status,'running');
 assert.deepEqual(store.state.workspace.collaboration!.events.slice(0,history.length),history);
 assert.equal(store.state.workspace.collaboration!.events.at(-1)!.reopen,true);
 const reopened=taskNodeView(store.state,task(store),'prepare',data);
 assert.ok(reopened.deliverables.every(item=>item.references.length===0));
 assert.ok(reopened.criteria.every(item=>item.status==='pending'));
 assert.equal(taskNodeKnowledge(taskAutomation(store.state,scope),'develop'),undefined,'previous PRD recommendations must not remain ready during explicit rework');
 await assert.rejects(adopt(store,'develop'),/尚未获取完成|PRD与完成标准/);
 const submitted=result(store,adoption);submitted.input.evidence[0].version='prd-v2';await collaborationWrite(store,data,submitted);
 assert.equal(task(store).stage,'developing');assert.equal(task(store).nodes.prepare.status,'complete');
 const completed=taskNodeView(store.state,task(store),'prepare',data);
 assert.equal(completed.deliverables[0].references[0].version,'prd-v2');
 assert.ok(completed.criteria.every(item=>item.status==='reported'));
}));

test('a new result cannot replace a completed PRD without explicit rework, while its old receipt remains replayable',()=>fixture(async(store,path,_first,completed)=>{
 const adoption=await adopt(store,'prepare'),before=await readFile(path);
 await assert.rejects(collaborationWrite(store,data,result(store,adoption)),/nodeId=develop/);
 assert.equal((await collaborationWrite(store,data,completed)).replayed,true);
 assert.deepEqual(await readFile(path),before);
}));

test('PRD rework and late replacement cannot bypass an already adopted development basis',()=>fixture(async(store,path)=>{
 await developmentReady(store);await adopt(store,'develop');const adoption=await adopt(store,'prepare'),before=await readFile(path);
 await assert.rejects(collaborationWrite(store,data,progress(store,'prepare',adoption,{reopen:true})),/功能开发尚未采用/);
 await assert.rejects(collaborationWrite(store,data,result(store,adoption)),/nodeId=develop/);
 assert.deepEqual(await readFile(path),before);assert.equal(task(store).nodes.prepare.status,'complete');
}));
