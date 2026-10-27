import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { TaskPreparationService } from '../server/task-preparation.js';
import { createDeliveryRequirement, assignDeliveryRequirement, deliveryRequirement } from '../src/delivery-requirements.js';
import { queueTaskPreparation, taskAutomation, type TaskScope } from '../src/task-automation.js';
import { talentNodeInputs } from '../server/talent-node-inputs.js';
import { readTalentNodeInputs } from '../server/talent-node-client.js';
import { registeredTaskSkill } from '../server/talent-intake.js';
import type { TalentNodeInputs } from '../src/talent-node-inputs.js';
import type { NativePreparationReceipt } from '../src/native-preparation.js';

const data:any={...JSON.parse(await readFile('fixtures/presentation.json','utf8')),teamsProject:JSON.parse(await readFile('fixtures/teams-project.json','utf8'))};
const settle=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Expected preparation state was not reached');};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};
function receipt(runId:string):NativePreparationReceipt{return{status:'ready',runId,sessionId:randomUUID(),directory:'/fixture/project',preparedAt:new Date().toISOString(),contextPath:'/fixture/context.json',contextSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),skillPath:'/fixture/SKILL.md',agent:'fixture',agentLabel:'fixture',model:'fixture',modelLabel:'fixture',readEvidence:[{path:'/fixture/context.json',callId:'fixture-read',sha256:'a'.repeat(64)}],summary:'隔离适配器已读取材料；不代表真实原生调用'};}
async function fixture(run:(store:Store,scope:TaskScope,path:string)=>Promise<void>,assigneeId='member'){
 const directory=await mkdtemp(join(tmpdir(),'task-preparation-')),path=join(directory,'state.json'),store=new Store(path);await store.init();
 const scope={projectId:'carddemo',taskId:'REQ-'+randomUUID()};
 await store.transact(current=>{const next=structuredClone(current),at=new Date().toISOString();createDeliveryRequirement(next,'owner',{projectId:scope.projectId,id:scope.taskId,title:'库存查询说明',description:'展示当前库存数量；计量单位与刷新频率待确认。',assigneeId},at);queueTaskPreparation(next,scope,at);return next;});
 try{await run(store,scope,path);}finally{await rm(directory,{recursive:true,force:true});}
}
const load=(store:Store)=>(state:typeof store.state,scope:TaskScope)=>talentNodeInputs({state,project:{id:scope.projectId,name:'Fixture',generation:'test'}},data,scope.taskId,'prepare','http://127.0.0.1:0',registeredTaskSkill,[]);

test('assigned tasks persist queued/importing, wait the full configured interval, then prepare once without adoption or node execution',async()=>fixture(async(store,scope,path)=>{
 const delay=deferred();let milliseconds=0,reads=0,nativeCalls=0;
 const service=new TaskPreparationService(store,data,{delay:async duration=>{milliseconds=duration;await delay.promise;},loadInputs:async(state,scope)=>{reads++;return load(store)(state,scope);},prepareSession:async(_assignee,_scope,id)=>{nativeCalls++;return receipt(id);}});
 const pending=service.schedule(scope);assert.equal(service.schedule(scope),pending);await settle(()=>!!milliseconds);
 assert.ok(milliseconds>19000&&milliseconds<=20000);assert.equal(taskAutomation(store.state,scope)!.knowledge!.status,'running');assert.equal(reads,0);assert.equal(nativeCalls,0);
 const hidden=await readTalentNodeInputs(store.state,data,{...scope,nodeId:'prepare'});assert.deepEqual(hidden.skills,[]);assert.deepEqual(hidden.knowledge.assets,[]);assert.equal(hidden.requirement.description,'展示当前库存数量；计量单位与刷新频率待确认。');
 delay.resolve();await pending;const prepared=taskAutomation(store.state,scope)!.preparation!;
 assert.equal(prepared.status,'ready');assert.equal(nativeCalls,1);assert.equal(reads,1);assert.equal(taskAutomation(store.state,scope)!.knowledge!.status,'ready');
 const shown=await readTalentNodeInputs(store.state,data,{...scope,nodeId:'prepare'});assert.deepEqual(shown,taskAutomation(store.state,scope)!.knowledge!.nodeInputs);assert.ok(shown.skills.every(skill=>skill.sha256.length===64));assert.doesNotMatch(JSON.stringify(shown),/白金卡|额外0.5/);
 const task=deliveryRequirement(store.state,scope.projectId,scope.taskId)!;assert.equal(task.stage,'preparing');assert.equal(task.preparedAt,undefined);assert.ok(Object.values(task.nodes).every(node=>node.status==='pending'));assert.equal(store.state.workspace.collaboration,undefined);
 const bytes=await readFile(path);await service.schedule(scope);const reopened=new Store(path);await reopened.init();new TaskPreparationService(reopened,data,{prepareSession:async()=>{throw new Error('must not rerun');}}).resumeQueued();assert.deepEqual(await readFile(path),bytes);assert.equal(nativeCalls,1);
}));

