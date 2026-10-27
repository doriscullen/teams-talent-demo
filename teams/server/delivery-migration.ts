import { createHash } from 'node:crypto';
import { selectedSkillBindings } from '../src/resource-sharing.js';
import { userSkillExamples } from '../src/project-skill-examples.js';
import type { DemoState } from '../src/domain.js';
import { deliveryRequirement, mainRequirementId, type DeliveryRequirement, type RequirementNode, type RequirementStage } from '../src/delivery-requirements.js';

/** Explicit v1 main-task conversion. Call once under Store initialization; no event is invented. */
export function migrateMainDelivery(state:DemoState):boolean {
 if(deliveryRequirement(state,'carddemo',mainRequirementId))return false;
 const at=state.audit.at(-1)?.at??new Date().toISOString();
 const stages:Record<DemoState['stage'],RequirementStage>={draft:'preparing',assigned:'preparing',developing:'developing',failed:'verifying',fixed:'verifying',submitted:'awaiting-acceptance',returned:'returned',accepted:'accepted'};
 const node=(status:DeliveryRequirement['nodes'][RequirementNode]['status'],summary:string)=>({status,updatedAt:status==='pending'?null:at,summary});
 const developed=['failed','fixed','submitted','accepted'].includes(state.stage),verified=['submitted','accepted'].includes(state.stage)&&state.checks==='passed';
 const task:DeliveryRequirement={id:mainRequirementId,projectId:'carddemo',title:'信用卡消费返现',description:'白金卡客户在未来 3 个月的消费，额外获得 0.5% 返现。正式活动日期、消费范围、限额及退款规则待业务确认。',assigneeId:state.assigned?(state.assigneeId??'member'):'',skillIds:[...(state.context?.selectedSkills??state.workspace.selectedSkills)],stage:stages[state.stage],createdAt:state.audit[0]?.at??at,updatedAt:at,checks:[],verificationCheckIds:[],legacyBasis:{stage:state.stage,checks:state.checks,contextId:state.context?.id??null,origin:'legacy-snapshot'},nodes:{
  prepare:node(state.context?'complete':'pending',state.context?'历史上下文已冻结；原依据保留，未新增 iCode 采用事件':''),
  develop:node(developed?'complete':['developing','returned'].includes(state.stage)?'running':'pending',state.stage==='draft'||state.stage==='assigned'?'':'迁移的历史开发状态，未记为本次 iCode 执行'),
  verify:node(verified?'complete':state.checks==='failed'?'blocked':'pending',state.checks==='none'?'':'迁移的历史检查结果；后续复检由 iCode 回传'),
  accept:node(state.stage==='accepted'?'complete':state.stage==='submitted'?'waiting-owner':'pending',state.stage==='accepted'?'保留原 Owner 验收结论':'')
 }};
 if(state.context){task.preparedAt=state.context.createdAt;task.inputDigest=createHash('sha256').update(JSON.stringify(state.context)).digest('hex');}
 task.userSkillIds=task.skillIds.filter(id=>userSkillExamples.some(skill=>skill.id===id));task.skillIds=task.skillIds.filter(id=>!task.userSkillIds!.includes(id));if(state.context?.skillBindings)task.skillBindings=structuredClone(state.context.skillBindings);else if(!state.context)task.skillBindings=selectedSkillBindings(state,'member');
 if(state.stage==='accepted')task.acceptedAt=[...state.audit].reverse().find(item=>item.action==='通过功能验收')?.at??at;
 if(state.checks!=='none'){
  const id='legacy-main-verification';task.checks.push({id,nodeId:'verify',status:state.checks,source:'preset',summary:'历史预置检查记录 · '+(state.checks==='passed'?'复测通过':'曾发现问题'),at,sessionId:null});
  if(state.stage!=='returned')task.verificationCheckIds=[id];
 }
 state.workspace.deliveryRequirements=[task,...(state.workspace.deliveryRequirements??[])];
 return true;
}
