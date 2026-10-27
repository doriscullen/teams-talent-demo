import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement,applyRequirementProgress} from '../src/delivery-requirements.js';
import {nodeResultErrors,unitTestResultErrors,taskNodeView,type UnitTestExecution} from '../src/task-node-contract.js';
import {nodeResultFixture} from './node-contract-fixtures.js';
import {Store} from '../server/store.js';
const at='2026-10-27T14:12:00.000Z',codeVersion='carddemo-java-1025@a360bd30b0b9';
const reportPath='tests/fixtures/unexecuted-java-unit-report.md';
function partial():UnitTestExecution{return{kind:'unit-tests',codeVersion,requiredScopes:['web-ui/cashback-benefit','card-service/CardControllerTest'],notRunScopes:['card-service/CardControllerTest'],runs:[{scope:'web-ui/cashback-benefit',command:'node --test services/web-ui/src/test/js/cashback-benefit.test.mjs',status:'passed',exitCode:0,passed:14,failed:0,skipped:0,executedAt:at},{scope:'card-service/CardControllerTest',command:'mvn -pl services/card-service test',status:'not-run',exitCode:null,passed:0,failed:0,skipped:0}]};}
function evidence(execution:UnitTestExecution|undefined=partial()){return nodeResultFixture('develop',{codeVersion}).evidence.map(item=>item.artifact==='unit-test-result'?{...item,value:reportPath,description:'真实报告反例：JS 14 通过，Java 新增4个JUnit未执行',execution}:item);}
function fixture(){const state=initialState(),task=createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'MKT-UNIT-EXECUTION',title:'开发单测门禁',description:'验证必要范围实际执行',assigneeId:'member'},at);task.preparedAt=at;task.nodes.prepare.status='complete';task.nodeContractVersion='delivery-node-v2';state.workspace.collaboration={adoptions:[],events:[{id:randomUUID(),operationId:randomUUID(),projectId:'carddemo',taskId:task.id,nodeId:'prepare',role:'member',runId:'isolated',sessionId:'isolated',adoptionId:'isolated',phase:'result',summary:'协议夹具 PRD',blocker:null,...nodeResultFixture('prepare'),at,revision:1}],operations:[]};return{state,task};}
function passing(){const input=partial();input.notRunScopes=[];input.runs[1]={...input.runs[1],status:'passed',exitCode:0,passed:4,executedAt:at};return input;}

test('the exact observed report with JS14 passed and unexecuted Java4 cannot complete development, including v1 new writes',async()=>{
 const bytes=await readFile(reportPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),'23025e36d9a4cef6f1cc17bdbf01a17099d39b5544f7a5782f59bd3145bed34a');assert.match(bytes.toString(),/14 passed/);assert.match(bytes.toString(),/新增 4 个 JUnit/);
 for(const version of ['delivery-node-v1','delivery-node-v2',undefined] as const){const {state,task}=fixture();task.nodeContractVersion=version;const before=JSON.stringify(task);const errors=nodeResultErrors(state,task,'develop',evidence(),nodeResultFixture('develop').completedCriteria,undefined);assert.match(errors.join(';'),/未执行|未完整执行/);assert.throws(()=>applyRequirementProgress(task,{nodeId:'develop',phase:'result',summary:'报告已写',sessionId:'scope-session',evidence:evidence()},at),/未执行|未完整执行/);assert.equal(JSON.stringify(task),before);applyRequirementProgress(task,{nodeId:'develop',phase:'blocked',summary:'缺少Java测试执行',sessionId:'scope-session',evidence:evidence()},at);assert.equal(task.stage,'developing');assert.equal(task.nodes.develop.status,'blocked');}
});

