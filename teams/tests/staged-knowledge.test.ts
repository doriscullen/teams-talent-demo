import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.js';
import {TaskPreparationService} from '../server/task-preparation.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import {queueTaskPreparation,queueNextNodeKnowledge,taskAutomation,taskNodeKnowledge,type KnowledgeNode,type TaskScope} from '../src/task-automation.js';
import {taskNodeView} from '../src/task-node-contract.js';
import {readTalentNodeInputs} from '../server/talent-node-client.js';
import {talentNodeInputs} from '../server/talent-node-inputs.js';
import {registeredTaskSkill} from '../server/talent-intake.js';
import {nodeResultFixture} from './node-contract-fixtures.js';
const data:any={...JSON.parse(await readFile('fixtures/presentation.json','utf8')),teamsProject:JSON.parse(await readFile('fixtures/teams-project.json','utf8'))};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};
async function settle(check:()=>boolean){for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('state not reached');}
async function fixture(run:(store:Store,scope:TaskScope,path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'staged-knowledge-')),path=join(dir,'state.json'),store=new Store(path);await store.init();const scope={projectId:'carddemo',taskId:'REQ-'+randomUUID()};await store.transact(state=>{const next=structuredClone(state);createDeliveryRequirement(next,'owner',{projectId:scope.projectId,id:scope.taskId,title:'独立库存说明',description:'库存单位与刷新时间待确认',assigneeId:'member'},new Date().toISOString());queueTaskPreparation(next,scope,new Date().toISOString());return next;});try{await run(store,scope,path);}finally{await rm(dir,{recursive:true,force:true});}}
async function upstream(store:Store,scope:TaskScope,node:'prepare'|'develop',version='v1'){await store.transact(state=>{const next=structuredClone(state),task=next.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!,result=nodeResultFixture(node,{codeVersion:'protocol-code-'+version});next.workspace.collaboration??={adoptions:[],events:[],operations:[]};next.workspace.collaboration.events.push({id:randomUUID(),operationId:randomUUID(),...scope,nodeId:node,role:'member',runId:'unit-run',sessionId:'unit-session',adoptionId:'unit-adoption',phase:'result',summary:'isolated upstream fixture',blocker:null,evidence:result.evidence.map(item=>({...item,version})),completedCriteria:result.completedCriteria,at:new Date().toISOString(),revision:++next.revision});task.nodes[node].status='complete';queueNextNodeKnowledge(next,scope,node,new Date().toISOString());return next;});}
const load=(state:Store['state'],scope:TaskScope&{nodeId?:KnowledgeNode})=>talentNodeInputs({state,project:{id:scope.projectId,name:'isolated',generation:'test'}},data,scope.taskId,scope.nodeId??'prepare','http://127.0.0.1:0',registeredTaskSkill,[]);

