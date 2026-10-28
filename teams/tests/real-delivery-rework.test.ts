import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.js';
import {readFixtures} from '../server/http-shared.js';
import {collaborationContext,collaborationWrite} from '../server/collaboration-service.js';
import {TaskPreparationService} from '../server/task-preparation.js';
import {talentNodeInputs} from '../server/talent-node-inputs.js';
import {registeredTaskSkill} from '../server/talent-intake.js';
import {createDeliveryRequirement,deliveryRequirement,returnDeliveryRequirement,acceptDeliveryRequirement} from '../src/delivery-requirements.js';
import {taskAutomation,taskNodeKnowledge,queueNextNodeKnowledge} from '../src/task-automation.js';
import {taskNodeView} from '../src/task-node-contract.js';
import {nodeResultFixture} from './node-contract-fixtures.js';
import type {RequirementNode} from '../src/delivery-requirements.js';

const data=await readFixtures();
const scope={projectId:'carddemo',taskId:'MKT-E2E-001'};
const sessionId='isolated-rework-session',runId='isolated-rework-run';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};
async function fixture(run:(store:Store,path:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'delivery-rework-')),path=join(directory,'state.json'),store=new Store(path);
 try{await store.init();await store.transact(state=>{const next=structuredClone(state);createDeliveryRequirement(next,'owner',{...scope,id:scope.taskId,title:'独立复检协议夹具',description:'只验证版本与状态，不执行原生模型',assigneeId:'member'},new Date().toISOString());return next;});await run(store,path);}finally{await rm(directory,{recursive:true,force:true});}
}
const task=(store:Store)=>deliveryRequirement(store.state,scope.projectId,scope.taskId)!;
const job=(store:Store)=>taskNodeKnowledge(taskAutomation(store.state,scope),'verify')!;
const context=(store:Store,nodeId:RequirementNode)=>collaborationContext(store.state,data,{...scope,nodeId});
async function adopt(store:Store,nodeId:RequirementNode){const current=await context(store,nodeId);return (await collaborationWrite(store,data,{kind:'inputs.adopt',role:'member',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,expectedRevision:current.revision,basisDigest:current.basisDigest,readReferences:[]}})).receipt.adoptionId;}
function submit(store:Store,nodeId:RequirementNode,adoptionId:string,codeVersion='sha-v1',failed=false){return collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,expectedRevision:store.state.revision,adoptionId,summary:'隔离复检结果声明，不是实际业务执行',...nodeResultFixture(nodeId,{codeVersion,failed})}});}
function load(state:Store['state'],selected:{projectId:string;taskId:string;nodeId?:'prepare'|'develop'|'verify'}){return talentNodeInputs({state,project:{id:selected.projectId,name:'隔离项目',generation:'test'}},data,selected.taskId,selected.nodeId!,'http://127.0.0.1:0',registeredTaskSkill,[]);}
function service(store:Store){return new TaskPreparationService(store,data,{delay:async ms=>{assert.ok(ms>19000&&ms<=20000);},loadInputs:load,prepareSession:async()=>{throw Error('rework must never create native sessions');}});}
async function firstRound(store:Store,failed=true){
 const preparer=service(store),prepareAdoption=await adopt(store,'prepare');await submit(store,'prepare',prepareAdoption);await preparer.scheduleNode(scope,'develop');
 const developmentAdoption=await adopt(store,'develop');await submit(store,'develop',developmentAdoption);await preparer.scheduleNode(scope,'verify');
 const verificationAdoption=await adopt(store,'verify');await submit(store,'verify',verificationAdoption,'sha-v1',failed);
 return{preparer,developmentAdoption,verificationAdoption};
}
function reopenDevelopment(store:Store,adoptionId:string){return collaborationWrite(store,data,{kind:'progress.add',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'develop',runId,sessionId,expectedRevision:store.state.revision,adoptionId,phase:'started',...(task(store).nodes.develop.status==='complete'?{reopen:true}:{}),summary:'处理本轮验证问题',evidence:[]}});}

