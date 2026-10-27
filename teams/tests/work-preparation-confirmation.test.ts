import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.js';
import {TaskPreparationService} from '../server/task-preparation.js';
import {assignDeliveryRequirement,deliveryRequirement} from '../src/delivery-requirements.js';
import {mainTask,taskAutomation} from '../src/task-automation.js';
import {readFixtures} from '../server/http-shared.js';

// Explicit preparation of the old MKT-001 record; no native transport/model is invoked.
test('explicit pristine main-task preparation is actor scoped and concurrently idempotent; read/startup does not queue it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'confirm-main-')),store=new Store(join(dir,'state.json'));await store.init();
 let release!:()=>void,delays=0;const wait=new Promise<void>(done=>release=done);
 try{
  await store.transact(current=>{const next=structuredClone(current);assignDeliveryRequirement(next,'owner',{...mainTask,assigneeId:'member'},new Date().toISOString());return next;});
  const before=JSON.stringify(store.state);const service=new TaskPreparationService(store,await readFixtures(),{delay:async()=>{delays++;await wait;},loadInputs:async()=>{throw new Error('intentional isolated stop before native');},prepareSession:async()=>{throw new Error('must not call native');}});
  service.resumeQueued();assert.equal(JSON.stringify(store.state),before);assert.equal(taskAutomation(store.state,mainTask)?.preparation,undefined);
  await assert.rejects(service.retry('owner',mainTask),/当前交付人/);assert.equal(JSON.stringify(store.state),before);
  await Promise.all([service.retry('member',mainTask),service.retry('member',mainTask)]);
  const job=taskAutomation(store.state,mainTask)!.preparation!;const id=job.id;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(delays,1);assert.equal(store.state.audit.filter(item=>item.action==='确认准备 iCode 会话').length,1);assert.equal(taskAutomation(store.state,mainTask)!.preparation!.id,id);
  const task=deliveryRequirement(store.state,mainTask.projectId,mainTask.taskId)!;assert.equal(task.preparedAt,undefined);assert.equal(task.stage,'preparing');assert.ok(Object.values(task.nodes).every(node=>node.status==='pending'));
  release();await service.schedule(mainTask,true);assert.equal(taskAutomation(store.state,mainTask)!.preparation!.status,'failed');assert.equal(taskAutomation(store.state,mainTask)!.preparation!.session,undefined);
 }finally{release?.();await rm(dir,{recursive:true,force:true});}
});

test('explicit initial preparation never resets adopted inputs, later nodes or already ready historical knowledge',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'confirm-guard-')),store=new Store(join(dir,'state.json'));await store.init();
 try{
  await store.transact(current=>{const next=structuredClone(current);assignDeliveryRequirement(next,'owner',{...mainTask,assigneeId:'member'},new Date().toISOString());return next;});
  const service=new TaskPreparationService(store,await readFixtures(),{prepareSession:async()=>{throw new Error('must not run');}});
  for(const mode of ['adopted','running','knowledge'] as const){
   await store.transact(current=>{const next=structuredClone(current),task=deliveryRequirement(next,mainTask.projectId,mainTask.taskId)!;delete task.preparedAt;task.nodes.prepare.status='pending';delete next.workspace.taskAutomation;
    if(mode==='adopted')task.preparedAt=new Date().toISOString();
    if(mode==='running')task.nodes.prepare.status='running';
    if(mode==='knowledge')next.workspace.taskAutomation=[{...mainTask,sessions:[],knowledge:{id:'existing',status:'ready',attempts:1,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}}];return next;});
   const before=JSON.stringify(store.state);await assert.rejects(service.retry('member',mainTask),/已有执行或输入/);assert.equal(JSON.stringify(store.state),before);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