test('each downstream job waits 20 seconds only after its upstream event; imports one node and pins shared reference IDs and versions',()=>fixture(async(store,scope)=>{
 const waits=[deferred(),deferred()],durations:number[]=[],loaded:string[]=[];
 const service=new TaskPreparationService(store,data,{delay:async ms=>{durations.push(ms);await waits[durations.length-1].promise;},loadInputs:async(state,selected)=>{loaded.push(selected.nodeId!);return load(state,selected);},prepareSession:async()=>{throw Error('later nodes must not create a session');}});
 await service.scheduleNode(scope,'develop');assert.equal(durations.length,0);assert.equal(taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!.status,'waiting-upstream');
 await upstream(store,scope,'prepare');const first=service.scheduleNode(scope,'develop');assert.equal(service.scheduleNode(scope,'develop'),first);await settle(()=>durations.length===1);assert.ok(durations[0]>19000&&durations[0]<=20000);assert.deepEqual(loaded,[]);
 const hidden=await readTalentNodeInputs(store.state,data,{...scope,nodeId:'develop'});assert.equal(hidden.skills.length,0);const task=store.state.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!;assert.deepEqual(taskNodeView(store.state,task,'develop',data,hidden).inputs.map(item=>item.id),['requirement']);
 waits[0].resolve();await first;const job=taskNodeKnowledge(taskAutomation(store.state,scope),'develop')!;assert.equal(job.status,'ready');assert.equal(job.upstream![0].version,'v1');assert.deepEqual(await readTalentNodeInputs(store.state,data,{...scope,nodeId:'develop'}),job.nodeInputs);assert.equal(taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!.status,'waiting-upstream');
 await upstream(store,scope,'develop');const second=service.scheduleNode(scope,'verify');await settle(()=>durations.length===2);assert.ok(durations[1]>19000&&durations[1]<=20000);assert.deepEqual(loaded,['develop']);waits[1].resolve();await second;
 const verify=taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!;assert.equal(verify.status,'ready');assert.equal(verify.upstream!.find(item=>item.artifact==='prd')!.id,job.upstream![0].id);assert.deepEqual(loaded,['develop','verify']);assert.equal(taskAutomation(store.state,scope)!.preparation!.status,'queued');
 const bytes=JSON.stringify(verify);await store.transact(state=>{const next=structuredClone(state);queueNextNodeKnowledge(next,scope,'develop',new Date().toISOString());return next;});await service.scheduleNode(scope,'verify');assert.equal(JSON.stringify(taskNodeKnowledge(taskAutomation(store.state,scope),'verify')),bytes);assert.equal(loaded.length,2);
}));

test('saved running jobs resume remaining time; explicit failure retry keeps identity, and adopted caches are not replaced',()=>fixture(async(store,scope,path)=>{
 await upstream(store,scope,'prepare');await store.transact(state=>{const next=structuredClone(state),job=taskNodeKnowledge(taskAutomation(next,scope),'develop')!;job.status='running';job.attempts=1;job.startedAt=new Date(Date.now()-21000).toISOString();return next;});
 const reopened=new Store(path);await reopened.init();let reads=0,waits=0;const service=new TaskPreparationService(reopened,data,{delay:async()=>{waits++;},loadInputs:async(state,selected)=>{if(++reads===1)throw Error('explicit source outage');return load(state,selected);},prepareSession:async()=>{throw Error('no native');}});
 await service.scheduleNode(scope,'develop');let job=taskNodeKnowledge(taskAutomation(reopened.state,scope),'develop')!;assert.equal(job.status,'failed');assert.match(job.error!,/source outage/);assert.equal(waits,0);const id=job.id;await service.scheduleNode(scope,'develop');assert.equal(reads,1);await service.retryNode('member',scope,'develop');await service.scheduleNode(scope,'develop',true);job=taskNodeKnowledge(taskAutomation(reopened.state,scope),'develop')!;assert.equal(job.id,id);assert.equal(job.status,'ready');assert.equal(reads,2);assert.equal(waits,1);
 await reopened.transact(state=>{const next=structuredClone(state),task=next.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!;task.nodeInputSnapshots={develop:structuredClone(job.nodeInputs!)};return next;});const before=await readFile(path);await service.scheduleNode(scope,'develop',true);assert.deepEqual(await readFile(path),before);assert.equal(reads,2);
}));

test('legacy prepare caches and task history never satisfy another node or acquire new jobs on restart',()=>fixture(async(store,scope)=>{
 const record=taskAutomation(store.state,scope)!;delete record.nodeKnowledge;delete record.preparation;record.knowledge!.status='ready';delete record.knowledge!.delayMs;const before=JSON.stringify(store.state);let calls=0;new TaskPreparationService(store,data,{prepareSession:async()=>{calls++;throw Error('no native');},loadInputs:async(state,selected)=>{calls++;return load(state,selected);}}).resumeQueued();assert.equal(taskNodeKnowledge(record,'develop'),undefined);assert.equal(taskNodeKnowledge(record,'prepare'),record.knowledge);assert.equal(JSON.stringify(store.state),before);assert.equal(calls,0);
}));


