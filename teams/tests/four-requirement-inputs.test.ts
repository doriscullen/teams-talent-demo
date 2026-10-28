import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import {readFixtures} from '../server/http-shared.js';
import {registeredTaskSkill} from '../server/talent-intake.js';
import {talentNodeInputs} from '../server/talent-node-inputs.js';
import {fourRequirementKnowledge} from '../server/four-requirement-inputs.js';
import {enterpriseTestCaseReferences} from '../src/task-node-contract.js';
import {fourRequirementScenario,fourRequirementScenarios,fourRequirementScenariosV2,fourRequirementNodes} from '../../shared/four-requirement-scenarios.js';
import {appendFourRequirements} from '../../talents/server/four-requirements.ts';
import {seedState} from '../../talents/server/seed.ts';
import {buildExport} from '../../talents/server/export.ts';
// Keep a deliberately v1-only publication fixture even when fresh installations seed both versions.
const data=await readFixtures(),directory=resolve('../talents/content'),published=buildExport(appendFourRequirements(seedState()).state).knowledge.artifacts.filter(a=>!fourRequirementScenariosV2.some(s=>s.artifactId===a.id));
const read=async(_id:string,_version:number,path:string)=>({content:await readFile(join(directory,path),'utf8'),absolutePath:join(directory,path)});
const state=initialState(),project={id:'carddemo',name:'Credit Card',generation:'initial'};
const tasks=fourRequirementScenarios.map(s=>createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'REQ-'+randomUUID(),title:s.title,description:s.creationDescription,assigneeId:'member'},'2026-10-28T00:00:00Z'));
test('four exact scopes expose compact full-document references and real versioned Skill packages',async()=>{
 const before=structuredClone(state);
 for(let index=0;index<tasks.length;index++){
  const task=tasks[index],scenario=fourRequirementScenarios[index];
  for(const node of ['prepare','develop','verify','accept'] as const){
   const input=await talentNodeInputs({state,project},data,task.id,node,'http://talents.test',registeredTaskSkill,published,read);
   assert.equal(input.selection.scenario!.id,scenario.id);assert.equal(input.selection.status,'configured');assert.deepEqual(input.skills.map(s=>s.id),fourRequirementNodes[node].skills);
   assert.ok(input.knowledge.assets.reduce((n,a)=>n+a.detail.length,0)<2500);
   const reference=input.knowledge.assets.flatMap(a=>a.references??[]).find(r=>r.path===scenario.files.requirement)!;
   assert.equal(reference.absolutePath,join(directory,scenario.files.requirement));assert.equal(reference.sha256,scenario.sourceSha256);assert.equal(reference.version,'1');
   assert.equal(createHash('sha256').update(await readFile(reference.absolutePath!)).digest('hex'),scenario.sourceSha256);
   for(const skill of input.skills)assert.deepEqual(skill,await registeredTaskSkill(skill.id));
   assert.ok(input.knowledge.assets.every(a=>a.sourceRecordId===task.id&&!a.detail.includes('US-001')));
  }
  const cases=enterpriseTestCaseReferences(data,task);assert.equal(cases.length,8);assert.ok(cases.every(c=>c.testCase?.id.startsWith(scenario.businessId)));assert.ok(cases.every(c=>c.source==='preset'&&c.sourceLabel.includes('未执行')));
  assert.ok(cases.every(c=>c.description.includes('本次执行同时应用独立 test-profile-v1；')&&!c.description.includes('test-profile-v2')),'v1 test definitions retain their pinned profile label');
 }
 assert.deepEqual(state,before);
});
test('wrong project, source fingerprint and business identity never select another scenario',()=>{
 const task=tasks[0];assert.ok(fourRequirementScenario('carddemo',task));assert.equal(fourRequirementScenario('teams',task),undefined);
 assert.equal(fourRequirementScenario('carddemo',{...task,description:task.description.replace(fourRequirementScenarios[0].sourceSha256,'0'.repeat(64))}),undefined);
 assert.equal(fourRequirementScenario('carddemo',{...task,description:task.description.replace('REQ-2026-001','REQ-2026-002')}),undefined);
 assert.equal(enterpriseTestCaseReferences(data,{...task,description:''}).length,0);
});
test('missing publication, corrupt text and changed Skill version cannot silently substitute inputs',async()=>{
 const s=fourRequirementScenarios[0],task=tasks[0];
 const absent=await talentNodeInputs({state,project},data,task.id,'prepare','local',registeredTaskSkill,[],read);assert.equal(absent.selection.status,'not-configured');assert.equal(absent.skills.length,0);
 await assert.rejects(fourRequirementKnowledge(s,published,'prepare',async(id,v,path)=>({...await read(id,v,path),...(path===s.files.requirement?{content:'changed'}:{})})),/正文摘要/);
 await assert.rejects(talentNodeInputs({state,project},data,task.id,'prepare','local',async(id,binding)=>({...await registeredTaskSkill(id,binding),version:'fake-2'}),published,read),/包版本/);
});
test('adopted node snapshot survives changed publication and loader without mutation',async()=>{
 const task=tasks[0],input=await talentNodeInputs({state,project},data,task.id,'develop','local',registeredTaskSkill,published,read);
 task.nodeInputSnapshots={develop:structuredClone(input)};const before=structuredClone(task);
 const frozen=await talentNodeInputs({state,project},data,task.id,'develop','new-origin',async()=>{throw new Error('must not load');},[],async()=>{throw new Error('must not read');});
 assert.equal(frozen.selection.basis,'adopted-node');assert.deepEqual(frozen.knowledge,input.knowledge);assert.deepEqual(frozen.skills,input.skills);assert.deepEqual(task,before);
});

