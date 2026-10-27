import {nodeResultFixture} from './node-contract-fixtures.js';
import {createDeliveryRequirement,type RequirementNode} from '../src/delivery-requirements.js';
import {Store} from '../server/store.js';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,mkdir,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'delivery-scoped-')),teams='http://127.0.0.1:46193',talent='http://127.0.0.1:46194';
const env={...process.env,DEMO_PORT:'46193',DEMO_TALENT_PORT:'46194',DEMO_STATE_DIR:join(dir,'teams'),DEMO_TALENT_STATE_DIR:join(dir,'talent'),DEMO_SHARED_DIR:join(dir,'shared'),DEMO_SHARED_SEED_DIR:join(dir,'empty-seed'),DEMO_NATIVE_DISABLED:'1'};
// Existing task fixtures predate automatic native preparation. This suite tests their full CLI/acceptance protocol; new-task preparation is covered by task-preparation-http.ts.
const ids=['DEMO-MKT-001','MKT-E2E-001','MKT-OWNER-001'];
const fixtureStore=new Store(join(dir,'teams','state.json'));await fixtureStore.init();
await fixtureStore.transact(current=>{const next=structuredClone(current);for(const id of ids.slice(1))createDeliveryRequirement(next,'owner',{projectId:'carddemo',id,title:'独立任务 '+id,description:'白金卡、3个月、额外0.5%；其余政策未定。',assigneeId:id==='MKT-OWNER-001'?'owner':'member',skillIds:['dev-frontend-ui','dev-code-reviewer']},new Date().toISOString());return next;});
let logs='';const start=(entry:string)=>{const child=spawn(process.execPath,['--import','tsx',entry],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);return child;};const server=start('server/index.ts');
const state=async()=>await(await fetch(teams+'/api/state')).json() as any;
const wait=async(check:()=>Promise<boolean>)=>{for(let i=0;i<350;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+logs);};
const post=async(base:string,path:string,body:object,expected=200)=>{const {token}=await(await fetch(base+'/api/session')).json() as any;const response=await fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json','x-demo-token':token},body:JSON.stringify({role:'owner',revision:(await state()).revision,...body})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
const context=async(taskId:string,nodeId:string)=>await(await fetch(teams+'/api/collaboration/context?'+new URLSearchParams({projectId:'carddemo',taskId,nodeId}))).json() as any;
const ownerCli=async(kind:string,input:object)=>{
 const [command,verb]=kind.split('.');
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/teams-demo.mjs','--endpoint',teams,'--role','owner','--receipt-dir',join(dir,'owner-cli-receipts'),command,verb,'--operation-id',randomUUID(),'--input',JSON.stringify(input)]);
 const result=JSON.parse(stdout);assert.equal(result.ok,true);return result;
};
const automation=(s:any,id:string)=>s.workspace.taskAutomation?.find((r:any)=>r.taskId===id);
try{
 await wait(async()=>(await fetch(teams+'/api/health')).ok);
 const original=await state();
 await post(teams,'/api/action',{action:'assign',assigneeId:'member'});
 for(const action of ['prepare','replay','check-fail','fix','submit'])await post(teams,'/api/action',{action,role:'member'},409);
 const current=(id:string,s:any)=>s.workspace.deliveryRequirements.find((t:any)=>t.id===id);
 const receipts:any[]=[];
 for(const [index,id] of ids.entries()){
  const role=id==='MKT-OWNER-001'?'owner':'member',otherRole=role==='owner'?'member':'owner';const scope={projectId:'carddemo',taskId:id};const sessionId='test-protocol-session-'+index,runId=randomUUID();
  // Historical protocol fixtures have no automatic preparation record; new-task preparation is exercised separately.
  for(const nodeId of ['prepare','develop','verify']){
   if(nodeId!=='prepare')await wait(async()=>automation(await state(),id)?.nodeKnowledge?.[nodeId]?.status==='ready');
   const c=await context(id,nodeId);assert.equal(c.agreement.id,id);assert.equal(c.talentInputs.taskId,id);assert.ok(c.skills.every((skill:any)=>skill.availability==='talent-node-input'));const input={...scope,nodeId,sessionId,runId,expectedRevision:c.revision,basisDigest:c.basisDigest,readReferences:c.skills.map((skill:any)=>skill.id)};
   const beforeWrong=await state();await post(teams,'/api/collaboration',{role:otherRole,kind:'inputs.adopt',operationId:randomUUID(),input},403);assert.deepEqual(await state(),beforeWrong);
   const pageInputs=await(await fetch(teams+'/api/task-node-inputs?'+new URLSearchParams({...scope,nodeId,role}))).json();
   assert.deepEqual(pageInputs,c.nodeInputs,'page and CLI must consume the same scoped Talent result');
   const adopted=role==='owner'?await ownerCli('inputs.adopt',input):await post(teams,'/api/collaboration',{role,kind:'inputs.adopt',operationId:randomUUID(),input});
   const progress=async(kind:string,extra:object)=>{
    const payload={...scope,nodeId,sessionId,runId,adoptionId:adopted.receipt.adoptionId,expectedRevision:(await state()).revision,summary:'协议验证 '+nodeId,evidence:[{kind:'local-file',value:'tests/delivery-requirements-http.ts',description:'仅接口测试，不代表真实iCode执行'}],...extra};
    return role==='owner'?ownerCli(kind,payload):post(teams,'/api/collaboration',{role,kind,operationId:randomUUID(),input:payload});
   };
   await progress('progress.add',{phase:'started'});
   if(nodeId==='verify'){
    await progress('result.submit',nodeResultFixture('verify',{failed:true}));
    const blocked=current(id,await state());assert.equal(blocked.stage,'verifying');assert.equal(blocked.nodes.verify.status,'blocked');
    await post(teams,'/api/delivery-requirements',{...scope,action:'accept'},409);
   }
   await progress('result.submit',nodeResultFixture(nodeId as RequirementNode));
  }
  const task=current(id,await state());assert.equal(task.stage,'awaiting-acceptance');assert.equal(task.nodes.prepare.status,'complete');assert.equal(task.nodes.develop.status,'complete');assert.equal(task.nodes.verify.status,'complete');assert.equal(task.checks.length,8);
  assert.equal(automation(await state(),id).collection,undefined);
  await post(teams,'/api/delivery-requirements',{...scope,action:'accept',role:'member'},403);
 }
 // Returning one task must invalidate its prior checks without changing another task.
 const returnScope={projectId:'carddemo',taskId:ids[0]},other=structuredClone(current(ids[1],await state()));
 const history=structuredClone(current(ids[0],await state()).checks);
 await post(teams,'/api/delivery-requirements',{...returnScope,action:'return',reason:'补充边界验证'});
 for(const nodeId of ['develop','verify']){
  const c=await context(ids[0],nodeId),runId=randomUUID(),sessionId='test-protocol-session-0';
  const adopted=await post(teams,'/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input:{...returnScope,nodeId,sessionId,runId,expectedRevision:c.revision,basisDigest:c.basisDigest,readReferences:c.skills.map((skill:any)=>skill.id)}});
  const result=async(checks?:unknown,expected=200)=>post(teams,'/api/collaboration',{role:'member',kind:'result.submit',operationId:randomUUID(),input:{...returnScope,nodeId,sessionId,runId,adoptionId:adopted.receipt.adoptionId,expectedRevision:(await state()).revision,summary:'退回后补充',...nodeResultFixture(nodeId as RequirementNode),...(checks?{checks}:nodeId==='verify'?{checks:undefined}:{})}},expected);
  if(nodeId==='develop')await result();else{
   await result(undefined,409);assert.equal(current(ids[0],await state()).stage,'verifying');assert.deepEqual(current(ids[0],await state()).checks,history);
   await result(nodeResultFixture('verify').checks);
  }
 }
 assert.deepEqual(current(ids[1],await state()),other);assert.equal(current(ids[0],await state()).stage,'awaiting-acceptance');
 // Main record stays awaiting Owner; the second independent task exercises actual receiving + retry.
 const acceptanceScope={projectId:'carddemo',taskId:ids[1]},outbox=join(dir,'shared/teams/task-sessions');await mkdir(join(dir,'shared/teams'),{recursive:true});await writeFile(outbox,'blocked export destination');
 await post(teams,'/api/delivery-requirements',{...acceptanceScope,action:'accept'});await wait(async()=>automation(await state(),ids[1]).collection?.reporting?.status==='failed');assert.equal(current(ids[1],await state()).stage,'accepted');
 await rm(outbox);
 await post(teams,'/api/task-automation',{...acceptanceScope,step:'collection',retry:true});const uploaded=automation(await state(),ids[1]).collection;assert.equal(uploaded.reporting.status,'reported');assert.deepEqual(uploaded.reporting.receipt.sessionIds,['test-protocol-session-1']);receipts.push(uploaded.reporting.receipt);
 await post(teams,'/api/task-automation',{...acceptanceScope,step:'collection',retry:true});assert.deepEqual(automation(await state(),ids[1]).collection.reporting.receipt,uploaded.reporting.receipt);
 const exports=await readdir(outbox);assert.equal(exports.length,1);const exported=JSON.parse(await readFile(join(outbox,exports[0]),'utf8'));assert.equal(exported.payload.taskId,ids[1]);assert.match(uploaded.reporting.receipt.id,/^SHARED-/);assert.equal(current(ids[0],await state()).stage,'awaiting-acceptance');
 // Project membership guards reads as well as writes; another person's task in
 // the same project stays readable, an unrelated team project does not.
 const privateTeam='team-'+randomUUID(),privateProject=randomUUID();
 await post(teams,'/api/workspace',{kind:'team.create',payload:{id:privateTeam,name:'Owner 范围验证'}});
 await post(teams,'/api/workspace',{kind:'project.create',payload:{id:privateProject,name:'Owner 独立项目',description:'权限范围',remoteUrl:'https://example.test/private.git',repositoryIdentity:'example.test/private',teamId:privateTeam}});
 const readBefore=await state();
 for(const path of ['/api/collaboration/context','/api/task-node-inputs']){
  const denied=await fetch(teams+path+'?'+new URLSearchParams({projectId:privateProject,taskId:'MKT-NOT-REGISTERED',nodeId:'prepare',role:'member'}));assert.equal(denied.status,403);
 }
 assert.equal((await fetch(teams+'/api/collaboration/context?'+new URLSearchParams({projectId:privateProject,tab:'content',role:'owner'}))).status,200);
 for(const nodeId of ['prepare','develop','verify','accept']){
  const query={projectId:'teams',taskId:'T104',nodeId};
  const ui=await(await fetch(teams+'/api/task-node-inputs?'+new URLSearchParams({...query,role:'member'}))).json();
  const cli=await(await fetch(teams+'/api/collaboration/context?'+new URLSearchParams({...query,nodeId:nodeId==='prepare'?'review':nodeId==='develop'?'build':nodeId==='verify'?'test':'accept',role:'member'}))).json();
  assert.deepEqual(ui,cli.nodeInputs);assert.ok(!JSON.stringify(ui).includes('白金卡'));
 }
 assert.deepEqual(await state(),readBefore);
 const after=await state();for(const key of ['knowledge','assigned','assigneeId','stage','checks','context','transactions','evolution','security'])assert.deepEqual(after[key],original[key],key+' leaked between tasks');assert.equal(after.workspace.sessionReported,original.workspace.sessionReported);
 await mkdir('test-results/delivery-requirements',{recursive:true});await writeFile('test-results/delivery-requirements/http-result.json',JSON.stringify({passed:true,realICode:false,scope:'HTTP protocol and persistence only',tasks:after.workspace.deliveryRequirements,receipts,existingTaskUnchanged:true},null,2));console.log('PASS scoped requirements, shared node inputs/session export, CLI phase/check gates, failed upload retry and exact persistence');
}catch(error){console.error(logs);throw error;}finally{for(const child of [server])if(child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGTERM');});await rm(dir,{recursive:true,force:true});}
