import type {Presentation} from '../src/api.js';
import {DomainError} from '../src/domain.js';
import {deliveryRequirement,type RequirementNode} from '../src/delivery-requirements.js';
import type {TalentTaskInputs} from '../src/talent-contract.js';
import type {TalentNodeInputs} from '../src/talent-node-inputs.js';
import {nodePreset,nodePresetVersion,registeredTaskNodePreset} from './talent-node-presets.js';
import {taskAutomation} from '../src/task-automation.js';
import type {DemoState} from '../src/domain.js';
import type {PublishedArtifact} from '../../shared/contracts.js';
import {matchesPlatinumCashbackPage,platinumCashbackPage,platinumCashbackPageNodes} from '../../shared/platinum-cashback-page.js';
import {platinumPageKnowledge,type PublishedInputReader} from './platinum-cashback-page.js';
export interface NodeInputContext {state:DemoState;project:{id:string;name:string;generation:string}}
import {fourRequirementScenario,fourRequirementNodes} from '../../shared/four-requirement-scenarios.js';
import {fourRequirementKnowledge} from './four-requirement-inputs.js';
import type {SkillBinding} from '../src/resource-sharing.js';

export function checkedNode(value:string):RequirementNode{if(!['prepare','develop','verify','accept'].includes(value))throw new DomainError('任务输入节点不存在',404);return value as RequirementNode;}
/** Exact scope selection; no model call, no project knowledge build, no state writes. */
export async function talentNodeInputs(ctx:NodeInputContext,data:Pick<Presentation,'teamsProject'>,taskId:string,nodeId:RequirementNode,origin:string,loadSkill:(id:string,binding?:SkillBinding)=>Promise<TalentTaskInputs['skills'][number]>, published:PublishedArtifact[]=[],readPublishedFile?:PublishedInputReader):Promise<TalentNodeInputs>{
 const projectId=ctx.project.id,task=deliveryRequirement(ctx.state,projectId,taskId),source=projectId==='teams'?data.teamsProject.tasks.find(item=>item.id===taskId):undefined;
 if(!task&&!source)throw new DomainError('任务不存在或不属于所选项目',404);
 const frozen=task?.nodeInputSnapshots?.[nodeId];
 if(frozen){if(frozen.projectId!==projectId||frozen.taskId!==taskId||frozen.nodeId!==nodeId)throw new DomainError('节点采用输入范围不一致',409);return {...structuredClone(frozen),origin,selection:{...structuredClone(frozen.selection),basis:'adopted-node'}};}
 const four=task?fourRequirementScenario(projectId,task):undefined;
 if(task&&!four&&task.description.split('\n').some(line=>line.startsWith('试验口径版本：')||line.startsWith('试验口径 SHA256：')))throw new DomainError('需求试验口径标记与固定版本不匹配，未选择其它输入',409);
 const scenario=task&&matchesPlatinumCashbackPage(projectId,task)?platinumCashbackPageNodes[nodeId]:undefined;
 const knownPreset=nodePreset(projectId,taskId,nodeId),preset=four?{knowledge:[],skills:fourRequirementNodes[nodeId].skills,skillSlot:fourRequirementNodes[nodeId].skillSlot}:scenario?{knowledge:[],skills:scenario.skills,skillSlot:scenario.skillSlot}:knownPreset??(task&&taskAutomation(ctx.state,{projectId,taskId})?.preparation?registeredTaskNodePreset(task,nodeId):undefined),requirement={id:taskId,title:task?.title??source!.title,description:task?.description??[source!.goal,'范围：'+source!.scope].join('\n')};
 const base:TalentNodeInputs={projectId,taskId,nodeId,generation:ctx.project.generation,origin,requirement,knowledge:{status:'not-built',assets:[]},skills:[],selection:{version:nodePresetVersion,source:'teams-node-selection',status:preset?'configured':'not-configured',basis:'recommendation',note:preset?'Teams 按节点配置选取已发布知识与登记 Skill；未声明 Talents 已执行推荐或本次已采用。':'此任务与节点尚未配置相关输入。',missingSkillIds:[],knowledge:[],skills:[]}};
 if(!preset)return base;
 // Older task-wide snapshots are immutable. Select only matching recorded packages;
 // never silently substitute today's recommendation for what the agent adopted then.
 const historical=task?.talentInputsSnapshot&&!('nodeId' in task.talentInputsSnapshot)?task.talentInputsSnapshot:undefined;
 if(historical){
  base.knowledge={...structuredClone(historical.knowledge),assets:structuredClone(historical.knowledge.assets.filter(asset=>asset.sourceRecordId===taskId))};
  base.knowledge.status=base.knowledge.assets.length?'ready':'not-built';
  base.skills=structuredClone(historical.skills.filter(skill=>preset.skills.includes(skill.id)));
  base.selection.basis='historical-subset';base.selection.note='仅显示当前节点相关的历史采用内容；新建议未补写为当时采用。';base.selection.missingSkillIds=preset.skills.filter(id=>!base.skills.some(skill=>skill.id===id));
  base.selection.knowledge=base.knowledge.assets.map(asset=>({id:asset.id,slot:preset.knowledge[0]?.slot??'business-documents',nodeId,reason:'复核本需求历史采用的知识记录'}));
 }else if(four){
  const selected=fourRequirementNodes[nodeId],source=await fourRequirementKnowledge(four,published,nodeId,readPublishedFile);
  base.selection.scenario={id:four.id,artifactId:four.artifactId,artifactVersion:four.version,matchedBy:'project-and-exact-title',origin:'scenario-fixture'};
  if(!source){base.selection.status='not-configured';base.selection.note='对应业务需求的固定版本资料尚未发布，请登记后重试导入。';return base;}
  base.selection.note='按业务需求编号、精确标题及原文摘要选择本节点资料。摘要用于导航；完整需求和试验口径须按引用路径读取并核对 SHA256。未声明已采用、执行或验收。';
  base.knowledge={status:'ready',version:String(source.artifact.version),assets:source.documents.map(item=>({id:`talents-shared:${source.artifact.id}:v${source.artifact.version}:${item.file}`,title:item.title,version:String(source.artifact.version),detail:`${four.businessId} · ${four.title}\n${item.reason}。\n此处为资料索引；全文保存在引用文件中，读取后核对版本与 SHA256。完整原始需求 v1.0 保留，第5章规则及独立test-profile-v${four.version}用于本次验证，第12.3正式待确认继续有效。`,origin:'talents-shared',sourceRecordId:taskId,sourceProjectId:projectId,sourceProjectName:ctx.project.name,artifactId:source.artifact.id,contentSha256:item.sha256,references:[{collection:'talents-shared',path:item.path,label:item.title,...(item.absolutePath?{absolutePath:item.absolutePath}:{}),sha256:item.sha256,version:String(source.artifact.version)}]}))};
  base.selection.knowledge=base.knowledge.assets.map((asset,index)=>({id:asset.id,slot:source.documents[index].slot,nodeId,reason:source.documents[index].reason}));
  base.skills=await Promise.all(selected.skills.map(async id=>{const skill=await loadSkill(id,task?.skillBindings?.find(item=>item.id===id));source.assertSkill(skill);return skill;}));
 }else if(scenario){
  const source=await platinumPageKnowledge(published,nodeId,readPublishedFile);
  base.selection.scenario={id:platinumCashbackPage.id,artifactId:platinumCashbackPage.artifactId,artifactVersion:platinumCashbackPage.version,matchedBy:'project-and-exact-title',origin:'scenario-fixture'};
  base.selection.note='按项目与精确标题读取 Talents 已发布的权益说明资料；实际需求说明独立保留，资料差异须澄清，未声明已采用或执行。';
  if(!source){base.selection.status='not-configured';base.selection.note='对应的权益说明知识产物尚未发布到当前共享目录，请先登记资料后重试导入。';return base;}
  base.knowledge={status:'ready',version:String(source.artifact.version),assets:source.documents.map(item=>({id:`talents-shared:${source.artifact.id}:v${source.artifact.version}:${item.file}`,title:item.title,version:String(source.artifact.version),detail:item.content,origin:'talents-shared',sourceRecordId:taskId,sourceProjectId:projectId,sourceProjectName:ctx.project.name,artifactId:source.artifact.id,contentSha256:item.sha256,references:[{collection:'talents-shared',path:item.path,label:item.title}]}))};
  base.selection.knowledge=base.knowledge.assets.map((asset,index)=>({id:asset.id,slot:source.documents[index].slot,nodeId,reason:source.documents[index].reason}));
  base.skills=await Promise.all(scenario.skills.map(id=>loadSkill(id,task?.skillBindings?.find(item=>item.id===id))));
 }else{
  base.knowledge={status:preset.knowledge.length?'ready':'not-built',version:nodePresetVersion,assets:preset.knowledge.map(item=>({id:`talent-node:${projectId}:${taskId}:${nodeId}:${item.id}`,pluginId:'business-knowledge',sourceRecordId:taskId,kind:'knowledge',title:item.title,summary:item.reason,detail:item.content,sourceProjectId:projectId,sourceProjectName:ctx.project.name,origin:'teams-node-preset',version:nodePresetVersion,references:[],relatedRequirementIds:[`requirements:${projectId}:${taskId}`]}))};
  base.selection.knowledge=base.knowledge.assets.map((asset,index)=>({id:asset.id,slot:preset.knowledge[index].slot,nodeId,reason:preset.knowledge[index].reason}));
  base.skills=await Promise.all(preset.skills.map(async id=>{
   return loadSkill(id,task?.skillBindings?.find(item=>item.id===id));
  }));
  const selectedPublished:Record<RequirementNode,string[]>={prepare:['a-biz'],develop:['a-std','a-miner','a-cg-java'],verify:['a-std'],accept:['a-biz']};
  for(const artifact of published.filter(item=>!!knownPreset&&item.projectId===projectId&&selectedPublished[nodeId].includes(item.id))){
   const slot=artifact.id==='a-std'?'project-standards':nodeId==='prepare'?'business-documents':nodeId==='accept'?'acceptance-knowledge':'development-knowledge';
   const id=`talents-shared:${artifact.id}:v${artifact.version}`;
   base.knowledge.assets.push({id,title:artifact.name,version:String(artifact.version),detail:artifact.description,origin:'talents-shared',sourceProjectId:projectId,sourceRecordId:taskId,references:artifact.files.map(file=>({collection:'talents-shared',path:file.path,label:file.title}))});
   base.selection.knowledge.push({id,slot,nodeId,reason:'按项目与当前节点选择的 Talents 已发布产物摘要；原文通过项目知识入口读取'});
  }
 }
 base.selection.skills=base.skills.map(skill=>({id:skill.id,slot:preset.skillSlot,nodeId,reason:'用于'+({prepare:'需求分析与验收标准',develop:'设计与实现',verify:'质量检查',accept:'业务验收'}[nodeId])+'，未声明工具已执行'}));
 return base;
}