test('completed development rejects stale writes atomically; explicit rework starts a fresh result round',()=>fixture(async(store,path)=>{
 const {developmentAdoption}=await firstRound(store),before=await readFile(path),previous=structuredClone(task(store).nodes.prepare);
 for(const phase of ['started','progress','blocked'] as const){
  await assert.rejects(collaborationWrite(store,data,{kind:'progress.add',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'develop',runId,sessionId,expectedRevision:store.state.revision,adoptionId:developmentAdoption,phase,summary:'stale development',evidence:[],...(phase==='blocked'?{blocker:'fixture'}:{})}}),/功能开发已完成.*nodeId=verify/);
  assert.deepEqual(await readFile(path),before);
 }
 await assert.rejects(submit(store,'develop',developmentAdoption,'sha-v2'),/功能开发已完成/);assert.deepEqual(await readFile(path),before);
 assert.equal((await context(store,'develop')).rework?.allowed,true);await reopenDevelopment(store,developmentAdoption);
 assert.equal(task(store).stage,'developing');assert.equal(task(store).nodes.develop.status,'running');assert.deepEqual(task(store).nodes.prepare,previous);assert.deepEqual(task(store).verificationCheckIds,[]);
 assert.equal(store.state.workspace.collaboration!.events.at(-1)!.reopen,true);
 const round=taskNodeView(store.state,task(store),'develop',data);assert.ok(round.deliverables.every(item=>item.references.length===0));assert.ok(round.criteria.every(item=>item.status==='pending'));
 const reloaded=new Store(path);await reloaded.init();assert.equal(task(reloaded).nodes.develop.status,'running');
}));

test('development rework cannot interrupt running verification',()=>fixture(async(store,path)=>{
 const {developmentAdoption,verificationAdoption}=await firstRound(store);
 await collaborationWrite(store,data,{kind:'progress.add',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'verify',runId,sessionId,expectedRevision:store.state.revision,adoptionId:verificationAdoption,phase:'started',summary:'verification running',evidence:[]}});
 const before=await readFile(path);assert.equal((await context(store,'develop')).rework?.allowed,false);
 await assert.rejects(reopenDevelopment(store,developmentAdoption),/reopen=true/);assert.deepEqual(await readFile(path),before);
}));

test('explicit blocked verification rework keeps history, clears current checks and still waits for human acceptance',()=>fixture(async(store,path)=>{
 const {verificationAdoption}=await firstRound(store),history=structuredClone(task(store).checks),priorDevelop=structuredClone(task(store).nodes.develop);
 assert.equal((await context(store,'verify')).rework?.allowed,true);
 const payload={kind:'progress.add',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'verify',runId,sessionId,expectedRevision:store.state.revision,adoptionId:verificationAdoption,phase:'started',reopen:true,summary:'explicit verification retry',evidence:[]}};
 await collaborationWrite(store,data,payload);assert.deepEqual(task(store).verificationCheckIds,[]);assert.deepEqual(task(store).nodes.develop,priorDevelop);
 const round=taskNodeView(store.state,task(store),'verify',data);assert.ok(round.deliverables.every(item=>item.references.length===0));assert.ok(round.criteria.every(item=>item.status==='pending'));
 await assert.rejects(collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:{...scope,nodeId:'verify',runId,sessionId,expectedRevision:store.state.revision,adoptionId:verificationAdoption,summary:'missing fresh checks',...nodeResultFixture('verify'),checks:undefined}}),/检查|来源/);
 await submit(store,'verify',verificationAdoption);
 assert.equal(task(store).stage,'awaiting-acceptance');assert.equal(task(store).nodes.accept.status,'waiting-owner');assert.equal(task(store).acceptedAt,undefined);assert.deepEqual(task(store).checks.slice(0,history.length),history);
 const before=await readFile(path);assert.equal((await collaborationWrite(store,data,payload)).replayed,true);assert.deepEqual(await readFile(path),before);
}));

