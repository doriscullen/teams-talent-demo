import type {TalentNodeInputs} from './talent-node-inputs.js';
import type { DemoState } from './domain.js';
import type { Presentation } from './api.js';
import type { CollaborationEvidence } from './collaboration.js';
import type { DeliveryRequirement, RequirementNode } from './delivery-requirements.js';
import { taskAutomation,taskNodeKnowledge } from './task-automation.js';
import { createSourcePluginCatalog, taskTestCases } from './source-plugins.js';
import { legacyAssetSourceIds } from './project-asset-links.js';

export const taskNodeContractVersion = 'delivery-node-v2' as const;
export const taskArtifactKinds = ['prd','software-design','code-change','unit-test-result','functional-test-report','code-review-report','static-analysis-report','agent-review-report','security-report','issues-retest','owner-decision','delivery-manifest'] as const;
export type TaskArtifactKind = typeof taskArtifactKinds[number];
export interface UnitTestExecution {
 kind:'unit-tests';codeVersion:string;requiredScopes:string[];notRunScopes:string[];
 runs:Array<{scope:string;command:string;status:'passed'|'failed'|'not-run';exitCode:number|null;passed:number;failed:number;skipped:number;executedAt?:string;excludedSkips?:{count:number;reason:string}}>;
}
/** Shape checks allow incomplete executions to be recorded as blocked/progress. */
export function unitTestExecutionShapeErrors(value:unknown):string[]{
 const e=value as UnitTestExecution,errors:string[]=[];
 const text=(v:unknown,max=4000)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
 const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=1_000_000_000;
 const scopes=(v:unknown)=>Array.isArray(v)&&v.length<=50&&v.every(item=>text(item,500))&&new Set(v).size===v.length;
 if(!e||typeof e!=='object'||e.kind!=='unit-tests'||!text(e.codeVersion,200)||!scopes(e.requiredScopes)||!e.requiredScopes.length||!scopes(e.notRunScopes)||!Array.isArray(e.runs)||e.runs.length>60)return ['单元测试执行声明格式无效：需要必要范围、代码版本、执行列表和未执行范围'];
 for(const run of e.runs){if(!run||!text(run.scope,500)||!text(run.command)||!['passed','failed','not-run'].includes(run.status)||(run.exitCode!==null&&!Number.isSafeInteger(run.exitCode))||!count(run.passed)||!count(run.failed)||!count(run.skipped)||run.executedAt!==undefined&&(!text(run.executedAt,100)||!Number.isFinite(Date.parse(run.executedAt)))||run.excludedSkips!==undefined&&(!run.excludedSkips||typeof run.excludedSkips!=='object'||!count(run.excludedSkips.count)||run.excludedSkips.count>run.skipped||!text(run.excludedSkips.reason,2000)))errors.push('单元测试执行项需要明确命令、范围、真实退出码、测试数量和执行时间；排除的跳过项必须说明');}
 return errors;
}
/** Only reject obvious contradictions. Custom test commands are not guessed from a whitelist. */
export function nonTestCommand(command:string):boolean{
 const text=command.trim().toLowerCase();
 if(/(?:^|\s)-d(?:skiptests|maven\.test\.skip)(?:=(?:true|1)|(?=\s|$))/.test(text)||/(?:^|\s)--(?:skip-tests|skip-test)(?:[=\s]|$)/.test(text))return true;
 if(/(?:^|[\s/\\])node(?:\.exe)?\s+--check(?:\s|$)/.test(text))return true;
 const hasTestGoal=/(?:^|\s)(?:test|verify|surefire:test|failsafe:integration-test|--test)(?:\s|$)/.test(text);
 if(!hasTestGoal&&(/(?:^|[\s/\\])(?:mvn|mvnw|mvn\.cmd|mvnw\.cmd)(?:\s|$)/.test(text)&&/(?:^|\s)(?:compile|test-compile)(?:\s|$)/.test(text)||/(?:^|[\s/\\])(?:tsc|javac)(?:\.exe)?(?:\s|$)/.test(text)))return true;
 return false;
}
/** Declared execution facts, not a server-run command or independent report verification. */
export function unitTestResultErrors(evidence:CollaborationEvidence[],codeVersion?:string):string[]{
 const reports=evidence.filter(item=>item.artifact==='unit-test-result'),errors:string[]=[];
 if(!reports.length)return ['功能开发完成需要单元测试报告及结构化执行声明'];
 for(const report of reports){
  const execution=report.execution;
  if(report.source!=='actual')errors.push('开发单元测试必须实际执行，不能使用预置结果');
  if(!execution){errors.push('单元测试仅有报告引用，执行情况待核对；请回传 execution');continue;}
  const invalid=unitTestExecutionShapeErrors(execution);if(invalid.length){errors.push(...invalid);continue;}
  if(!codeVersion||report.codeVersion!==codeVersion||execution.codeVersion!==codeVersion)errors.push('单元测试必须针对本次提交的同一代码版本');
  if(execution.notRunScopes.length)errors.push('仍有必要测试范围未执行：'+execution.notRunScopes.join('、'));
  for(const scope of execution.requiredScopes)if(!execution.runs.some(run=>run.scope===scope))errors.push('必要单元测试范围缺少执行结果：'+scope);
  for(const run of execution.runs){
   if(run.status!=='passed'||run.exitCode!==0||run.passed<=0||run.failed!==0||run.skipped-(run.excludedSkips?.count??0)!==0||!run.executedAt)errors.push('单元测试尚未完整执行通过：'+run.scope);
   if(nonTestCommand(run.command))errors.push('编译或跳过测试的命令不能作为单元测试通过依据：'+run.scope);
  }
 }
 return errors;
}
export interface TaskNodeDefinition {
 id:RequirementNode; label:string; inputRequirements:{id:string;label:string}[];
 deliverableRequirements:{id:string;label:string;artifact:TaskArtifactKind;optional?:boolean}[];
 completionCriteria:{id:string;label:string}[];
}
export const taskNodeDefinitions:Record<RequirementNode,TaskNodeDefinition>={
 prepare:{id:'prepare',label:'需求澄清',inputRequirements:[{id:'requirement',label:'原始需求'},{id:'business-documents',label:'业务文档与业务规则'},{id:'business-skills',label:'相关业务 Skill'}],deliverableRequirements:[{id:'prd',artifact:'prd',label:'PRD：目标、范围、规则、验收标准、待确认项'}],completionCriteria:[{id:'prepare.boundaries',label:'需求边界明确，PRD 覆盖目标、范围、规则、验收标准及待确认项'},{id:'prepare.confirmed',label:'影响开发的关键事项已有明确确认依据；未确认事项不按已确认处理'}]},
 develop:{id:'develop',label:'功能开发',inputRequirements:[{id:'prd',label:'已确认 PRD'},{id:'code',label:'存量代码与代码图谱'},{id:'development-knowledge',label:'范式开发场景知识'},{id:'project-standards',label:'项目开发规范'}],deliverableRequirements:[{id:'software-design',artifact:'software-design',label:'软件设计文档'},{id:'code-change',artifact:'code-change',label:'GitHub 代码 PR 或提交'},{id:'unit-test-result',artifact:'unit-test-result',label:'单元测试及结果'}],completionCriteria:[{id:'develop.prd',label:'实现与已确认 PRD 对应'},{id:'develop.traceable',label:'设计、代码 PR／提交和单元测试结果可追踪至同一代码版本'},{id:'develop.tests',label:'本次改动必要范围的单元测试已实际执行通过，无未执行的必要测试；编译不能代替测试'},{id:'develop.verifiable',label:'必要单元测试通过后具备验证条件，其余明确非必需的限制已说明'}]},
 verify:{id:'verify',label:'测试验证',inputRequirements:[{id:'prd',label:'PRD 验收标准'},{id:'software-design',label:'软件设计文档'},{id:'code-change',label:'待检查代码版本'},{id:'test-cases',label:'企业测试资产插件 · 本需求测试用例'},{id:'project-standards',label:'项目规范'},{id:'quality-skills',label:'Review／测试／安全 Skill'}],deliverableRequirements:[{id:'functional-test-report',artifact:'functional-test-report',label:'功能测试报告'},{id:'static-analysis-report',artifact:'static-analysis-report',label:'代码静态检查工具报告'},{id:'agent-review-report',artifact:'agent-review-report',label:'Agent Review 报告'},{id:'code-review-report',artifact:'code-review-report',label:'历史综合代码检视报告',optional:true},{id:'security-report',artifact:'security-report',label:'安全报告'},{id:'issues-retest',artifact:'issues-retest',label:'发现问题与复测结果（无问题也需明确记录）'}],completionCriteria:[{id:'verify.complete',label:'功能、静态工具、Agent Review 与安全检查范围齐全，实际执行与预置来源明确'},{id:'verify.blockers',label:'阻塞交付的问题已处理，并保留问题与复测依据'},{id:'verify.current',label:'本轮全部检查通过且指向待验收的同一代码版本'}]},
 accept:{id:'accept',label:'需求验收',inputRequirements:[{id:'prd',label:'PRD 验收标准'},{id:'functional-test-report',label:'功能测试结果'},{id:'static-analysis-report',label:'代码静态检查结果'},{id:'agent-review-report',label:'Agent Review 结果'},{id:'code-review-report',label:'历史综合检视结果'},{id:'security-report',label:'安全结果'},{id:'code-change',label:'交付 PR／提交'}],deliverableRequirements:[{id:'owner-decision',artifact:'owner-decision',label:'Owner 验收结论或退回原因'},{id:'delivery-manifest',artifact:'delivery-manifest',label:'交付清单：引用本需求已登记的产物版本'}],completionCriteria:[{id:'accept.decision',label:'Owner 对照验收依据明确通过或退回；CLI 不能代替确认'}]},
};
/** Existing adopted v1 tasks keep their declared report contract; no historical result is invented. */
export function taskNodeDefinitionFor(task:DeliveryRequirement,node:RequirementNode):TaskNodeDefinition{
 const definition=taskNodeDefinitions[node];
 if(task.nodeContractVersion!=='delivery-node-v1')return definition;
 if(node==='verify')return {...definition,deliverableRequirements:definition.deliverableRequirements.filter(item=>!['static-analysis-report','agent-review-report'].includes(item.artifact)).map(item=>item.artifact==='code-review-report'?{...item,optional:false,label:'代码检视报告（已采用 v1 合同）'}:item)};
 return definition;
}
export interface TaskNodeReference {
 id:string;title:string;artifact?:TaskArtifactKind;kind:'reference'|'local-file'|'record';value?:string;description:string;version:string|null;codeVersion?:string;
 source:'actual'|'preset'|'owner'|'legacy';sourceNode?:RequirementNode;sourceLabel:string;execution?:UnitTestExecution;testCase?:{id:string;expected:string;pluginId:'test-assets'};
}
export interface TaskNodeItem {id:string;label:string;status:'ready'|'missing'|'unregistered';references:TaskNodeReference[]}
export interface TaskNodeView {definition:TaskNodeDefinition;inputs:TaskNodeItem[];deliverables:TaskNodeItem[];criteria:{id:string;label:string;status:'reported'|'pending'|'unregistered';evidenceIds:string[]}[];artifacts:TaskNodeReference[]}
export function taskArtifacts(state:DemoState,task:DeliveryRequirement):TaskNodeReference[]{
 const events=(state.workspace.collaboration?.events??[]).filter(event=>event.projectId===task.projectId&&event.taskId===task.id&&event.phase==='result');
 return events.flatMap(event=>event.evidence.map((evidence,index)=>({id:'artifact:'+event.id+':'+index,title:evidence.description,artifact:evidence.artifact,kind:evidence.kind,value:evidence.value,description:evidence.description,version:evidence.version??null,...(evidence.codeVersion?{codeVersion:evidence.codeVersion}:{}),...(evidence.execution?{execution:structuredClone(evidence.execution)}:{}),source:evidence.source??'legacy',sourceNode:event.nodeId as RequirementNode,sourceLabel:evidence.artifact==='unit-test-result'?(evidence.execution?'单元测试执行声明 · 未独立核验':'单元测试报告 · 执行情况待核对'):evidence.source==='preset'?'CLI 预置检查记录':evidence.source==='actual'?'CLI 实际成果回传':'历史未分类成果引用'})));
}
export function latestTaskArtifacts(state:DemoState,task:DeliveryRequirement):TaskNodeReference[]{
 const latest=new Map<string,TaskNodeReference>();for(const item of taskArtifacts(state,task))if(item.artifact)latest.set(item.artifact,item);return [...latest.values()];
}
export function taskNodeView(state:DemoState,task:DeliveryRequirement,node:RequirementNode,data?:Presentation,nodeInputs?:TalentNodeInputs|null):TaskNodeView{
 const definition=taskNodeDefinitionFor(task,node),artifacts=taskArtifacts(state,task),latest=latestTaskArtifacts(state,task),auto=taskAutomation(state,{projectId:task.projectId,taskId:task.id})?.knowledge?.inputs;
 const ref=(id:string,title:string,description:string,version:string|null,sourceLabel:string):TaskNodeReference=>({id,title,kind:'record',description,version,source:'actual',sourceLabel});
 const requirement=ref('requirement:'+task.projectId+':'+task.id,task.title,task.description,task.createdAt,'任务原始需求');
 const projectAssets=task.projectId==='carddemo'?state.workspace.project.assets:state.workspace.projects?.find(item=>item.id===task.projectId)?.assets??[];
 const catalog=data?createSourcePluginCatalog(data):null;
 const sourceRefs=projectAssets.flatMap(asset=>legacyAssetSourceIds(asset).flatMap(id=>{const item=catalog?.get(id);return item?[{...ref(item.id,item.title,item.summary,item.version??null,'项目关联来源 · '+item.pluginId),sourceKind:item.kind}]:[]}));
 const acquisition=node==='accept'?undefined:taskNodeKnowledge(taskAutomation(state,{projectId:task.projectId,taskId:task.id}),node);
 const upstream=(kind:string)=>(acquisition?.status==='ready'&&acquisition.upstream?acquisition.upstream:latest).filter(item=>item.artifact===kind);
 const mapping:Record<string,TaskNodeReference[]>={requirement:[requirement],
  prd:upstream('prd'),code:[...sourceRefs.filter(item=>item.sourceKind==='repository'||item.sourceKind==='code'),...(sourceRefs.some(item=>item.id==='repository:carddemo:carddemo-java-1025')?data?.graph??[]:[]).map(item=>ref('graph:'+item.id,item.name,item.description,null,'已有代码图谱／源码节选'))],
  'software-design':upstream('software-design'),'code-change':upstream('code-change'),'test-cases':acquisition?.status==='ready'&&acquisition.externalInputs?acquisition.externalInputs:data?enterpriseTestCaseReferences(data,task):[],'functional-test-report':upstream('functional-test-report'),'code-review-report':upstream('code-review-report'),'static-analysis-report':upstream('static-analysis-report'),'agent-review-report':upstream('agent-review-report'),'security-report':upstream('security-report')};
 const toItem=(item:{id:string;label:string},references:TaskNodeReference[]):TaskNodeItem=>({...item,status:references.length?'ready':task.nodes[node].status==='complete'?'unregistered':'missing',references});
 const inputs=definition.inputRequirements.map(item=>toItem(item,mapping[item.id]??[]));
 applyTalentNodeInputs(inputs,nodeInputs);
 if(acquisition&&acquisition.status!=='ready'&&!task.nodeInputSnapshots?.[node])inputs.splice(0,inputs.length,{id:'requirement',label:'原始需求',status:'ready',references:[requirement]});
 // Earlier verification reports stay in history, but cannot satisfy a new round.
 const superseded=new Set((taskAutomation(state,{projectId:task.projectId,taskId:task.id})?.nodeKnowledgeHistory??[]).filter(round=>round.nodeId===node).flatMap(round=>round.resultEventIds));
 const currentResults=(state.workspace.collaboration?.events??[]).filter(event=>event.projectId===task.projectId&&event.taskId===task.id&&event.nodeId===node&&event.phase==='result'&&!superseded.has(event.id));
 const currentReferenceIds=new Set(currentResults.flatMap(event=>event.evidence.map((_,index)=>'artifact:'+event.id+':'+index)));
 const own=latest.filter(item=>item.sourceNode===node&&currentReferenceIds.has(item.id));
 if(node==='accept'&&(task.stage==='accepted'||task.stage==='returned'))own.push({...ref('owner-decision:'+task.projectId+':'+task.id+':'+(task.acceptedAt??task.nodes.accept.updatedAt),task.stage==='accepted'?'Owner 验收通过':'Owner 退回',task.nodes.accept.summary,task.acceptedAt??task.nodes.accept.updatedAt,'Owner 任务确认记录'),artifact:'owner-decision',source:'owner',sourceNode:'accept'});
 if(node==='accept'&&task.stage==='accepted'&&latest.length)own.push({...ref('delivery-manifest:'+task.projectId+':'+task.id+':'+task.acceptedAt,'已登记交付清单',latest.map(item=>item.id).join('\n'),task.acceptedAt??null,'同一任务产物引用清单'),artifact:'delivery-manifest',source:'owner',sourceNode:'accept'});
 const event=currentResults.at(-1);
 return {definition,inputs,deliverables:definition.deliverableRequirements.filter(item=>!item.optional||own.some(value=>value.artifact===item.artifact)).map(item=>toItem(item,own.filter(value=>value.artifact===item.artifact))),criteria:definition.completionCriteria.map(item=>({...item,status:node==='accept'&&(task.stage==='accepted'||task.stage==='returned')||event?.completedCriteria?.includes(item.id)?'reported':task.nodes[node].status==='complete'?'unregistered':'pending',evidenceIds:own.map(item=>item.id)})),artifacts};
}

