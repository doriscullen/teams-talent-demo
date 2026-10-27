import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState,transition,type DemoState } from '../src/domain.js';
import { Store } from '../server/store.js';
import { TaskAutomationService } from '../server/task-automation.js';
import { mainTask,taskAutomation,collectTaskSessions,type ImportedTaskInputs } from '../src/task-automation.js';
import { updateWorkspace } from '../src/workspace.js';
import { taskAssigneeId,taskAssigneeName } from '../src/task-assignment.js';
import { projectOverview } from '../src/project-overview.js';
import { collaborationContext } from '../server/collaboration-service.js';
const data:any={...JSON.parse(await readFile('fixtures/presentation.json','utf8')),teamsProject:JSON.parse(await readFile('fixtures/teams-project.json','utf8'))};
const ready:ImportedTaskInputs={mode:'preparation',contextId:null,requirement:'信用卡消费返现',knowledge:[{id:'knowledge:carddemo:1',title:'资格规则',version:'knowledge-v1'}],knowledgeStatus:'available',skills:[{id:'dev-frontend-ui',version:'1.0.0',available:true}],references:[],materials:[],notes:[]};
const assigned=()=>transition(initialState(),'assign','owner',{assigneeId:'member'});
const submitted=()=>{let s=assigned();for(const [action,role]of [['knowledge','owner'],['prepare','member'],['replay','member'],['check-fail','member'],['fix','member'],['submit','member'],['purchase','owner'],['deduplicate','owner'],['uat','owner']] as const)s=transition(s,action,role);return s;};
async function using(state:DemoState,run:(store:Store,path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'task-auto-'));try{const path=join(dir,'state.json');await writeFile(path,JSON.stringify(state));const store=new Store(path);await store.init();await run(store,path);}finally{await rm(dir,{recursive:true,force:true});}}

test('Owner selects a real active member and can reassign without changing delivery evidence',async()=>{
 let state=transition(initialState(),'assign','owner',{assigneeId:'su'});assert.equal(taskAssigneeName(state),'苏晴');assert.equal(projectOverview(state,data,'carddemo').requirements[0].owner,'苏晴');assert.match(state.audit.at(-1)!.detail,/苏晴/);
 assert.throws(()=>transition(state,'prepare','member'),/不能代其推进/);
 for(const assigneeId of ['unknown',''])assert.throws(()=>transition(initialState(),'assign','owner',{assigneeId}),/有效的项目成员/);
 const invited=initialState();invited.workspace.team.members.find(member=>member.id==='su')!.status='invited';assert.throws(()=>transition(invited,'assign','owner',{assigneeId:'su'}),/有效的项目成员/);
 assert.throws(()=>transition(state,'assign','member',{assigneeId:'member'}),/无权/);
 state=transition(state,'assign','owner',{assigneeId:'member'});state=transition(state,'knowledge','owner');state=transition(state,'prepare','member');
 const frozen=structuredClone(state.context);state=transition(state,'assign','owner',{assigneeId:'yang'});assert.equal(taskAssigneeName(state),'杨帆');assert.deepEqual(state.context,frozen);assert.equal(state.stage,'assigned');
 assert.throws(()=>updateWorkspace(state,'member.remove','owner',{teamId:'carddemo',id:'yang'}),/先调整/);
 await using(state,async(store,path)=>{assert.equal(taskAssigneeId(store.state),'yang');const previousFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({assets:[]}));try{const context=await collaborationContext(store.state,data,{...mainTask,nodeId:'prepare'});assert.deepEqual((context.agreement as any).assignee,{id:'yang',name:'杨帆'});}finally{globalThis.fetch=previousFetch;}assert.equal(JSON.parse(await readFile(path,'utf8')).assigneeId,'yang');});
 assert.throws(()=>transition(transition(submitted(),'accept','owner'),'assign','owner',{assigneeId:'su'}),/已验收/);
});

test('legacy fixed assignee is preserved through migration and corrupt authoritative assignments are rejected',async()=>{
 const legacy=assigned();delete legacy.assigneeId;await using(legacy,async(store,path)=>{assert.equal(store.state.assigneeId,'member');assert.equal(await readFile(path+'.pre-unified-delivery.json','utf8'),JSON.stringify(legacy));const bad=structuredClone(store.state);bad.workspace.deliveryRequirements!.find(task=>task.id==='DEMO-MKT-001')!.assigneeId='not-a-member';await writeFile(path,JSON.stringify(bad));await assert.rejects(new Store(path).init(),/交付人记录无效|项目交付人与所属团队不一致/);assert.equal(await readFile(path,'utf8'),JSON.stringify(bad));});
});

test('knowledge import is per-task and concurrent/refresh/reassignment never repeat or freeze it',async()=>{
 await using(assigned(),async(store,path)=>{let reads=0;const dependencies={async inputs(){reads++;return ready;},async collect(){return [];}};const service=new TaskAutomationService(store,data,dependencies);
 const [one,two]=await Promise.all([service.prepare('member',mainTask),service.prepare('member',mainTask)]);assert.deepEqual(one,two);assert.equal(reads,1);assert.equal(store.state.context,null);assert.equal(store.state.stage,'assigned');const id=taskAutomation(store.state,mainTask)!.knowledge!.id;
 await store.apply(store.state.revision,'assign','owner',{assigneeId:'su'});assert.throws(()=>service.prepare('member',mainTask),/仅当前需求交付人/);
 await store.apply(store.state.revision,'assign','owner',{assigneeId:'member'});await service.prepare('member',mainTask);const loaded=new Store(path);await loaded.init();await new TaskAutomationService(loaded,data,dependencies).prepare('member',mainTask);assert.equal(reads,1);assert.equal(taskAutomation(loaded.state,mainTask)!.knowledge!.id,id);assert.equal(taskAutomation(loaded.state,mainTask)!.knowledge!.attempts,1);
 assert.throws(()=>service.prepare('owner',mainTask),/交付人/);assert.throws(()=>service.prepare('member',{projectId:'teams',taskId:'T104'}),/只读/);
 });
});