test('CLI cannot accept, return or change waiting/accepted tasks, even when the assignee is Owner',()=>fixture(async(store,path)=>{
 await firstRound(store,false);
 await store.transact(state=>{const next=structuredClone(state);deliveryRequirement(next,scope.projectId,scope.taskId)!.assigneeId='owner';return next;});
 for(const stage of ['awaiting-acceptance','accepted'] as const){
  assert.equal(task(store).stage,stage);const before=await readFile(path);
  for(const nodeId of ['prepare','develop','verify','accept'] as const){
   const ctx=await context(store,nodeId);assert.deepEqual(ctx.availableActions,['context.get']);assert.equal(ctx.rework?.allowed,false);
   for(const kind of ['inputs.adopt','progress.add','result.submit']){
    await assert.rejects(collaborationWrite(store,data,{kind,role:'owner',operationId:randomUUID(),input:{...scope,nodeId,runId,sessionId,expectedRevision:store.state.revision,basisDigest:ctx.basisDigest,readReferences:[],adoptionId:'unused',phase:'started',summary:'must not mutate acceptance'}}),/验收/);
    assert.deepEqual(await readFile(path),before);
   }
  }
  for(const kind of ['accept','return','acceptance.submit'])await assert.rejects(collaborationWrite(store,data,{kind,role:'owner',operationId:randomUUID(),input:{...scope,nodeId:'accept'}}),/不支持/);
  assert.deepEqual(await readFile(path),before);
  if(stage==='awaiting-acceptance')await store.transact(state=>{const next=structuredClone(state);acceptDeliveryRequirement(next,'owner',deliveryRequirement(next,scope.projectId,scope.taskId)!,new Date().toISOString());return next;});
 }
}));

for(const reason of ['failed-checks','owner-return'] as const)test(`${reason}: new development SHA starts an explicit verification round, retaining old evidence and requiring fresh adoption`,()=>fixture(async(store,path)=>{
 const {preparer,developmentAdoption,verificationAdoption}=await firstRound(store,reason==='failed-checks');
 if(reason==='owner-return')await store.transact(state=>{const next=structuredClone(state);returnDeliveryRequirement('owner',deliveryRequirement(next,scope.projectId,scope.taskId)!,'验收发现需修正的问题',new Date().toISOString());return next;});
 const previous={knowledge:structuredClone(job(store)),snapshot:structuredClone(task(store).nodeInputSnapshots!.verify!),checks:structuredClone(task(store).checks),ledger:structuredClone(store.state.workspace.collaboration!),preparedAt:task(store).preparedAt,taskInputs:structuredClone(task(store).talentInputsSnapshot)};
 await reopenDevelopment(store,developmentAdoption);await submit(store,'develop',developmentAdoption,'sha-v2');
 assert.equal(task(store).stage,'verifying');assert.equal(task(store).nodes.verify.status,'pending');assert.equal(job(store).status,'queued');assert.equal(job(store).delayMs,20000);assert.notEqual(job(store).id,previous.knowledge.id);
 assert.equal(task(store).nodeInputSnapshots!.verify,undefined);assert.deepEqual(task(store).verificationCheckIds,[]);assert.deepEqual(task(store).checks,previous.checks);
 const archived=taskAutomation(store.state,scope)!.nodeKnowledgeHistory![0];assert.deepEqual(archived.knowledge,previous.knowledge);assert.deepEqual(archived.adoptedInputs,previous.snapshot);assert.ok(archived.adoptionIds.includes(verificationAdoption));
 assert.deepEqual(store.state.workspace.collaboration!.adoptions,previous.ledger.adoptions);assert.deepEqual(store.state.workspace.collaboration!.events.slice(0,previous.ledger.events.length),previous.ledger.events);
 assert.equal(task(store).preparedAt,previous.preparedAt);assert.deepEqual(task(store).talentInputsSnapshot,previous.taskInputs);
 const waiting=await context(store,'verify');assert.deepEqual(waiting.availableActions,['context.get']);assert.deepEqual(waiting.nodeContract!.inputs.map(item=>item.id),['requirement']);assert.ok(waiting.nodeContract!.deliverables.every(item=>item.references.length===0));assert.ok(waiting.nodeContract!.criteria.every(item=>item.status==='pending'));
 await assert.rejects(()=>adopt(store,'verify'),/知识尚未获取完成/);
 const same=JSON.stringify(taskAutomation(store.state,scope));queueNextNodeKnowledge(store.state,scope,'develop',new Date().toISOString());assert.equal(JSON.stringify(taskAutomation(store.state,scope)),same,'same upstream event is idempotent');
 await preparer.scheduleNode(scope,'verify');const ready=await context(store,'verify');assert.equal(ready.nodeContract!.inputs.find(item=>item.id==='code-change')!.references[0].codeVersion,'sha-v2');assert.equal(job(store).upstream!.find(item=>item.artifact==='code-change')!.codeVersion,'sha-v2');
 await assert.rejects(()=>submit(store,'verify',verificationAdoption,'sha-v2'),/采用依据已变化/);
 const currentAdoption=await adopt(store,'verify');await assert.rejects(()=>submit(store,'verify',currentAdoption,'sha-v1'),/产物代码版本不一致/);await submit(store,'verify',currentAdoption,'sha-v2');
 assert.equal(task(store).stage,'awaiting-acceptance');assert.equal(task(store).checks.length,previous.checks.length+4);assert.deepEqual(taskAutomation(store.state,scope)!.nodeKnowledgeHistory![0],archived);
 await store.transact(state=>{const next=structuredClone(state);acceptDeliveryRequirement(next,'owner',deliveryRequirement(next,scope.projectId,scope.taskId)!,new Date().toISOString());return next;});
 const bytes=await readFile(path),reopened=new Store(path);await reopened.init();assert.deepEqual(await readFile(path),bytes);assert.equal(task(reopened).stage,'accepted');assert.deepEqual(taskAutomation(reopened.state,scope)!.nodeKnowledgeHistory![0],archived);
 const accepted=JSON.stringify(reopened.state);queueNextNodeKnowledge(reopened.state,scope,'develop',new Date().toISOString());assert.equal(JSON.stringify(reopened.state),accepted,'accepted facts never inferred into new work');
}));