test('fresh v2 tasks pin explicit profile while v1 tasks and adopted snapshots remain unchanged',async()=>{
 const {fourRequirementScenariosV2,fourRequirementProfileV2Sha256}=await import('../../shared/four-requirement-scenarios.js');
 const dual=buildExport(appendFourRequirements(appendFourRequirements(seedState()).state,2).state).knowledge.artifacts;
 const isolated=initialState();
 for(const s of fourRequirementScenariosV2){
  const task=createDeliveryRequirement(isolated,'owner',{projectId:'carddemo',id:'REQ-'+randomUUID(),title:s.title,description:s.creationDescription,assigneeId:'member'},'2026-10-28T00:00:00Z');
  assert.equal(fourRequirementScenario('carddemo',task)?.version,2);
  for(const node of ['prepare','develop','verify','accept'] as const){
   const input=await talentNodeInputs({state:isolated,project},data,task.id,node,'local',registeredTaskSkill,dual,read);
   assert.equal(input.selection.scenario!.artifactVersion,2);assert.equal(input.selection.scenario!.id,s.id);
   const refs=input.knowledge.assets.flatMap(a=>a.references??[]);
   assert.equal(refs.find(r=>r.path===s.files.profile)!.sha256,fourRequirementProfileV2Sha256);
   assert.equal(refs.find(r=>r.path===s.files.requirement)!.sha256,s.sourceSha256);
   assert.ok(input.knowledge.assets.reduce((n,a)=>n+a.detail.length,0)<2500);
   assert.ok(input.knowledge.assets.every(a=>a.detail.includes('test-profile-v2')));
   assert.deepEqual(input.skills.map(k=>k.id),fourRequirementNodes[node].skills);
  }
  const cases=enterpriseTestCaseReferences(data,task);assert.equal(cases.length,8);assert.ok(cases.every(c=>c.version===s.casesVersion));
  assert.ok(cases.every(c=>c.description.includes('本次执行同时应用独立 test-profile-v2；')&&!c.description.includes('test-profile-v1')),'v2 test definitions expose v2 consistently in the UI/CLI reference body');
  if(s.businessId==='REQ-2026-001'){const five=s.cases.find(c=>c.id.endsWith('US-005'))!;assert.match(five.given,/900\.00.*600\.00/);assert.match(five.expected,/606\.00/);}
 }
 const legacyTask=createDeliveryRequirement(isolated,'owner',{projectId:'carddemo',id:'REQ-'+randomUUID(),title:fourRequirementScenarios[0].title,description:fourRequirementScenarios[0].creationDescription,assigneeId:'member'},'2026-10-28T00:00:00Z');
 const oldInput=await talentNodeInputs({state:isolated,project},data,legacyTask.id,'prepare','local',registeredTaskSkill,published,read);
 const after=await talentNodeInputs({state:isolated,project},data,legacyTask.id,'prepare','local',registeredTaskSkill,dual,read);assert.deepEqual(after,oldInput);
 legacyTask.nodeInputSnapshots={prepare:structuredClone(oldInput)};const before=structuredClone(legacyTask);
 const frozen=await talentNodeInputs({state:isolated,project},data,legacyTask.id,'prepare','local',async()=>{throw new Error('no reload');},dual,async()=>{throw new Error('no read');});assert.deepEqual(frozen.knowledge,oldInput.knowledge);assert.deepEqual(legacyTask,before);
});
test('v2 missing publication or mismatched profile does not use v1 or generic inputs',async()=>{
 const {fourRequirementScenariosV2,fourRequirementProfileV2Sha256}=await import('../../shared/four-requirement-scenarios.js');
 const s=fourRequirementScenariosV2[0],isolated=initialState(),task=createDeliveryRequirement(isolated,'owner',{projectId:'carddemo',id:'REQ-'+randomUUID(),title:s.title,description:s.creationDescription,assigneeId:'member'},'2026-10-28T00:00:00Z');
 const notPublished=await talentNodeInputs({state:isolated,project},data,task.id,'prepare','local',registeredTaskSkill,published,read);assert.equal(notPublished.selection.status,'not-configured');assert.equal(notPublished.skills.length,0);assert.equal(notPublished.knowledge.assets.length,0);
 task.description=task.description.replace(fourRequirementProfileV2Sha256,'0'.repeat(64));assert.equal(fourRequirementScenario('carddemo',task),undefined);
 await assert.rejects(talentNodeInputs({state:isolated,project},data,task.id,'prepare','local',registeredTaskSkill,published,read),/口径标记/);
 const dual=buildExport(appendFourRequirements(appendFourRequirements(seedState()).state,2).state).knowledge.artifacts;
 await assert.rejects(fourRequirementKnowledge(s,dual,'prepare',async(id,v,path)=>{const output=await read(id,v,path);if(path===s.manifest){const m=JSON.parse(output.content);m.testProfile.sha256='0'.repeat(64);return {...output,content:JSON.stringify(m)};}return output;}),/口径版本或摘要/);
});