test('unassigned work remains queued; explicit assignment starts preparation and invalidates old delayed inputs',async()=>fixture(async(store,scope)=>{
 const waits=[deferred(),deferred()];let delays=0,nativeCalls=0;
 const service=new TaskPreparationService(store,data,{delay:()=>waits[delays++].promise,loadInputs:load(store),prepareSession:async(assignee,_scope,id)=>{assert.equal(assignee,'owner');nativeCalls++;return receipt(id);}});
 await service.schedule(scope);assert.equal(delays,0);assert.equal(taskAutomation(store.state,scope)!.knowledge!.status,'queued');
 const assign=async(assigneeId:string)=>store.transact(current=>{const next=structuredClone(current),at=new Date().toISOString();assignDeliveryRequirement(next,'owner',{...scope,assigneeId},at);queueTaskPreparation(next,scope,at);return next;});
 await assign('member');const first=service.schedule(scope);await settle(()=>delays===1);const oldId=taskAutomation(store.state,scope)!.preparation!.id;
 await assign('owner');assert.notEqual(taskAutomation(store.state,scope)!.preparation!.id,oldId);const second=service.schedule(scope);await settle(()=>delays===2);
 waits[0].resolve();await first;assert.equal(nativeCalls,0);waits[1].resolve();await second;assert.equal(nativeCalls,1);assert.equal(taskAutomation(store.state,scope)!.preparation!.assigneeId,'owner');
},''));

test('missing directories stay explicit and retry the same native preparation ID without reimporting or changing the task',async()=>fixture(async(store,scope)=>{
 let inputs=0,native=0;const ids:string[]=[];
 const service=new TaskPreparationService(store,data,{delayMs:0,loadInputs:async(state,scope)=>{inputs++;return load(store)(state,scope);},prepareSession:async(_role,_scope,id)=>{ids.push(id);return++native===1?{status:'waiting-directory',reason:'请关联当前项目工作目录'}:receipt(id);}});
 await service.schedule(scope);assert.equal(taskAutomation(store.state,scope)!.preparation!.status,'waiting-directory');assert.equal(taskAutomation(store.state,scope)!.knowledge!.status,'ready');
 service.resumeQueued();await service.schedule(scope);assert.equal(native,1);await service.retry('owner',scope);await service.schedule(scope,true);assert.equal(native,2);assert.equal(inputs,1);assert.equal(ids[0],ids[1]);
 assert.throws(()=>assignDeliveryRequirement(store.state,'owner',{...scope,assigneeId:'owner'},new Date().toISOString()),/会话正在准备或已就绪/);
}));

test('failed imports expose failure, preserve no partial inputs and only explicit authorized retry rechecks',async()=>fixture(async(store,scope)=>{
 let loads=0,native=0;const service=new TaskPreparationService(store,data,{delayMs:0,loadInputs:async(state,scope)=>{if(++loads===1)throw new Error('共享知识读取失败');return load(store)(state,scope);},prepareSession:async(_role,_scope,id)=>{native++;return receipt(id);}});
 await service.schedule(scope);const id=taskAutomation(store.state,scope)!.preparation!.id;assert.equal(taskAutomation(store.state,scope)!.knowledge!.status,'failed');assert.equal(native,0);await service.schedule(scope);assert.equal(loads,1);
 await service.retry('member',scope);await service.schedule(scope,true);assert.equal(taskAutomation(store.state,scope)!.preparation!.id,id);assert.equal(loads,2);assert.equal(native,1);
}));

test('startup resumes only recorded unfinished preparation and does not touch historical delivery or acceptance records',async()=>fixture(async(store,scope,path)=>{
 await store.transact(current=>{const next=structuredClone(current),record=taskAutomation(next,scope)!;record.preparation!.status='importing';record.preparation!.startedAt=new Date(Date.now()-20000).toISOString();record.knowledge!.status='running';return next;});
 const main=structuredClone(store.state.workspace.deliveryRequirements!.find(task=>task.id==='DEMO-MKT-001'));const reopened=new Store(path);await reopened.init();let delays=0,native=0;
 const service=new TaskPreparationService(reopened,data,{delay:async()=>{delays++;},loadInputs:load(reopened),prepareSession:async(_role,_scope,id)=>{native++;return receipt(id);}});service.resumeQueued();await service.schedule(scope);
 assert.equal(delays,0);assert.equal(native,1);assert.deepEqual(reopened.state.workspace.deliveryRequirements!.find(task=>task.id==='DEMO-MKT-001'),main);assert.equal(taskAutomation(reopened.state,{projectId:'carddemo',taskId:'DEMO-MKT-001'}),undefined);
}));

test('obsolete native callbacks cannot mark a replaced requirement or generation ready',async()=>fixture(async(store,scope)=>{
 const pending=deferred();let nativeStarted=false;
 const service=new TaskPreparationService(store,data,{delayMs:0,loadInputs:load(store),prepareSession:async(_role,_scope,id)=>{nativeStarted=true;await pending.promise;return receipt(id);}});
 const job=service.schedule(scope);await settle(()=>nativeStarted);
 await store.transact(current=>{const next=structuredClone(current);next.workspace.deliveryRequirements=next.workspace.deliveryRequirements!.filter(task=>task.id!==scope.taskId);next.workspace.taskAutomation=next.workspace.taskAutomation!.filter(record=>record.taskId!==scope.taskId);return next;});const snapshot=JSON.stringify(store.state);
 pending.resolve();await job;assert.equal(JSON.stringify(store.state),snapshot);
}));