/** Validate declared evidence, not the content of a remote report or Git provider. */
export function nodeResultErrors(state:DemoState,task:DeliveryRequirement,node:RequirementNode,evidence:CollaborationEvidence[],completedCriteria:readonly string[],checks:unknown):string[]{
 const definition=taskNodeDefinitions[node],errors:string[]=[];
 const declared=new Set<string>();
 for(const item of evidence){if(!item.artifact)continue;if(declared.has(item.artifact))errors.push('同一成果提交的产物类型不可重复：'+item.artifact+'；多文件产物请提交一个清单引用，输入佐证不要标为交付物');declared.add(item.artifact);}
 const failed=node==='verify'&&Array.isArray(checks)&&checks.some(check=>check?.status==='failed');
 if(failed&&completedCriteria.includes('verify.current'))errors.push('存在失败检查，不能声明本轮全部检查通过');
 const legacyReview = task.nodeContractVersion==='delivery-node-v1';
 const requiredDeliverables=definition.deliverableRequirements.filter(item=>node!=='verify'?!item.optional:legacyReview?!['static-analysis-report','agent-review-report'].includes(item.artifact):!item.optional);
 for(const required of failed?[]:requiredDeliverables)if(!evidence.some(item=>item.artifact===required.artifact))errors.push('缺少交付物：'+required.label);
 for(const required of failed?[]:definition.completionCriteria)if(!completedCriteria.includes(required.id))errors.push('尚未明确完成标准：'+required.label);
 if(node==='develop')errors.push(...unitTestResultErrors(evidence,evidence.find(item=>item.artifact==='code-change')?.codeVersion));
 const latest=latestTaskArtifacts(state,task);
 const requiredUpstream=node==='develop'?['prd']:node==='verify'?['prd','software-design','code-change']:[];
 for(const id of requiredUpstream)if(!latest.some(item=>item.artifact===id))errors.push('缺少上游产物：'+id);
 const code=node==='develop'?evidence.find(item=>item.artifact==='code-change'):latest.find(item=>item.artifact==='code-change');
 if(node==='develop'||node==='verify'){
  if(!code?.codeVersion)errors.push('需要明确代码 PR／提交的 codeVersion');
  for(const item of evidence.filter(item=>item.artifact&&item.artifact!=='prd'))if(item.codeVersion!==code?.codeVersion)errors.push('产物代码版本不一致：'+item.description);
 }
 if(node==='verify'&&!failed)for(const artifact of legacyReview?['functional-test-report','code-review-report','security-report']:['functional-test-report','static-analysis-report','agent-review-report','security-report']){
  const report=evidence.find(item=>item.artifact===artifact),matches=Array.isArray(checks)?checks.filter(item=>item?.artifact===artifact):[];
  if(!matches.length)errors.push('缺少报告对应的检查结论：'+artifact);
  if(report&&matches.some(item=>item.source!==report.source))errors.push('报告与检查来源不一致：'+artifact);
 }
 return errors;
}

