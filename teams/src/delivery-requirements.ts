import type { CollaborationEvidence } from './collaboration.js';
import { creationText, optionalAssignee, optionalDue, requireProjectCreator } from './task-creation.js';
import { nodeResultErrors, unitTestResultErrors } from './task-node-contract.js';
import type { TalentNodeInputs } from './talent-node-inputs.js';
import type { TalentTaskInputs } from './talent-contract.js';
import type { SkillBinding } from './resource-sharing.js';
import { DomainError, type DemoState, type Role } from './domain.js';
import { projectMembers } from './teams-domain.js';
export type RequirementNode = 'prepare' | 'develop' | 'verify' | 'accept';
export type RequirementStage = 'preparing' | 'developing' | 'verifying' | 'awaiting-acceptance' | 'accepted' | 'returned';
export interface RequirementNodeState { status:'pending'|'running'|'blocked'|'complete'|'waiting-owner'; updatedAt:string|null; summary:string }
export interface RequirementCheck { id:string; nodeId:RequirementNode; status:'passed'|'failed'; source:'actual'|'preset'; artifact?:string; summary:string; at:string; sessionId:string|null }
export interface DeliveryRequirement {
 id:string;projectId:string;title:string;description:string;assigneeId:string;skillIds:string[];workDirectory?:string;due?:string;creationRequest?:string;
 talentInputsSnapshot?:TalentTaskInputs;
 nodeInputSnapshots?:Partial<Record<RequirementNode,TalentNodeInputs>>;
 nodeContractVersion?:'delivery-node-v1'|'delivery-node-v2';
 skillBindings?:SkillBinding[];userSkillIds?:string[];
 stage:RequirementStage;createdAt:string;updatedAt:string;acceptedAt?:string;preparedAt?:string;inputDigest?:string;
 nodes:Record<RequirementNode,RequirementNodeState>;checks:RequirementCheck[];
 /** IDs from the current verification submission; empty means fresh checks are required. */
 verificationCheckIds?:string[];
 /** Preserved pre-unification facts; these are not iCode execution receipts. */
 legacyBasis?:{stage:DemoState['stage'];checks:DemoState['checks'];contextId:string|null;origin:'legacy-snapshot'};
}
export const mainRequirementId='DEMO-MKT-001';
export const requirementStageLabels:Record<RequirementStage,string>={preparing:'需求澄清',developing:'功能开发',verifying:'测试验证','awaiting-acceptance':'待 Owner 验收',accepted:'已验收',returned:'已退回'};
export const deliveryRequirement=(state:DemoState,projectId:string,taskId?:string)=>(state.workspace.deliveryRequirements??[]).find(task=>task.projectId===projectId&&task.id===taskId);
export const requirementNode=(task:DeliveryRequirement):RequirementNode=>task.stage==='preparing'?'prepare':task.stage==='developing'||task.stage==='returned'?'develop':task.stage==='verifying'?'verify':'accept';
export function requireDeliveryMember(state:DemoState,task:DeliveryRequirement,role:Role){if(!['owner','member'].includes(role)||task.assigneeId!==role||!projectMembers(state,task.projectId).some(member=>member.id===role&&member.status==='active'))throw new DomainError('仅当前需求交付人可以回传工作状态',403);}
export function createDeliveryRequirement(state:DemoState,role:Role,input:Record<string,unknown>,at:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('需求内容无效',400);
 const projectId=creationText(input.projectId,'项目',100);requireProjectCreator(state,role,projectId);
 const id=creationText(input.id,'需求标识',100);
 if(!/^MKT-[A-Z0-9][A-Z0-9-]{2,60}$/.test(id)&&!/^REQ-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||id==='MKT-001')throw new DomainError('需求标识无效', 400);
 const skillIds=input.skillIds===undefined?[]:input.skillIds;
 if(!Array.isArray(skillIds)||skillIds.length>20||skillIds.some(id=>typeof id!=='string'||!/^[a-z0-9-]+$/.test(id)))throw new DomainError('所选 Skill 格式无效', 400);
 const due=optionalDue(input.due),workDirectory=input.workDirectory===undefined?undefined:creationText(input.workDirectory,'工作目录',2000);
 const fields={id,projectId,title:creationText(input.title,'需求标题',160),description:creationText(input.description,'需求说明',4000,true),assigneeId:optionalAssignee(state,projectId,input.assigneeId),skillIds:[...new Set(skillIds as string[])].sort(),...(due?{due}:{}),...(workDirectory?{workDirectory}:{})};
 const creationRequest=JSON.stringify(fields),existing=deliveryRequirement(state,projectId,id);
 if(existing){if(existing.creationRequest!==creationRequest)throw new DomainError('同一需求标识不能用于不同创建内容',409);return existing;}
 const nodes=Object.fromEntries(['prepare','develop','verify','accept'].map(id=>[id,{status:'pending',updatedAt:null,summary:''}])) as DeliveryRequirement['nodes'];
 const task:DeliveryRequirement={...fields,creationRequest,stage:'preparing',createdAt:at,updatedAt:at,nodes,checks:[],verificationCheckIds:[]};
 state.workspace.deliveryRequirements=[...(state.workspace.deliveryRequirements??[]),task];return task;
}
export function assignDeliveryRequirement(state:DemoState,role:Role,input:Record<string,unknown>,at:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('分配内容无效', 400);
 const projectId=creationText(input.projectId,'项目',100);requireProjectCreator(state,role,projectId);
 const task=deliveryRequirement(state,projectId,creationText(input.taskId,'需求标识',100));if(!task)throw new DomainError('交付需求不存在',404);
 if(task.stage!=='preparing'||task.preparedAt||Object.values(task.nodes).some(node=>node.status!=='pending'))throw new DomainError('需求已经开始执行，不能更换交付人',409);
 const preparation=state.workspace.taskAutomation?.find(record=>record.projectId===projectId&&record.taskId===task.id)?.preparation;
 if(preparation&&['preparing-session','ready'].includes(preparation.status)&&input.assigneeId!==task.assigneeId)throw new DomainError('原生会话正在准备或已就绪，请先处理当前会话后再改派',409);
 if(typeof input.assigneeId!=='string')throw new DomainError('请明确交付人或待分配状态',400);
 task.assigneeId=optionalAssignee(state,projectId,input.assigneeId);task.updatedAt=at;return task;
}
export function verificationChecks(task:DeliveryRequirement):RequirementCheck[]{
 if(task.verificationCheckIds!==undefined)return task.checks.filter(check=>task.verificationCheckIds!.includes(check.id));
 // Existing records predate batch IDs. A single CLI submission stamped every check
 // with the same time/session; read its final contiguous batch without rewriting history.
 const last=task.checks.at(-1);if(!last)return [];
 let start=task.checks.length-1;while(start>0&&task.checks[start-1].at===last.at&&task.checks[start-1].sessionId===last.sessionId)start--;
 return task.checks.slice(start);
}
export function acceptDeliveryRequirement(state:DemoState,role:Role,task:DeliveryRequirement,at:string){
 if(role!=='owner')throw new DomainError('仅 Owner 可以验收需求',403);
 const checks=verificationChecks(task);
 if(task.stage!=='awaiting-acceptance'||task.nodes.develop.status!=='complete'||task.nodes.verify.status!=='complete'||!checks.length||checks.some(check=>check.status!=='passed'))throw new DomainError('需求尚未完成开发与验证，不能验收');
 if(task.nodeContractVersion){const result=[...(state.workspace.collaboration?.events??[])].reverse().find(event=>event.projectId===task.projectId&&event.taskId===task.id&&event.nodeId==='verify'&&event.phase==='result');const errors=nodeResultErrors(state,task,'verify',result?.evidence??[],result?.completedCriteria??[],checks);if(errors.length)throw new DomainError('验收依据不齐全：'+errors.join('；'));}
 task.stage='accepted';task.acceptedAt=at;task.updatedAt=at;task.nodes.accept={status:'complete',updatedAt:at,summary:'Owner 验收通过'};
}
export function returnDeliveryRequirement(role:Role,task:DeliveryRequirement,reason:unknown,at:string){
 if(role!=='owner'||task.stage!=='awaiting-acceptance')throw new DomainError('当前状态或角色不能退回',403);
 if(typeof reason!=='string'||!reason.trim())throw new DomainError('退回需要说明');
 task.stage='returned';task.updatedAt=at;task.verificationCheckIds=[];
 task.nodes.accept={status:'pending',updatedAt:at,summary:reason};task.nodes.develop={status:'running',updatedAt:at,summary:reason};task.nodes.verify={status:'pending',updatedAt:at,summary:'等待重新验证'};
}
export function applyRequirementProgress(task:DeliveryRequirement,input:{nodeId:RequirementNode;phase:'started'|'progress'|'blocked'|'result';summary:string;sessionId:string|null;checks?:unknown;evidence?:CollaborationEvidence[]},at:string){
 const {nodeId,phase,summary}=input;if(nodeId==='accept')throw new DomainError('CLI不能替代Owner验收',403);
 if(task.stage==='accepted'||task.stage==='awaiting-acceptance')throw new DomainError('需求已提交验收，不能继续修改执行状态');
 if(nodeId!=='prepare'&&!task.preparedAt)throw new DomainError('请先在需求澄清节点明确采用本次输入');
 if(nodeId==='develop'&&task.nodeContractVersion&&task.nodes.prepare.status!=='complete')throw new DomainError('请先提交需求澄清的PRD与完成标准');
 if(nodeId==='verify'&&task.nodes.develop.status!=='complete')throw new DomainError('请先提交开发成果');
 if(nodeId==='develop'&&phase==='result'){const evidence=input.evidence??[],errors=unitTestResultErrors(evidence,evidence.find(item=>item.artifact==='code-change')?.codeVersion);if(errors.length)throw new DomainError(errors.join('；'),409);}
 let submitted:RequirementCheck[]|undefined;
 if(input.checks!==undefined){if(nodeId!=='verify'||!Array.isArray(input.checks)||input.checks.length===0||input.checks.length>30)throw new DomainError('检查结果必须属于验证节点');submitted=input.checks.map(raw=>{const check=raw as Record<string,unknown>;if(!check||!['passed','failed'].includes(String(check.status))||!['actual','preset'].includes(String(check.source))||typeof check.summary!=='string'||!check.summary.trim()||check.summary.length>2000)throw new DomainError('检查结果需要明确结论、来源与说明');return{id:crypto.randomUUID(),nodeId,status:check.status as 'passed'|'failed',source:check.source as 'actual'|'preset',summary:check.summary,at,sessionId:input.sessionId,...(typeof check.artifact==='string'?{artifact:check.artifact}:{})};});}
 if(nodeId==='develop'||nodeId==='verify'&&phase==='started')task.verificationCheckIds=[];
 if(submitted){task.checks.push(...submitted);task.verificationCheckIds=submitted.map(check=>check.id);}
 const checks=verificationChecks(task);
 if(nodeId==='verify'&&phase==='result'&&!checks.length)throw new DomainError('验证成果需要本轮新的检查结果及来源');
 const failed=nodeId==='verify'&&checks.some(check=>check.status==='failed');
 task.nodes[nodeId]={status:phase==='blocked'||failed?'blocked':phase==='result'?'complete':'running',updatedAt:at,summary};task.updatedAt=at;
 if(nodeId==='prepare'&&phase==='result')task.stage='developing';
 if(nodeId==='develop')task.stage=phase==='result'?'verifying':'developing';
 if(nodeId==='verify'){task.stage=phase==='result'&&!failed?'awaiting-acceptance':'verifying';if(task.stage==='awaiting-acceptance')task.nodes.accept={status:'waiting-owner',updatedAt:at,summary:'开发与验证成果已提交，等待 Owner 验收'};}
}
export function validateDeliveryRequirements(state:DemoState){
 if(state.workspace.deliveryRequirements===undefined)return;
 if(!Array.isArray(state.workspace.deliveryRequirements))throw new Error('交付需求记录无效');const ids=new Set<string>();
 for(const task of state.workspace.deliveryRequirements){if(!task||typeof task.id!=='string'||ids.has(task.projectId+'/'+task.id)||!Object.hasOwn(requirementStageLabels,task.stage)||!(task.assigneeId===''&&task.stage==='preparing'&&!task.preparedAt||projectMembers(state,task.projectId).some(member=>member.id===task.assigneeId&&member.status==='active'))||!Array.isArray(task.skillIds)||!Array.isArray(task.checks)||!['prepare','develop','verify','accept'].every(id=>task.nodes?.[id as RequirementNode]&&['pending','running','blocked','complete','waiting-owner'].includes(task.nodes[id as RequirementNode].status)))throw new Error('交付需求记录损坏；未自动覆盖');
  if(!['carddemo','teams'].includes(task.projectId)&&!state.workspace.projects?.some(project=>project.id===task.projectId))throw new Error('交付需求所属项目不存在');
  if(task.due!==undefined)optionalDue(task.due);
  if(task.creationRequest!==undefined&&(typeof task.creationRequest!=='string'||task.creationRequest.length>12000))throw new Error('需求创建依据无效');
  if(task.verificationCheckIds!==undefined&&(!Array.isArray(task.verificationCheckIds)||new Set(task.verificationCheckIds).size!==task.verificationCheckIds.length||task.verificationCheckIds.some((id,index)=>typeof id!=='string'||task.checks[task.checks.length-task.verificationCheckIds!.length+index]?.id!==id)))throw new Error('需求当前检查批次无效；未自动覆盖');
  if(task.nodeInputSnapshots!==undefined){for(const [node,input]of Object.entries(task.nodeInputSnapshots)){if(!['prepare','develop','verify','accept'].includes(node)||!input||input.projectId!==task.projectId||input.taskId!==task.id||input.nodeId!==node||!Array.isArray(input.skills)||!Array.isArray(input.knowledge?.assets))throw new Error('节点采用输入范围无效');}}
  if(task.nodeContractVersion!==undefined&&!['delivery-node-v1','delivery-node-v2'].includes(task.nodeContractVersion))throw new Error('任务节点合同版本无效');
  ids.add(task.projectId+'/'+task.id);}
}