test('new upstream versions invalidate only unadopted ready inputs; the same basis remains idempotent',()=>fixture(async(store,scope)=>{
 let imports=0;
 const service=new TaskPreparationService(store,data,{delay:async()=>{},loadInputs:async(state,selected)=>{imports++;return load(state,selected);},prepareSession:async()=>{throw Error('no native');}});
 await upstream(store,scope,'prepare');await upstream(store,scope,'develop','v1');await service.scheduleNode(scope,'verify');
 const old=structuredClone(taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!);assert.equal(old.status,'ready');
 await store.transact(state=>{const next=structuredClone(state);queueNextNodeKnowledge(next,scope,'develop',new Date().toISOString());return next;});
 assert.deepEqual(taskNodeKnowledge(taskAutomation(store.state,scope),'verify'),old);assert.equal(imports,1);
 await upstream(store,scope,'develop','v2');const queued=taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!;
 assert.notEqual(queued.id,old.id);assert.notEqual(queued.basisKey,old.basisKey);assert.equal(queued.status,'queued');assert.equal(queued.delayMs,20000);assert.equal(queued.nodeInputs,undefined);assert.equal(queued.attempts,0);
 assert.equal((await readTalentNodeInputs(store.state,data,{...scope,nodeId:'verify'})).skills.length,0);
 await service.scheduleNode(scope,'verify');const ready=taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!;
 assert.equal(ready.status,'ready');assert.equal(imports,2);assert.equal(ready.upstream!.find(item=>item.artifact==='code-change')!.version,'v2');assert.equal(ready.upstream!.find(item=>item.artifact==='code-change')!.codeVersion,'protocol-code-v2');
 const task=store.state.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!;
 assert.equal(taskNodeView(store.state,task,'verify',data,ready.nodeInputs).inputs.find(item=>item.id==='code-change')!.references[0].version,'v2');
 assert.equal(store.state.workspace.collaboration!.events.filter(event=>event.nodeId==='develop').length,2,'prior upstream evidence remains');
 await store.transact(state=>{const next=structuredClone(state);next.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!.nodeInputSnapshots={verify:structuredClone(ready.nodeInputs!)};return next;});
 const frozen=JSON.stringify(store.state.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!.nodeInputSnapshots),saved=JSON.stringify(ready);
 await upstream(store,scope,'develop','v3');await service.scheduleNode(scope,'verify');
 assert.equal(JSON.stringify(taskNodeKnowledge(taskAutomation(store.state,scope),'verify')),saved,'adopted acquisition is not silently replaced');
 assert.equal(JSON.stringify(store.state.workspace.deliveryRequirements!.find(item=>item.id===scope.taskId)!.nodeInputSnapshots),frozen);assert.equal(imports,2);
}));

test('an older asynchronous import cannot mark a replacement upstream job ready or overwrite its inputs',()=>fixture(async(store,scope)=>{
 const started=[deferred(),deferred()],finish=[deferred(),deferred()];let calls=0;
 const service=new TaskPreparationService(store,data,{delay:async()=>{},loadInputs:async(state,selected)=>{const index=calls++;started[index].resolve();await finish[index].promise;return load(state,selected);},prepareSession:async()=>{throw Error('no native');}});
 await upstream(store,scope,'prepare','v1');const oldJob=taskNodeKnowledge(taskAutomation(store.state,scope),'develop')!.id,oldRun=service.scheduleNode(scope,'develop');await started[0].promise;
 await upstream(store,scope,'prepare','v2');const nextJob=taskNodeKnowledge(taskAutomation(store.state,scope),'develop')!.id;assert.notEqual(nextJob,oldJob);
 const newRun=service.scheduleNode(scope,'develop');await started[1].promise;finish[1].resolve();await newRun;
 const ready=taskNodeKnowledge(taskAutomation(store.state,scope),'develop')!;assert.equal(ready.id,nextJob);assert.equal(ready.status,'ready');assert.equal(ready.upstream![0].version,'v2');const before=JSON.stringify(store.state);
 finish[0].resolve();await oldRun;assert.equal(JSON.stringify(store.state),before,'superseded result causes no state write');assert.equal(calls,2);
}));