/** Both UI and CLI place the exact Talent response in its declared node slots. */
export function applyTalentNodeInputs(inputs:TaskNodeItem[],value?:TalentNodeInputs|null){
 if(!value)return;
 const add=(slot:string,label:string,reference:TaskNodeReference)=>{let item=inputs.find(item=>item.id===slot);if(!item){item={id:slot,label,status:'missing',references:[]};inputs.push(item);}item.references.push(reference);item.status='ready';};
 for(const selected of value.selection.knowledge){const asset=value.knowledge.assets.find(item=>item.id===selected.id);if(!asset)continue;add(selected.slot,selected.slot==='verification-knowledge'?'本需求验证知识':selected.slot==='acceptance-knowledge'?'验收口径与清单':'节点知识',{id:asset.id,title:asset.title,description:asset.detail+'\n关联理由：'+selected.reason,kind:'record',version:asset.version??null,source:value.selection.basis==='historical-subset'?'legacy':'preset',sourceLabel:value.selection.basis==='historical-subset'?'历史采用知识 · 当前节点相关部分':value.selection.source==='teams-node-selection'?(asset.origin==='talents-shared'?'Talents 已发布知识 · Teams 节点筛选':'Teams 节点知识配置'):'Talent 节点知识',value:JSON.stringify({scope:{projectId:value.projectId,taskId:value.taskId,nodeId:value.nodeId},selection:value.selection.source,version:value.selection.version,origin:asset.origin,reason:selected.reason})});}
 for(const selected of value.selection.skills){const skill=value.skills.find(item=>item.id===selected.id);if(!skill)continue;add(selected.slot,selected.slot==='development-skills'?'设计与开发 Skill':selected.slot==='acceptance-skills'?'验收 Skill':'节点 Skill',{id:skill.id,title:skill.name,description:selected.reason,kind:'record',version:skill.version,source:value.selection.basis==='historical-subset'?'legacy':'actual',sourceLabel:value.selection.basis==='historical-subset'?'历史采用 Skill · 当前节点相关部分':'Talent 节点 Skill',value:JSON.stringify({source:skill.source,sha256:skill.sha256,contentSha256:skill.contentSha256,nodeId:value.nodeId,reason:selected.reason})});}
}

/** Enterprise test definitions are independent of Talent knowledge and are never execution results. */
export function enterpriseTestCaseReferences(data:Presentation,task:{projectId:string;id:string;title:string}):TaskNodeReference[]{
 return taskTestCases(data,task).map(item=>({id:item.id,title:item.sourceRecordId+' · '+item.title,kind:'record',description:item.detail,version:item.version??null,source:'preset',sourceLabel:'企业测试资产插件 · 用例定义（未执行）',testCase:{id:item.sourceRecordId,expected:item.testCase!.expected,pluginId:'test-assets'},value:JSON.stringify({pluginId:item.pluginId,caseId:item.sourceRecordId,version:item.version,expected:item.testCase!.expected,sourceProjectId:item.sourceProjectId,taskId:task.id})}));
}
