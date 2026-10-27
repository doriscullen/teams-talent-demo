import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {initialState,transition} from '../src/domain.js';
import {Store} from '../server/store.js';
import {migrateMainDelivery} from '../server/delivery-migration.js';
import {deliveryRequirement,createDeliveryRequirement} from '../src/delivery-requirements.js';
import {projectDeliveryTasks} from '../src/project-delivery-tasks.js';
import {validateTeams} from '../src/teams-domain.js';

test('main task migration preserves existing tasks, legacy evidence and exact original backup once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'unified-delivery-')),path=join(dir,'state.json');
 try{
  const state=transition(initialState(),'assign','owner',{assigneeId:'member'});
  createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'MKT-EXISTING-001',title:'现有任务',description:'现有真实需求',assigneeId:'member',skillIds:['dev-code-reviewer']},'2026-10-27T00:00:00Z');
  const original=JSON.stringify(state,null,2)+'\n';await writeFile(path,original);
  const store=new Store(path);await store.init();
  const task=deliveryRequirement(store.state,'carddemo','DEMO-MKT-001')!;
  assert.equal(task.stage,'preparing');assert.equal(task.assigneeId,'member');assert.equal(task.preparedAt,undefined);
  const preserved=structuredClone(store.state);preserved.workspace.deliveryRequirements=preserved.workspace.deliveryRequirements!.filter(item=>item.id!==task.id);assert.deepEqual(preserved,state);
  assert.equal(await readFile(path+'.pre-unified-delivery.json','utf8'),original);
  const saved=await readFile(path,'utf8');await new Store(path).init();assert.equal(await readFile(path,'utf8'),saved);
  assert.equal(projectDeliveryTasks(store.state,'carddemo').filter(item=>item.id===task.id).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unassigned and accepted historical main states retain meaning without invented CLI events',()=>{
 const state=initialState();migrateMainDelivery(state);validateTeams(state);
 assert.equal(projectDeliveryTasks(state,'carddemo')[0].pendingAssignment,true);assert.equal(projectDeliveryTasks(state,'carddemo','member').length,1);
 const assigned=transition(state,'assign','owner',{assigneeId:'member'});
 assert.equal(deliveryRequirement(assigned,'carddemo','DEMO-MKT-001')!.assigneeId,'member');assert.equal(assigned.assigned,false);assert.equal(assigned.stage,'draft');
 for(const action of ['prepare','replay','check-fail','fix','submit','accept','return'] as const)assert.throws(()=>transition(assigned,action,action==='accept'||action==='return'?'owner':'member'),/旧演练推进入口已停用/);
 const accepted=initialState();accepted.assigned=true;accepted.assigneeId='member';accepted.stage='accepted';accepted.checks='passed';accepted.audit=[{id:1,at:'2026-10-27T00:00:00Z',role:'owner',system:'Teams',action:'通过功能验收',detail:'旧验收',origin:'simulated'}];
 migrateMainDelivery(accepted);const task=deliveryRequirement(accepted,'carddemo','DEMO-MKT-001')!;
 assert.equal(task.stage,'accepted');assert.equal(task.checks[0].source,'preset');assert.equal(task.checks[0].sessionId,null);assert.match(task.nodes.develop.summary,/历史/);assert.equal(accepted.workspace.collaboration,undefined);assert.equal(accepted.workspace.taskAutomation,undefined);assert.equal(migrateMainDelivery(accepted),false);
});

test('accepted main task stays actionable without the legacy session report flag',async()=>{
 await mkdir('test-results',{recursive:true});
 const dir=await mkdtemp(join('test-results','home-next-step-')),outfile=join(dir,'home.mjs');
 try{
  await build({stdin:{contents:"export { nextStep } from './src/pages/home';",resolveDir:process.cwd(),loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic',logLevel:'silent'});
  const {nextStep}=await import(pathToFileURL(outfile).href),state=initialState();
  state.assigned=true;state.assigneeId='member';state.stage='accepted';state.workspace.sessionReported=false;
  const next=nextStep(state,'owner');
  assert.equal(next.title,'查看验收和会话共享');assert.match(next.href,/task=DEMO-MKT-001/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
