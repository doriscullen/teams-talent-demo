/** Isolated protocol fixture: declarations below are not real model/test-run evidence. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../server/store.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import type {UnitTestExecution} from '../src/task-node-contract.js';
import {nodeResultFixture} from './node-contract-fixtures.js';

const dir=await mkdtemp(join(tmpdir(),'unit-execution-http-'));
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=(listener.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
const origin='http://127.0.0.1:'+port,stateFile=join(dir,'state/state.json');
const env={...process.env,DEMO_PORT:String(port),DEMO_STATE_DIR:join(dir,'state'),DEMO_SHARED_DIR:join(dir,'shared'),DEMO_SHARED_SEED_DIR:join(dir,'empty-seed'),DEMO_NATIVE_DISABLED:'1'};
const at='2026-10-27T14:12:00.000Z',taskId='MKT-E2E-001',codeVersion='carddemo-java-1025@a360bd30b0b9';
const fixtureStore=new Store(stateFile);await fixtureStore.init();
// Preexisting assigned/adopted task: no native preparation is simulated. New-task native preparation has its own real/runtime tests.
await fixtureStore.transact(current=>{
 const next=structuredClone(current),task=createDeliveryRequirement(next,'owner',{projectId:'carddemo',id:taskId,title:'开发执行声明 HTTP 边界',description:'隔离协议测试；不代表实际模型执行。',assigneeId:'member'},at);
 task.preparedAt=at;task.stage='developing';task.nodes.prepare={status:'complete',updatedAt:at,summary:'已有 PRD 协议夹具'};task.nodeContractVersion='delivery-node-v2';
 next.workspace.collaboration={adoptions:[],events:[{id:randomUUID(),operationId:randomUUID(),projectId:'carddemo',taskId,nodeId:'prepare',role:'member',runId:'fixture',sessionId:'fixture',adoptionId:'fixture',phase:'result',summary:'既有 PRD 协议夹具',blocker:null,...nodeResultFixture('prepare'),at,revision:1}],operations:[]};
 return next;
});
let logs='';const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const get=async(path:string,expected=200)=>{const response=await fetch(origin+path),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
const state=()=>get('/api/state');
const post=async(path:string,body:object,expected=200)=>{
 const {token}=await get('/api/session'),current=await state();
 const response=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-demo-token':token},body:JSON.stringify({role:'owner',revision:current.revision,...body})});
 const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
};
const wait=async(check:()=>Promise<boolean>,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('Timeout: '+logs);};
const currentTask=async()=>(await state()).workspace.deliveryRequirements.find((task:any)=>task.id===taskId);
const scope={projectId:'carddemo',taskId,nodeId:'develop'},runId=randomUUID(),sessionId='isolated-unit-execution-session';
const partial:UnitTestExecution={kind:'unit-tests',codeVersion,requiredScopes:['web-ui/cashback-benefit','card-service/CardControllerTest'],notRunScopes:['card-service/CardControllerTest'],runs:[
 {scope:'web-ui/cashback-benefit',command:'node --test services/web-ui/src/test/js/cashback-benefit.test.mjs',status:'passed',exitCode:0,passed:14,failed:0,skipped:0,executedAt:at},
 {scope:'card-service/CardControllerTest',command:'mvn -pl services/card-service test',status:'not-run',exitCode:null,passed:0,failed:0,skipped:0},
]};
try{
 await wait(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}},12000);
 const rawReport=await readFile('tests/fixtures/unexecuted-java-unit-report.md');assert.equal(createHash('sha256').update(rawReport).digest('hex'),'23025e36d9a4cef6f1cc17bdbf01a17099d39b5544f7a5782f59bd3145bed34a');
 const context=await get('/api/collaboration/context?'+new URLSearchParams({...scope,role:'member',view:'model'}));
 assert.ok(context.nodeContract.definition.completionCriteria.some((criterion:any)=>criterion.id==='develop.tests'));
 const adopted=await post('/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input:{...scope,runId,sessionId,expectedRevision:context.revision,basisDigest:context.basisDigest,readReferences:context.skills.map((skill:any)=>skill.id)}});
 const fixture=nodeResultFixture('develop',{codeVersion});
 const evidence=(execution?:unknown)=>fixture.evidence.map(item=>{if(item.artifact!=='unit-test-result')return item;const {execution:_execution,...rest}=item;return{...rest,kind:'local-file',value:'tests/fixtures/unexecuted-java-unit-report.md',description:'真实反例报告：JS 14通过，Java新增4项未执行',...(execution!==undefined?{execution}:{})};});
 const payload=async(items:unknown,extra:object={})=>({role:'member',kind:'result.submit',operationId:randomUUID(),input:{...scope,runId,sessionId,adoptionId:adopted.receipt.adoptionId,expectedRevision:(await state()).revision,summary:'隔离执行声明验证',completedCriteria:fixture.completedCriteria,evidence:items,...extra}});
 const rejected:Array<{name:string;status:number}>=[];
 for(const [name,items,status]of [
  ['report-only',evidence(),409],['JS passed but Java not run',evidence(partial),409],
  ['malformed execution',evidence({...partial,runs:[{...partial.runs[0],excludedSkips:null}]}),400],
  ['preset cannot substitute unit execution',evidence(partial).map(item=>item.artifact==='unit-test-result'?{...item,source:'preset'}:item),400],
 ]as const){const before=await readFile(stateFile);await post('/api/collaboration',await payload(items),status);assert.deepEqual(await readFile(stateFile),before,name+' must not advance or persist a rejected result');rejected.push({name,status});}
 const blocked=await payload(evidence(partial),{phase:'blocked',blocker:'Java 必要范围尚未执行：环境缺失'});blocked.kind='progress.add';
 await post('/api/collaboration',blocked);assert.equal((await currentTask()).nodes.develop.status,'blocked');assert.equal((await currentTask()).stage,'developing');
 const recorded=(await state()).workspace.collaboration.events.at(-1);assert.deepEqual(recorded.evidence.find((item:any)=>item.artifact==='unit-test-result').execution,partial);
 const passed=structuredClone(partial);passed.notRunScopes=[];passed.runs[1]={...passed.runs[1],status:'passed',exitCode:0,passed:4,executedAt:at};
 const submit=await payload(evidence(passed));const result=await post('/api/collaboration',submit);assert.equal((await currentTask()).stage,'verifying');assert.equal((await currentTask()).nodes.develop.status,'complete');
 const replay=await post('/api/collaboration',submit);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,result.receipt);
 await post('/api/collaboration',{...submit,input:{...submit.input,summary:'同ID不同内容'}},409);
 assert.equal((await state()).workspace.collaboration.events.filter((event:any)=>event.operationId===submit.operationId).length,1);
 await wait(async()=>{const record=(await state()).workspace.taskAutomation?.find((item:any)=>item.taskId===taskId);return record?.nodeKnowledge?.verify?.status==='ready';});
 const verifyScope={...scope,nodeId:'verify'},verifyContext=await get('/api/collaboration/context?'+new URLSearchParams({...verifyScope,role:'member',view:'model'}));
 const verifyAdopted=await post('/api/collaboration',{role:'member',kind:'inputs.adopt',operationId:randomUUID(),input:{...verifyScope,runId,sessionId,expectedRevision:verifyContext.revision,basisDigest:verifyContext.basisDigest,readReferences:verifyContext.skills.map((skill:any)=>skill.id)}});
 const checks=nodeResultFixture('verify',{codeVersion});assert.ok(checks.checks?.some(check=>check.source==='preset'));
 await post('/api/collaboration',{role:'member',kind:'result.submit',operationId:randomUUID(),input:{...verifyScope,runId,sessionId,adoptionId:verifyAdopted.receipt.adoptionId,expectedRevision:(await state()).revision,summary:'保留授权预置验证检查',...checks}});
 assert.equal((await currentTask()).stage,'awaiting-acceptance');assert.ok((await currentTask()).checks.some((check:any)=>check.source==='preset'));
 await mkdir('test-results/unit-test-execution',{recursive:true});await writeFile('test-results/unit-test-execution/http-result.json',JSON.stringify({passed:true,realModel:false,independentExecutionVerification:false,reportSha256:createHash('sha256').update(rawReport).digest('hex'),rejected,checks:['model context exposes develop.tests','rejected result leaves persisted state byte-identical','blocked progress retains partial execution','same-version required suites passed permits completion','operation exact replay and changed-payload rejection','verify preset remains permitted','existing task fixture only; no native work']},null,2));
 console.log('PASS execution declaration HTTP gates, blocked progress, replay and unchanged verify preset authorization');
}catch(error){console.error(logs);throw error;}finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(dir,{recursive:true,force:true});}