test('missing execution, failed, required skipped, zero tests, uncovered scopes, compilation and old code versions are rejected',()=>{
 const cases:Array<[string,ReturnType<typeof evidence>]>=[['report only',evidence(undefined).map(item=>{if(item.artifact!=='unit-test-result')return item;const {execution:_execution,...rest}=item;return rest;})]];
 for(const [name,modify] of [
  ['failure',(e:UnitTestExecution)=>{e.runs[1].status='failed';e.runs[1].exitCode=1;e.runs[1].failed=1;}],
  ['required skipped',(e:UnitTestExecution)=>{e.runs[1].skipped=1;}],
  ['no tests',(e:UnitTestExecution)=>{e.runs[1].passed=0;}],
  ['missing scope',(e:UnitTestExecution)=>{e.runs.pop();}],
  ['compile only',(e:UnitTestExecution)=>{e.runs[1].command='mvn -pl services/card-service compile';}],
  ['skip tests',(e:UnitTestExecution)=>{e.runs[1].command='mvn -DskipTests test';}],
  ['old code',(e:UnitTestExecution)=>{e.codeVersion='previous-commit';}],
  ['missing time',(e:UnitTestExecution)=>{delete e.runs[1].executedAt;}],
 ] as const){const execution=passing();modify(execution);cases.push([name,evidence(execution)]);}
 for(const [name,items]of cases)assert.ok(unitTestResultErrors(items,codeVersion).length>0,name);
 assert.ok(unitTestResultErrors(evidence(passing()).map(item=>item.artifact==='unit-test-result'?{...item,source:'preset' as const}:item),codeVersion).length>0);
});

test('same-version necessary scopes really declared passed can complete; explicitly nonessential skipped tests do not demand all-repo execution',()=>{
 const {state,task}=fixture(),execution=passing();execution.runs[0].skipped=2;execution.runs[0].excludedSkips={count:2,reason:'与本次web权益页面无关的Windows原生窗口测试；必要前端14项与CardControllerTest4项均执行。'};
 assert.deepEqual(unitTestResultErrors(evidence(execution),codeVersion),[]);assert.deepEqual(nodeResultErrors(state,task,'develop',evidence(execution),nodeResultFixture('develop').completedCriteria,undefined),[]);applyRequirementProgress(task,{nodeId:'develop',phase:'result',summary:'仅必要范围测试实际通过',sessionId:'isolated-session',evidence:evidence(execution)},at);assert.equal(task.stage,'verifying');assert.equal(task.nodes.develop.status,'complete');
 execution.runs[0].excludedSkips.count=1;assert.match(unitTestResultErrors(evidence(execution),codeVersion).join(';'),/未完整执行/);
 const packageRun=passing();packageRun.runs[1].command='mvn -pl services/card-service package';assert.deepEqual(unitTestResultErrors(evidence(packageRun),codeVersion),[],'Maven package can actually execute tests; command guessing must not become a whitelist');
});

test('existing accepted histories load byte-identically; old unit evidence says execution needs checking without retroactive state changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'old-unit-history-')),path=join(dir,'state.json'),store=new Store(path);try{await store.init();await store.transact(current=>{const next=structuredClone(current),task=next.workspace.deliveryRequirements![0];task.assigneeId='member';task.stage='accepted';task.acceptedAt=at;task.nodes.develop.status='complete';task.nodes.verify.status='complete';task.nodes.accept.status='complete';next.workspace.collaboration={adoptions:[],events:[{id:'old-event',operationId:'old-op',projectId:task.projectId,taskId:task.id,nodeId:'develop',role:'member',runId:'old-run',sessionId:'old-session',adoptionId:'old-adopt',phase:'result',summary:'旧报告事实保留',blocker:null,evidence:evidence().map(item=>{const {execution:_execution,...rest}=item;return rest;}),completedCriteria:['develop.prd','develop.traceable','develop.verifiable'],at,revision:1}],operations:[]};return next;});const before=await readFile(path),reopened=new Store(path);await reopened.init();assert.deepEqual(await readFile(path),before);const task=reopened.state.workspace.deliveryRequirements![0],view=taskNodeView(reopened.state,task,'develop');assert.equal(task.stage,'accepted');assert.match(view.deliverables.find(item=>item.id==='unit-test-result')!.references[0].sourceLabel,/执行情况待核对/);assert.equal(view.criteria.find(item=>item.id==='develop.tests')!.status,'unregistered');}finally{await rm(dir,{recursive:true,force:true});}
});