test('a late import from a superseded rework round cannot overwrite the next round or recreate its adopted snapshot',()=>fixture(async(store)=>{
 const {developmentAdoption}=await firstRound(store);await reopenDevelopment(store,developmentAdoption);await submit(store,'develop',developmentAdoption,'sha-v2');
 const starts=[deferred(),deferred()],finishes=[deferred(),deferred()];let calls=0;
 const preparer=new TaskPreparationService(store,data,{delay:async()=>{},loadInputs:async(state,selected)=>{const index=calls++;starts[index].resolve();await finishes[index].promise;return load(state,selected);},prepareSession:async()=>{throw Error('no native');}});
 const oldId=job(store).id,oldRun=preparer.scheduleNode(scope,'verify');await starts[0].promise;
 await reopenDevelopment(store,developmentAdoption);await submit(store,'develop',developmentAdoption,'sha-v3');assert.notEqual(job(store).id,oldId);
 const newRun=preparer.scheduleNode(scope,'verify');await starts[1].promise;finishes[1].resolve();await newRun;const newest=await context(store,'verify');assert.equal(newest.nodeContract!.inputs.find(item=>item.id==='code-change')!.references[0].codeVersion,'sha-v3');await adopt(store,'verify');
 const bytes=JSON.stringify(store.state);finishes[0].resolve();await oldRun;assert.equal(JSON.stringify(store.state),bytes);assert.equal(job(store).status,'ready');assert.equal(taskAutomation(store.state,scope)!.nodeKnowledgeHistory!.length,1);assert.equal(calls,2);
}));


test('a result cannot relabel original inputs as duplicate deliverables and replace the actual PRD reference',()=>fixture(async(store)=>{
 const adoptionId=await adopt(store,'prepare'),result=nodeResultFixture('prepare'),before=JSON.stringify(store.state);
 const input={...scope,nodeId:'prepare',runId,sessionId,expectedRevision:store.state.revision,adoptionId,summary:'隔离多证据成果',...result};
 await assert.rejects(()=>collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:{...input,evidence:[...result.evidence,{...result.evidence[0],value:'fixture://original-requirement',description:'原始需求'},{...result.evidence[0],value:'fixture://test-profile',description:'测试口径'}]}}),/产物类型不可重复：prd/);
 assert.equal(JSON.stringify(store.state),before,'rejected result leaves nodes, ledger and queued jobs unchanged');
 await collaborationWrite(store,data,{kind:'result.submit',role:'member',operationId:randomUUID(),input:{...input,evidence:[...result.evidence,{kind:'reference',value:'fixture://original-requirement',description:'原始需求输入佐证'},{kind:'reference',value:'fixture://test-profile',description:'测试口径输入佐证'}]}});
 assert.equal(task(store).nodes.prepare.status,'complete');const upstream=taskNodeKnowledge(taskAutomation(store.state,scope),'develop')!.upstream!;assert.equal(upstream.length,1);assert.equal(upstream[0].value,result.evidence[0].value);
}));
