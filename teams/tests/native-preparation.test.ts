import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../src/domain.js';
import { createDeliveryRequirement } from '../src/delivery-requirements.js';
import { queueTaskPreparation } from '../src/task-automation.js';
import { ProjectWorkService, type WorkTransport } from '../server/project-work.js';
import { preparationReadingEvidence, verifiedPreparation, type PreparationInput } from '../server/native-session-preparation.js';
import { readFixtures } from '../server/http-shared.js';
import { codeRoot } from '../server/config.js';
// @ts-ignore native wrapper is deliberately dependency-free JavaScript.
import { copyPreparedSession } from '../scripts/native/run-project-tui.mjs';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const at='2026-10-27T12:00:00.000Z';
test('preparation requires successful native material reads and refuses mutating tools or claims without evidence',()=>{
 const reads=[{path:'/task/context.json',sha256:'a'.repeat(64)},{path:'/skills/collaboration.md',sha256:'b'.repeat(64)}];
 const contents=reads.flatMap((read,index)=>[{type:'function_call',name:'read_file',call_id:'call-'+index,arguments:JSON.stringify({path:read.path})},{type:'function_result',call_id:'call-'+index,result:'File: '+read.path+' (2 lines, 10 chars)\n1: material'}]);
 const envelope={state:{messages:[{role:'assistant',contents}]}};
 assert.equal(preparationReadingEvidence(envelope,reads).length,2);
 assert.throws(()=>preparationReadingEvidence({state:{messages:[{role:'assistant',contents:[{type:'text',text:'I read all files'}]}]}},reads),/缺少/);
 assert.throws(()=>preparationReadingEvidence({state:{messages:[{contents:[...contents,{type:'function_call',name:'run_shell',call_id:'bad',arguments:'{}'}]}]}},reads),/只读材料/);
 const failed=structuredClone(envelope);failed.state.messages[0].contents[1].result='Error: cannot read';assert.throws(()=>preparationReadingEvidence(failed,reads),/缺少/);
});
test('prepared work remains task/assignee bound, idempotent and resumes only the validated native session',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-prepare-'))),repo=join(dir,'repo');await mkdir(repo);execFileSync('git',['init','-q',repo]);
 const state=initialState(),scope={projectId:'carddemo',taskId:'REQ-'+randomUUID()},calls:any[]=[],starts:any[]=[];
 const task=createDeliveryRequirement(state,'owner',{id:scope.taskId,projectId:scope.projectId,title:'阅读并等待',description:'仅本任务材料',assigneeId:'su',workDirectory:repo},at);
 queueTaskPreparation(state,scope,at);const preparation=state.workspace.taskAutomation!.find(record=>record.taskId===scope.taskId)!.preparation!;preparation.status='preparing-session';
 const fixtures=await readFixtures();
 const transport:WorkTransport={defaults:async()=>({agent:'code',agentLabel:'Code',model:'configured',modelLabel:'Configured model',terminal:{id:'ghostty',name:'Ghostty'}}),history:async()=>({available:false,directory:repo,title:'',active:null}),focus:async()=>{throw new Error('not supported');},start:async input=>{starts.push(input);return{terminal:'Ghostty'};}};
 const prepare=async(input:PreparationInput)=>{
  calls.push(input);const output=join(dir,'work-contexts',input.runId+'.native'),sessionId=randomUUID(),sessionRoot=join(output,'session-root'),sessionDir=join(sessionRoot,'sessions',sessionId.replaceAll('-','').slice(0,12));await mkdir(sessionDir,{recursive:true});
  const nativeReads=[];for(const [index,read] of input.reads.entries()){const body=(await readFile(read.path,'utf8')).replace(/\n$/,'');nativeReads.push({type:'function_call',name:'read_file',call_id:'read-'+index,arguments:JSON.stringify({path:read.path})},{type:'function_result',call_id:'read-'+index,result:'File: '+read.path+'\n'+body.split('\n').map((line,i)=>(i+1)+'|'+line).join('\n')+'\n'});}
  const content=JSON.stringify({meta:{session_id:sessionId,updated_at:at},state:{messages:[{role:'assistant',contents:[...nativeReads,{type:'text',text:'已准备，等待开发者确认起算规则。'}]}]}});
  await writeFile(join(sessionDir,'session.json'),content);await writeFile(join(output,'native-session.json'),JSON.stringify({runId:input.runId,...input.scope,sessionId,sessionRoot,pid:12345,startedAt:at,source:'icode-active-session-owner'}));await writeFile(join(output,'result.json'),JSON.stringify({runId:input.runId,...input.scope,sessionId,status:'completed',finishedAt:at}));
  await writeFile(join(output,'manifest.json'),JSON.stringify({version:1,runId:input.runId,scope:input.scope}));return (await verifiedPreparation(input))!;
 };
 try{
  const service=new ProjectWorkService(()=>state,fixtures,dir,transport,prepare,dir),before=JSON.stringify(state);
  const [one,two]=await Promise.all([service.prepare('su',scope,preparation.id),service.prepare('su',scope,preparation.id)]);assert.deepEqual(one,two);assert.equal(calls.length,1);assert.equal(JSON.stringify(state),before);
  const exported=JSON.parse(await readFile(calls[0].contextPath,'utf8'));assert.equal(exported.view,'model');assert.equal(exported.agreement.background,task.description);assert.equal('talentInputs'in exported,false);assert.deepEqual(one.status==='ready'?one.readEvidence.map(item=>item.path).sort():[],calls[0].reads.map((item:any)=>item.path).sort());
  assert.match(await readFile(calls[0].taskFile,'utf8'),/只允许 read_file/);assert.match(await readFile(calls[0].taskFile,'utf8'),/不运行 shell、写文件、修改代码/);assert.match(await readFile(calls[0].taskFile,'utf8'),/inputs adopt/);
  await assert.rejects(service.prepare('member',scope,preparation.id),/范围或交付人/);await assert.rejects(service.prepare('su',scope,randomUUID()),/范围或交付人/);assert.equal(calls.length,1);
  if(one.status!=='ready')throw new Error('expected ready');preparation.status='ready';preparation.session=one;state.workspace.taskAutomation!.find(record=>record.taskId===scope.taskId)!.knowledge!.status='ready';
  const denied=await service.plan('member',{...scope,tab:'delivery',nodeId:'prepare'});assert.equal(denied.defaultAction,'resume');assert.equal(denied.actions[0].enabled,false);
  task.assigneeId='member';preparation.assigneeId='member';
  const plan=await service.plan('member',{...scope,tab:'delivery',nodeId:'prepare'});assert.deepEqual(plan.actions.map(action=>action.id),['resume']);assert.equal(plan.actions[0].enabled,true);assert.equal(plan.history!.sessionId,one.sessionId);
  const downstream=await service.plan('member',{...plan.target,nodeId:'develop'});assert.equal(downstream.actions[0].enabled,false);assert.match(downstream.actions[0].reason!,/上游交付物/);assert.equal(downstream.history!.sessionId,one.sessionId);
  const request={requestId:randomUUID(),target:plan.target,action:'resume' as const,planToken:plan.planToken};await service.start('member',request);await service.start('member',request);assert.equal(starts.length,1);assert.equal(starts[0].sessionId,one.sessionId);assert.equal(starts[0].task.preparedSession.sourceRunId,one.runId);assert.equal(starts[0].terminal,'ghostty');
  const newRun=randomUUID(),output=join(dir,'work-contexts',newRun+'.native');await mkdir(output);const source=join(dir,'work-contexts',one.runId+'.native','session-root','sessions',one.sessionId.replaceAll('-','').slice(0,12),'session.json'),bytes=await readFile(source);
  await copyPreparedSession({runId:newRun,scope,preparedSession:{preparationRunId:one.runId,sourceRunId:one.runId,sessionId:one.sessionId,sessionSha256:sha(bytes)}},output);
  assert.deepEqual(await readFile(join(output,'session-root','sessions',one.sessionId.replaceAll('-','').slice(0,12),'session.json')),bytes);assert.deepEqual(await readFile(source),bytes);
  await assert.rejects(copyPreparedSession({runId:randomUUID(),scope:{...scope,taskId:'other'},preparedSession:{preparationRunId:one.runId,sourceRunId:one.runId,sessionId:one.sessionId,sessionSha256:sha(bytes)}},join(dir,'work-contexts','invalid.native')),/范围/);
  await writeFile(join(output,'manifest.json'),JSON.stringify({runId:newRun,scope,preparedSession:{preparationRunId:one.runId,sourceRunId:one.runId,sessionId:one.sessionId}}));
  const pending=await service.plan('member',plan.target);assert.equal(pending.actions[0].enabled,false);assert.match(pending.actions[0].reason!,/尚未取得原生会话回执/);
  await assert.rejects(service.start('member',{requestId:randomUUID(),target:plan.target,action:'resume',planToken:pending.planToken}),/未重复启动/);assert.equal(starts.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('preparation uses the assignee project binding and Card default without replacing invalid explicit directories',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-prepare-directory-'))),ownerRepo=join(dir,'owner'),memberRepo=join(dir,'member'),state=initialState();
 try{
  for(const repo of [ownerRepo,memberRepo]){await mkdir(repo);execFileSync('git',['init','-q',repo]);}
  const fixtures=await readFixtures(),scope={projectId:'carddemo',taskId:'REQ-'+randomUUID()};
  const task=createDeliveryRequirement(state,'owner',{id:scope.taskId,projectId:scope.projectId,title:'项目目录范围',description:'只读初始化',assigneeId:'member'},at);queueTaskPreparation(state,scope,at);
  const preparation=state.workspace.taskAutomation!.find(record=>record.taskId===scope.taskId)!.preparation!;preparation.status='preparing-session';
  const transport:WorkTransport={defaults:async()=>({agent:'code',agentLabel:'Code',model:'model',modelLabel:'Model',terminal:{id:'ghostty',name:'Ghostty'}}),history:async()=>({available:false,directory:'',title:'',active:null}),focus:async()=>{throw new Error('not supported');},start:async()=>{throw new Error('must not launch');}};
  const calls:PreparationInput[]=[],service=new ProjectWorkService(()=>state,fixtures,dir,transport,async input=>{calls.push(input);throw new Error('validated preparation transport reached');},dir),target={...scope,tab:'delivery',nodeId:'prepare'};
  const defaultPlan=await service.plan('member',target);assert.equal(defaultPlan.directory.root,await realpath(codeRoot));assert.equal(defaultPlan.directory.valid,true);assert.equal(defaultPlan.directory.kind,'imported-snapshot');
  await service.bind('owner',target,ownerRepo);await service.bind('member',target,memberRepo);
  await assert.rejects(service.prepare('member',scope,preparation.id),/validated preparation transport reached/);assert.equal(calls.length,1);assert.equal(calls[0].directory,await realpath(memberRepo));
  task.workDirectory=join(dir,'explicit-missing');const missing=await service.prepare('member',scope,preparation.id);assert.equal(missing.status,'waiting-directory');assert.equal(calls.length,1);delete task.workDirectory;
  await writeFile(join(dir,'project-work-bindings.json'),JSON.stringify({'owner:carddemo':ownerRepo,'member:carddemo':join(dir,'missing-member-binding')}));assert.equal((await service.plan('member',target)).directory.valid,false);
  const teamScope={projectId:'teams',taskId:'REQ-'+randomUUID()};createDeliveryRequirement(state,'owner',{...teamScope,id:teamScope.taskId,title:'尚未绑定项目',description:'不使用其他项目的目录',assigneeId:'member'},at);queueTaskPreparation(state,teamScope,at);
  const queued=state.workspace.taskAutomation!.find(record=>record.taskId===teamScope.taskId)!.preparation!;queued.status='preparing-session';assert.equal((await service.prepare('member',teamScope,queued.id)).status,'waiting-directory');assert.equal(calls.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
