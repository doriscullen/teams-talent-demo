import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import {queueTaskPreparation,taskAutomation} from '../src/task-automation.js';
import {ProjectWorkService,type WorkTransport} from '../server/project-work.js';
import {readFixtures} from '../server/http-shared.js';
import {startNativeCliWork} from '../server/native.js';
const exec=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function put(path:string,value:unknown){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value));}
async function fixture(){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'cli-work-'))),state=initialState(),scope={projectId:'carddemo',taskId:'REQ-'+randomUUID()},runId=randomUUID(),sessionId=randomUUID(),at=new Date().toISOString(),directory=join(dir,'business');await mkdir(directory);
 createDeliveryRequirement(state,'owner',{id:scope.taskId,...scope,title:'Explicit work',description:'Read current materials only',assigneeId:'member',workDirectory:directory},at);queueTaskPreparation(state,scope,at);
 const preparation=taskAutomation(state,scope)!.preparation!,output=join(dir,'work-contexts',runId+'.native'),content=JSON.stringify({meta:{session_id:sessionId,updated_at:at},state:{messages:[]}});
 preparation.status='ready';preparation.session={status:'ready',runId,sessionId,directory,preparedAt:at,agent:'code',agentLabel:'Code',model:'configured',modelLabel:'Configured',readEvidence:[{path:'/fixture',sha256:'a'.repeat(64)}]} as any;taskAutomation(state,scope)!.knowledge!.status='ready';
 await put(join(output,'manifest.json'),{version:1,runId,scope:{...scope,nodeId:'prepare'}});await put(join(output,'native-session.json'),{runId,...scope,nodeId:'prepare',sessionId,sessionRoot:join(output,'session-root'),pid:99999999,startedAt:at});await put(join(output,'result.json'),{runId,...scope,nodeId:'prepare',sessionId,status:'completed',finishedAt:at});await put(join(output,'session-root/sessions',sessionId.replaceAll('-','').slice(0,12),'session.json'),content);
 const calls:any[]=[];const transport:WorkTransport={defaults:async()=>({agent:'code',agentLabel:'Code',model:'configured',modelLabel:'Configured',terminal:{id:'unknown',name:'Unavailable terminal',error:'No GUI terminal'}}),history:async()=>{throw Error('legacy history must not run');},focus:async()=>{throw Error('focus must not run');},start:async()=>{throw Error('TUI must not run');},startCli:async input=>{calls.push(input);await put(join(dir,'work-contexts',input.task!.runId+'.native','manifest.json'),{version:1,executionMode:'task-file',runId:input.task!.runId,scope:input.task!.scope,preparedSession:input.task!.preparedSession});return {status:'cli-requested'};}};
 const service=new ProjectWorkService(()=>state,await readFixtures(),dir,transport,undefined,dir),target={...scope,tab:'delivery',nodeId:'prepare'};
 return{dir,state,scope,runId,sessionId,output,directory,content,calls,service,target,transport};
}
test('explicit CLI resumes the pinned prepared session; scope, permissions, input gates and duplicate requests stay enforced',async()=>{
 const f=await fixture();try{
  const before=JSON.stringify(f.state),plan=await f.service.plan('member',f.target,'member','cli');assert.equal(plan.defaultAction,'resume');assert.equal(plan.actions[0].enabled,true);assert.equal(plan.executionMode,'task-file');assert.equal((await f.service.plan('member',f.target)).actions[0].enabled,false);
  assert.equal((await f.service.plan('owner',f.target,'owner','cli')).actions[0].enabled,false);
  assert.equal((await f.service.plan('member',{...f.target,nodeId:'develop'},'member','cli')).actions[0].enabled,false);
  const request={mode:'cli' as const,requestId:randomUUID(),target:plan.target,action:'resume' as const,planToken:plan.planToken,instruction:'仅阅读并回传本节点实际进度，不提交或推送。'};
  await assert.rejects(f.service.start('member',{...request,instruction:''}),/工作指令/);
  const [one,two]=await Promise.all([f.service.start('member',request),f.service.start('member',request)]);assert.deepEqual(one,two);assert.equal(one.status,'cli-requested');assert.equal(f.calls.length,1);assert.equal(f.calls[0].sessionId,f.sessionId);assert.equal(f.calls[0].task.preparedSession.sourceRunId,f.runId);
  const text=await readFile(one.contextPath,'utf8');assert.match(text,/初始化只读轮之后开发者明确授权/);assert.match(text,/不代替 prepare.confirmed/);assert.ok(text.includes(request.instruction));assert.match(text,/PR base 必须为 develop/);assert.match(text,/不授权提交或推送/);
  await assert.rejects(f.service.start('member',{...request,instruction:'changed'}),/另一项工作/);
  const pending=await f.service.plan('member',f.target,'member','cli');assert.equal(pending.actions[0].enabled,false);await assert.rejects(f.service.start('member',{...request,requestId:randomUUID(),planToken:pending.planToken}),/未重复启动/);assert.equal(f.calls.length,1);
  assert.equal((await f.service.status('member',f.target,request.requestId)).execution.status,'pending');await assert.rejects(f.service.status('owner',f.target,request.requestId),/交付人/);await assert.rejects(f.service.status('member',{...f.target,nodeId:'verify'},request.requestId),/不属于/);assert.equal(JSON.stringify(f.state),before);f.state.workspace.deliveryRequirements!.find(task=>task.id===f.scope.taskId)!.assigneeId='owner';await assert.rejects(f.service.start('member',request),/交付人/);assert.equal(f.calls.length,1);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('active CLI session cannot be entered by another CLI or a duplicate TUI; failed closed run remains same-session resumable',async()=>{
 const f=await fixture(),child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});await once(child,'spawn');try{
  const run=randomUUID(),at=new Date().toISOString(),out=join(f.dir,'work-contexts',run+'.native'),scope={...f.scope,nodeId:'prepare'};
  await put(join(out,'manifest.json'),{version:1,executionMode:'task-file',runId:run,scope,preparedSession:{preparationRunId:f.runId,sessionId:f.sessionId}});await put(join(out,'native-session.json'),{runId:run,...scope,sessionId:f.sessionId,sessionRoot:join(out,'session-root'),pid:child.pid,startedAt:at,executionMode:'task-file'});await put(join(out,'process.json'),{pid:child.pid,startedAt:at});await put(join(out,'session-root/sessions/.locks',f.sessionId.replaceAll('-','').slice(0,12)+'.active.json'),{session_id:f.sessionId,pid:child.pid,started_at:at});await put(join(out,'session-root/sessions',f.sessionId.replaceAll('-','').slice(0,12),'session.json'),f.content);
  assert.equal((await f.service.plan('member',f.target,'member','cli')).actions[0].enabled,false);assert.equal((await f.service.plan('member',f.target)).actions[0].enabled,false);
  child.kill();await once(child,'exit');await put(join(out,'result.json'),{executionMode:'task-file',runId:run,...scope,sessionId:f.sessionId,status:'failed',nativeExitCode:1});
  const plan=await f.service.plan('member',f.target,'member','cli');assert.equal(plan.actions[0].enabled,true);assert.equal(plan.history!.prepared!.sourceRunId,run);assert.equal(plan.history!.sessionId,f.sessionId);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill();await rm(f.dir,{recursive:true,force:true});}
});
test('CLI client preserves exact request for retry across changed plans and reports real execution failure, without raw model output',async()=>{
 const f=await fixture(),requests:any[]=[];let plans=0;const server=createServer(async(req,res)=>{try{const url=new URL(req.url!,'http://localhost');let result:any;if(url.pathname==='/api/health')result={app:'teams-talent-carddemo',service:'teams'};else if(url.pathname==='/api/session')result={token:'unit'};else if(url.pathname==='/api/project-work'){plans++;const {role,mode,...target}=Object.fromEntries(url.searchParams);result=await f.service.plan(role as any,target as any,role,mode as any);}else if(url.pathname==='/api/native/work-start'){assert.equal(req.headers['x-demo-token'],'unit');let text='';for await(const chunk of req)text+=chunk;const {role,...body}=JSON.parse(text);requests.push(body);result=await f.service.start(role,body);}else if(url.pathname==='/api/native/work-status'){const {role,requestId,...target}=Object.fromEntries(url.searchParams);result=await f.service.status(role as any,target as any,requestId);}else throw Error('Unexpected request');res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}catch(error:any){res.statusCode=error.status??400;res.end(JSON.stringify({error:error.message}));}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const endpoint='http://127.0.0.1:'+(server.address() as any).port,common=['--endpoint',endpoint,'--role','member','--project','carddemo','--task',f.scope.taskId,'--node','prepare'],id=randomUUID(),script=resolve('scripts/icode-work.mjs');const args=[script,'start',...common,'--mode','cli','--request-id',id,'--instruction','只读 "&中文;"，不写代码','--receipt-dir',join(f.dir,'receipts')];await put(join(f.dir,'config.json'),{});const env={...process.env,DEMO_LOCAL_CONFIG:join(f.dir,'config.json')};
  const one=JSON.parse((await exec(process.execPath,args,{env})).stdout);const two=JSON.parse((await exec(process.execPath,args,{env})).stdout);assert.equal(one.receipt.sessionId,f.sessionId);assert.deepEqual(one,two);assert.equal(plans,1);assert.equal(f.calls.length,1);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].instruction,'只读 "&中文;"，不写代码');
  const out=join(f.dir,'work-contexts',id+'.native');await put(join(out,'launch-error.json'),{runId:id,...f.scope,nodeId:'prepare',error:'fixture runner failed',nativeLaunchState:'not-spawned',at:new Date().toISOString()});let failed:any;try{await exec(process.execPath,[script,'status',...common,'--request-id',id],{env});}catch(error){failed=error;}assert.equal(failed.code,2);const status=JSON.parse(failed.stdout);assert.equal(status.execution.status,'failed');assert.match(status.execution.error,/fixture runner failed/);assert.equal(status.receipt.requestId,id);assert.equal(f.calls.length,1);assert.equal((await f.service.plan('member',f.target,'member','cli')).actions[0].enabled,false);await put(join(out,'cli-launch.json'),{runId:id,...f.scope,nodeId:'prepare',pid:99999999,startedAt:new Date().toISOString()});assert.equal((await f.service.plan('member',f.target,'member','cli')).actions[0].enabled,true);await put(join(out,'launch-error.json'),{runId:id,...f.scope,nodeId:'prepare',nativeLaunchState:'spawn-attempted',error:'unknown',at:new Date().toISOString()});assert.equal((await f.service.plan('member',f.target,'member','cli')).actions[0].enabled,false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(f.dir,{recursive:true,force:true});}
});
test('native-disabled rejects CLI before any process or manifest is created',async()=>{const old=process.env.DEMO_NATIVE_DISABLED;process.env.DEMO_NATIVE_DISABLED='1';try{await assert.rejects(startNativeCliWork({directory:'/invalid',agent:'code',model:'model',instruction:'readonly'}),/未开放/);}finally{if(old===undefined)delete process.env.DEMO_NATIVE_DISABLED;else process.env.DEMO_NATIVE_DISABLED=old;}});
