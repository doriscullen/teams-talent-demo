import {nodeResultFixture} from './node-contract-fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/domain.js';
import { applyRequirementProgress, acceptDeliveryRequirement, createDeliveryRequirement, returnDeliveryRequirement, validateDeliveryRequirements, type DeliveryRequirement } from '../src/delivery-requirements.js';

const t0='2026-10-27T00:00:00.000Z',t1='2026-10-27T00:01:00.000Z',t2='2026-10-27T00:02:00.000Z';
const pass={status:'passed',source:'preset',summary:'Review 预置检查通过'};
const fail={status:'failed',source:'actual',summary:'实际测试失败'};
function prepared(){
 const state=initialState();
 const task=createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'MKT-CHECK-001',title:'检查门禁',description:'校验当前验证批次',assigneeId:'member',skillIds:['dev-code-reviewer']},t0);
 task.preparedAt=t0;task.nodes.prepare={status:'complete',updatedAt:t0,summary:'输入已确认'};
 applyRequirementProgress(task,{nodeId:'develop',phase:'result',summary:'开发完成',sessionId:'session-one',evidence:nodeResultFixture('develop').evidence},t0);
 return {state,task};
}
function verify(task:DeliveryRequirement,checks?:unknown,at=t1){applyRequirementProgress(task,{nodeId:'verify',phase:'result',summary:'验证结果',sessionId:'session-one',checks},at);}

test('every check in a submission must pass, regardless of order or actual/preset source',()=>{
 for(const checks of [[fail,pass],[pass,fail]]){
  const {state,task}=prepared();verify(task,checks);
  assert.equal(task.stage,'verifying');assert.equal(task.nodes.verify.status,'blocked');
  assert.deepEqual(task.checks.map(({status,source})=>({status,source})),checks.map(({status,source})=>({status,source})));
  assert.throws(()=>acceptDeliveryRequirement(state,'owner',task,t2),/不能验收/);
  // An inconsistent waiting state must still fail the independent acceptance gate.
  task.stage='awaiting-acceptance';task.nodes.verify.status='complete';
  assert.throws(()=>acceptDeliveryRequirement(state,'owner',task,t2),/不能验收/);
 }
});

test('a new passing batch can resolve a failed attempt without removing historical results',()=>{
 const {state,task}=prepared();verify(task,[fail,pass]);const history=structuredClone(task.checks);
 verify(task,[{...pass,source:'actual',summary:'修复后实际复测通过'},pass],t2);
 assert.equal(task.stage,'awaiting-acceptance');assert.deepEqual(task.checks.slice(0,history.length),history);
 assert.equal(task.verificationCheckIds?.length,2);validateDeliveryRequirements(state);
 acceptDeliveryRequirement(state,'owner',task,t2);assert.equal(task.stage,'accepted');
});

test('Owner return and resumed development invalidate the prior batch until fresh checks arrive',()=>{
 const {state,task}=prepared();verify(task,[pass]);const history=structuredClone(task.checks);
 assert.throws(()=>returnDeliveryRequirement('member',task,'补充边界',t2),/不能退回/);
 returnDeliveryRequirement('owner',task,'补充边界',t2);assert.deepEqual(task.checks,history);assert.deepEqual(task.verificationCheckIds,[]);
 applyRequirementProgress(task,{nodeId:'develop',phase:'result',summary:'已补充',sessionId:'session-one',evidence:nodeResultFixture('develop').evidence},t2);
 assert.throws(()=>verify(task),/本轮新的检查/);assert.equal(task.stage,'verifying');
 verify(task,[{...pass,source:'actual',summary:'新一轮边界测试通过'}],t2);
 assert.equal(task.stage,'awaiting-acceptance');assert.deepEqual(task.checks.slice(0,history.length),history);
 acceptDeliveryRequirement(state,'owner',task,t2);assert.equal(task.stage,'accepted');
});

test('existing pre-batch histories remain unchanged and their complete last submission is checked',()=>{
 const {state,task}=prepared();verify(task,[fail]);verify(task,[pass],t2);delete task.verificationCheckIds;
 const before=JSON.stringify(task);validateDeliveryRequirements(state);assert.equal(JSON.stringify(task),before);
 acceptDeliveryRequirement(state,'owner',task,t2);assert.equal(task.stage,'accepted');assert.equal(task.verificationCheckIds,undefined);
 const mixed=prepared();verify(mixed.task,[fail,pass]);delete mixed.task.verificationCheckIds;
 mixed.task.stage='awaiting-acceptance';mixed.task.nodes.verify.status='complete';
 assert.throws(()=>acceptDeliveryRequirement(mixed.state,'owner',mixed.task,t2),/不能验收/);
});
