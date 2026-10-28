import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {migrateMainDelivery} from '../server/delivery-migration.js';
import { initialState } from '../src/domain.js';
import { updateWorkspace } from '../src/workspace.js';
import { readFixtures } from '../server/http-shared.js';
import { ProjectWorkService, resolveProjectWork, type WorkTransport } from '../server/project-work.js';
import { sessionId, workspace } from '../server/config.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
const fixtures = await readFixtures();
function workingMain(role:'owner'|'member'='member'){const state=initialState();state.assigned=true;state.assigneeId=role;state.stage='assigned';migrateMainDelivery(state);return state;}
function transport() {
  const calls: any[] = []; let active = false, fail = false, terminal = 'ghostty';
  const value: WorkTransport = { defaults: async () => ({agent:'role',agentLabel:'Code',model:'model',modelLabel:'Model',terminal:{id:terminal,name:terminal==='ghostty'?'Ghostty':'Terminal',error:undefined}}), history: async () => ({available:true,directory:workspace,title:'history',configuration:{agent:'original-role',agentLabel:'Original',model:'original-model',modelLabel:'Original model'},active:active?{pid:123,application:'Ghostty',tty:'ttys123',terminal:{id:'surface',title:'history',directory:workspace}}:null}), start: async input => { calls.push(input); if(fail)throw new Error('transport uncertain'); return { terminal: 'PowerShell' }; }, focus:async input=>{calls.push(input);return {status:'terminal-focused',note:'focused known terminal'};} };
  return {value,calls,setTerminal:(value:string)=>terminal=value,setActive:()=>active=true,setFail:()=>fail=true};
}
test('work resolves precise Card/Teams/new-project scope and does not substitute Card history', async () => {
  const dir=await mkdtemp(join(tmpdir(),'work-scope-')), t=transport();let state=initialState();
  try {
    const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir), before=JSON.stringify(state);
    const plan=await service.plan('member',{projectId:'carddemo',tab:'delivery',nodeId:'prepare'});
    assert.equal(plan.target.taskId,'DEMO-MKT-001');assert.equal(plan.context.frozen,false);assert.equal(plan.defaultAction,'new');assert.equal(plan.history,undefined);
    const teams=await service.plan('owner',{projectId:'teams',tab:'delivery',taskId:'T104',nodeId:'review'});
    assert.equal(teams.target.taskId,'T104');assert.equal(teams.history,undefined);assert.equal(teams.actions[0].enabled,false);
    assert.throws(()=>resolveProjectWork(state,fixtures,{projectId:'teams',tab:'delivery',taskId:'DEMO-MKT-001'}),/不存在/);
    assert.equal(JSON.stringify(state),before);assert.equal(t.calls.length,0);
    const p={id:randomUUID(),name:'New',description:'',remoteUrl:'https://github.com/example/new.git',repositoryIdentity:'github.com/example/new'};
    state=updateWorkspace(state,'project.create','owner',p);
    const created=await service.plan('member',{projectId:p.id,tab:'content'});assert.equal(created.history,undefined);assert.equal(created.target.taskId,undefined);assert.equal(created.directory.valid,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('one confirmation pins scope/config, repeated request does not launch again, changed basis is rejected', async () => {
  const dir=await mkdtemp(join(tmpdir(),'work-start-')), t=transport();let state=workingMain();
  try {
    const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir), before=JSON.stringify(state), plan=await service.plan('member',{projectId:'carddemo',tab:'delivery',nodeId:'develop'});
    const body={requestId:randomUUID(),target:plan.target,action:'new' as const,planToken:plan.planToken};
    const [one,two]=await Promise.all([service.start('member',body),service.start('member',body)]);assert.deepEqual(one,two);assert.equal(t.calls.length,1);assert.equal(one.sessionId,null);assert.equal(one.terminal,'PowerShell');assert.match(one.note,/PowerShell/);assert.equal(t.calls[0].terminal,'ghostty');assert.equal(t.calls[0].agent,'role');assert.equal(t.calls[0].sessionId,undefined);
    const context=await readFile(one.contextPath,'utf8');assert.match(context,/DEMO-MKT-001/);assert.match(context,/develop/);assert.match(context,/teams-demo-collaboration/);assert.match(context,/context.*get/);assert.match(context,/--input-file/);assert.deepEqual(JSON.parse(await readFile(join(dir,'work-contexts',body.requestId+'.scope.json'),'utf8')),plan.target);assert.equal(JSON.stringify(state),before);
    await assert.rejects(service.start('member',{...body,action:'resume'}),/另一项/);
    state={...state,revision:state.revision+1};await assert.rejects(service.start('member',{...body,requestId:randomUUID()}),/依据已变化/);
    assert.equal(t.calls.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('old restore actions are unavailable and launch uncertainty is retained',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'work-current-')), t=transport(),state=workingMain('owner');t.setActive();
  try{
    const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir),plan=await service.plan('owner',{projectId:'carddemo',tab:'delivery',nodeId:'prepare'});
    assert.deepEqual(plan.actions.map(a=>a.id),['new']);assert.equal(plan.history,undefined);
    await assert.rejects(service.start('owner',{requestId:randomUUID(),target:plan.target,action:'focus',planToken:plan.planToken}), /不可用/);
    t.setFail();const body={requestId:randomUUID(),target:plan.target,action:'new' as const,planToken:plan.planToken};await assert.rejects(service.start('owner',body),/待核对/);const again=await service.start('owner',body);assert.equal(again.status,'uncertain');assert.equal(t.calls.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('directory binding is role/project scoped, verifies Git origin, and rejects reference checkout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'work-bind-')), repo=join(dir,'repo'),wrong=join(dir,'wrong'),reference=join(dir,'reference'), t=transport();let state=initialState();
  try{
    await mkdir(reference);
    for(const path of [repo,wrong]){await mkdir(path);execFileSync('git',['init','-q',path]);execFileSync('git',['-C',path,'remote','add','origin',path===repo?'https://github.com/example/new.git':'https://github.com/example/wrong.git']);}
    const p={id:randomUUID(),name:'New',description:'',remoteUrl:'https://github.com/example/new.git',repositoryIdentity:'github.com/example/new'};state=updateWorkspace(state,'project.create','owner',p);const before=JSON.stringify(state);
    const service=new ProjectWorkService(()=>state,{...fixtures,baseline:{...fixtures.baseline,sourceRoot:reference}},dir,t.value,undefined,dir),target={projectId:p.id,tab:'content'};
    await assert.rejects(service.bind('member',target,wrong),/origin/);await assert.rejects(service.bind('member',target,reference),/只读/);
    const withoutReference = new ProjectWorkService(()=>state,{...fixtures,baseline:{...fixtures.baseline,sourceRoot:join(dir,'reference-not-shipped')}},join(dir,'relocated-state'),t.value,undefined,dir);
    assert.equal((await withoutReference.bind('member',target,repo)).directory.valid,true);
    assert.equal((await service.bind('member',target,repo)).directory.valid,true);assert.equal((await service.plan('owner',target)).directory.valid,false);
    const plan=await service.plan('member',target);const receipt=await service.start('member',{requestId:randomUUID(),target,action:'new',planToken:plan.planToken});assert.equal(receipt.directory,await realpath(repo));assert.equal(receipt.sessionId,null);assert.equal(JSON.stringify(state),before);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('old resume request is rejected before launching any native work',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'work-resume-')),t=transport(),state=initialState();
  try {const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir),plan=await service.plan('member',{projectId:'carddemo',tab:'delivery',nodeId:'prepare'});await assert.rejects(service.start('member',{requestId:randomUUID(),target:plan.target,action:'resume',planToken:plan.planToken}), /不可用/);assert.equal(t.calls.length,0);}finally{await rm(dir,{recursive:true,force:true});}
});

test('changing saved terminal invalidates the confirmation while active focus remains on its original terminal', async () => {
  const dir=await mkdtemp(join(tmpdir(),'work-terminal-')), t=transport(), state=workingMain('owner');
  try {
    const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir), plan=await service.plan('owner',{projectId:'carddemo',tab:'delivery'});
    assert.equal(plan.instance.terminal?.name,'Ghostty');t.setTerminal('terminal');
    await assert.rejects(service.start('owner',{requestId:randomUUID(),target:plan.target,action:'new',planToken:plan.planToken}),/依据已变化/);assert.equal(t.calls.length,0);
    t.setActive();const current=await service.plan('owner',plan.target);assert.equal(current.instance.terminal?.name,'Terminal');assert.equal(current.history,undefined);
    await service.start('owner',{requestId:randomUUID(),target:current.target,action:'new',planToken:current.planToken});assert.equal(t.calls.length,1);assert.equal(t.calls[0].terminal,'terminal');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('independent delivery work pins its own task/directory and sends a real native task file without touching the main requirement', async () => {
  const dir=await mkdtemp(join(tmpdir(),'work-delivery-')), repo=join(dir,'source'), t=transport(), state=initialState();
  await mkdir(repo);execFileSync('git',['init','-q',repo]);
  const task=createDeliveryRequirement(state,'owner',{id:'MKT-E2E-UNIT',projectId:'carddemo',title:'独立试算需求',description:'只验证当前三项已确认规则',assigneeId:'member',skillIds:['dev-code-reviewer'],workDirectory:await realpath(repo)},new Date().toISOString());
  const originalStage=state.stage,originalContext=state.context;
  try {
    const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir), target={projectId:'carddemo',tab:'delivery',taskId:task.id,nodeId:'prepare'};
    const plan=await service.plan('member',target);
    assert.equal(plan.target.taskId,task.id);assert.equal(plan.target.requirementId,task.id);assert.equal(plan.title,task.title);assert.equal(plan.directory.root,await realpath(repo));assert.equal(plan.directory.valid,true);assert.deepEqual(plan.context.selectedSkills,[]);
    assert.throws(()=>resolveProjectWork(state,fixtures,{...target,requirementId:'DEMO-MKT-001'}),/不一致/);
    const ownerPlan=await service.plan('owner',target);assert.equal(ownerPlan.actions[0].enabled,false);assert.match(ownerPlan.actions[0].reason!,/交付人/);
    const requestId=randomUUID(),receipt=await service.start('member',{requestId,target,action:'new',planToken:plan.planToken});
    assert.deepEqual(t.calls[0].task,{runId:requestId,path:receipt.contextPath,scope:{projectId:'carddemo',taskId:task.id,nodeId:'prepare'}});
    assert.equal(plan.executionMode,'interactive');assert.equal(receipt.executionMode,'interactive');const prompt=await readFile(receipt.contextPath,'utf8');assert.match(prompt,/本次进入时所选节点为 prepare/);assert.match(prompt,/不自动连跑/);assert.match(prompt,/本次交互工作范围/);assert.match(prompt,/native-session\.json/);assert.match(prompt,/停在待 Owner 验收/);assert.match(prompt,/不得修改 Teams\/Talents 应用工程/);
    const exported=JSON.parse(await readFile(join(dir,'work-contexts',requestId+'.json'),'utf8'));assert.equal(exported.view,'model');assert.equal(exported.scope.taskId,task.id);assert.equal('talentInputs' in exported,false);assert.equal(exported.agreement.background,task.description);assert.match(prompt,/只打印保存回执/);
    assert.equal(state.stage,originalStage);assert.equal(state.context,originalContext);assert.equal(task.stage,'preparing');
    task.stage='awaiting-acceptance';assert.equal((await service.plan('member',target)).actions[0].enabled,false);
    task.stage='preparing';task.workDirectory=join(dir,'missing');assert.equal((await service.plan('member',target)).directory.valid,false);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Owner delivery uses the same native adapter and exact task scope; other users cannot start it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'work-owner-')),repo=join(dir,'source'),t=transport(),state=initialState();await mkdir(repo);execFileSync('git',['init','-q',repo]);
 const task=createDeliveryRequirement(state,'owner',{id:'MKT-OWNER-001',projectId:'carddemo',title:'白金卡返现规则说明页',description:'只使用确认事实与待确认项',assigneeId:'owner',skillIds:['dev-frontend-ui'],workDirectory:await realpath(repo)},new Date().toISOString());
 const before=structuredClone(state);
 try{const service=new ProjectWorkService(()=>state,fixtures,dir,t.value,undefined,dir),target={projectId:'carddemo',tab:'delivery',taskId:task.id,nodeId:'prepare'},owner=await service.plan('owner',target),member=await service.plan('member',target);assert.equal(owner.actions[0].enabled,true);assert.equal(member.actions[0].enabled,false);await assert.rejects(service.start('member',{requestId:randomUUID(),target,action:'new',planToken:member.planToken}),/交付人/);assert.equal(t.calls.length,0);const id=randomUUID(),receipt=await service.start('owner',{requestId:id,target,action:'new',planToken:owner.planToken});assert.equal(t.calls.length,1);assert.equal(t.calls[0].task.scope.taskId,task.id);assert.match(await readFile(receipt.contextPath,'utf8'),/--role owner/);assert.deepEqual(state,before);}finally{await rm(dir,{recursive:true,force:true});}
});


test('explicit relocated task directory preserves business state and rejects stale or altered bindings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'work-task-relocation-')),repo=join(dir,'moved'),runtime=join(dir,'runtime'),t=transport(),state=initialState();
  try{
    await mkdir(repo);await mkdir(runtime);execFileSync('git',['init','-q',repo]);
    const original=join(dir,'old','task'),task=createDeliveryRequirement(state,'owner',{id:'MKT-RELOCATE',projectId:'carddemo',title:'Relocated task',description:'Keep recorded task evidence',assigneeId:'owner',skillIds:['dev-frontend-ui'],workDirectory:original},new Date().toISOString());
    const before=JSON.stringify(state),service=new ProjectWorkService(()=>state,fixtures,runtime,t.value,undefined,dir),target={projectId:'carddemo',tab:'delivery',taskId:task.id,nodeId:'prepare'};
    assert.equal((await service.plan('owner',target)).directory.valid,false);
    const binding={projectId:task.projectId,taskId:task.id,recordedDirectory:original,directory:await realpath(repo),gitConfigSha256:createHash('sha256').update(await readFile(join(repo,'.git/config'))).digest('hex')};
    const file=join(runtime,'project-task-directory-bindings.json');await writeFile(file,JSON.stringify({version:1,bindings:[binding]}));const plan=await service.plan('owner',target);assert.equal(plan.directory.valid,true);assert.equal(plan.directory.root,await realpath(repo));assert.equal(plan.actions[0].enabled,true);assert.equal(JSON.stringify(state),before);assert.equal(t.calls.length,0);
    await writeFile(file,JSON.stringify({version:1,bindings:[{...binding,recordedDirectory:'/wrong/source'}]}));assert.match((await service.plan('owner',target)).directory.diagnostic,/登记来源不一致/);
    await writeFile(file,JSON.stringify({version:1,bindings:[{...binding,gitConfigSha256:'0'.repeat(64)}]}));assert.match((await service.plan('owner',target)).directory.diagnostic,/配置发生变化/);
    await writeFile(file,'{invalid');assert.equal((await service.plan('owner',target)).directory.valid,false);assert.equal(JSON.stringify(state),before);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});}
});