test('missing input and read failure are explicit; only explicit retry rechecks the same execution',async()=>{
 await using(assigned(),async(store)=>{let calls=0;const service=new TaskAutomationService(store,data,{async inputs(){calls++;if(calls===1)return {...ready,knowledge:[],skills:[],knowledgeStatus:'not-built'};if(calls===2)throw new Error('知识连接不可用');return ready;},async collect(){return [];}});
 await service.prepare('member',mainTask);const id=taskAutomation(store.state,mainTask)!.knowledge!.id;assert.equal(taskAutomation(store.state,mainTask)!.knowledge!.status,'waiting');await service.prepare('member',mainTask);assert.equal(calls,1);
 await service.prepare('member',mainTask,true);assert.equal(taskAutomation(store.state,mainTask)!.knowledge!.status,'failed');assert.match(taskAutomation(store.state,mainTask)!.knowledge!.error!,/不可用/);await service.prepare('member',mainTask);assert.equal(calls,2);
 await service.prepare('member',mainTask,true);assert.equal(taskAutomation(store.state,mainTask)!.knowledge!.status,'ready');assert.equal(taskAutomation(store.state,mainTask)!.knowledge!.id,id);assert.equal(store.state.context,null);
 });
});

test('acceptance collects exact task session identities across nodes once, without losing acceptance on failure',async()=>{
 let state=assigned();state=transition(state,'knowledge','owner');state=transition(state,'prepare','member');
 for(const [nodeId,sessionId,tool]of [['develop','one','icode'],['verify','one','icode'],['verify','two','opencode']]as const)state=updateWorkspace(state,'session.link','member',{...mainTask,nodeId,sessionId,tool});
 const event=(projectId:string,taskId:string,nodeId:string,sessionId:string)=>({id:sessionId,operationId:sessionId,projectId,taskId,nodeId,sessionId,runId:'run-'+nodeId,role:'member' as const,adoptionId:'a',phase:'progress' as const,summary:'actual progress',blocker:null,evidence:[],at:'2026-10-27T00:00:00Z',revision:1});
 state.workspace.collaboration={adoptions:[],operations:[],events:[event('carddemo','DEMO-MKT-001','verify','one'),event('teams','T104','develop','foreign'),event('carddemo','another','develop','other'),event('carddemo','DEMO-MKT-001','prepare','prepare-only')]};
 const sessions=collectTaskSessions(state,mainTask);assert.equal(sessions.length,2);assert.deepEqual(sessions[0].nodeIds,['develop','verify']);assert.deepEqual(sessions[0].sources,['成员关联','Teams CLI 回传']);
 await using(state,async(store)=>{const service=new TaskAutomationService(store,data,{async inputs(){return ready;},async collect(state,scope){return collectTaskSessions(state,scope);}});assert.throws(()=>service.collect(),/尚未通过/);assert.equal(taskAutomation(store.state,mainTask)?.collection,undefined);});
 for(const[action,role]of [['replay','member'],['check-fail','member'],['fix','member'],['submit','member'],['purchase','owner'],['deduplicate','owner'],['uat','owner']]as const)state=transition(state,action,role);
 const returned=transition(state,'return','owner',{reason:'补充材料'});assert.equal(taskAutomation(returned,mainTask)?.collection,undefined);
 state=transition(state,'accept','owner');await using(state,async(store,path)=>{let calls=0;const service=new TaskAutomationService(store,data,{async inputs(){return ready;},async collect(state,scope){calls++;if(calls===1)throw new Error('归集读取失败');return collectTaskSessions(state,scope);}});
 await service.collect();assert.equal(store.state.stage,'accepted');assert.equal(taskAutomation(store.state,mainTask)!.collection!.status,'failed');const id=taskAutomation(store.state,mainTask)!.collection!.id;await service.collect();assert.equal(calls,1);
 await Promise.all([service.collect(mainTask,true),service.collect(mainTask,true)]);assert.equal(calls,2);assert.equal(taskAutomation(store.state,mainTask)!.collection!.sessions.length,2);assert.equal(taskAutomation(store.state,mainTask)!.collection!.id,id);assert.equal(store.state.workspace.sessionReported,false);assert.equal(taskAutomation(store.state,mainTask)!.collection!.reporting!.status,'pending');
 const restored=new Store(path);await restored.init();await new TaskAutomationService(restored,data,{async inputs(){return ready;},async collect(){throw new Error('must not rerun');}}).collect();assert.equal(restored.state.stage,'accepted');assert.throws(()=>transition(restored.state,'accept','owner'),/旧演练推进入口已停用/);
 });
});

test('zero sessions stays empty and does not invent Talent delivery',async()=>{await using(transition(submitted(),'accept','owner'),async(store)=>{const service=new TaskAutomationService(store,data,{async inputs(){return ready;},async collect(){return [];}});await service.collect();assert.equal(taskAutomation(store.state,mainTask)!.collection!.status,'empty');assert.equal(store.state.workspace.sessionReported,false);assert.equal(store.state.stage,'accepted');assert.equal(store.state.evolution,'none');});});
