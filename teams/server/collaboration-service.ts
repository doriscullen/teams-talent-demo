import { readTalentNodeInputs } from './talent-node-client.js';
import type {TalentNodeInputs} from '../src/talent-node-inputs.js';
import { importedNodeStages, importedTaskNodeView } from '../src/imported-delivery.js';
import { taskArtifactKinds, taskNodeContractVersion, taskNodeDefinitions, taskNodeView, nodeResultErrors, unitTestExecutionShapeErrors } from '../src/task-node-contract.js';
import { projectMembers } from '../src/teams-domain.js';
const projectMemberName=(state:DemoState,projectId:string,id:string)=>projectMembers(state,projectId).find(member=>member.id===id)?.name ?? id;
import { deliveryRequirement, requireDeliveryMember, applyRequirementProgress, type RequirementNode } from '../src/delivery-requirements.js';
import type { TalentTaskInputs } from '../src/talent-contract.js';
import { mainTask, taskAutomation, taskNodeKnowledge, queueNextNodeKnowledge } from '../src/task-automation.js';
import { requireCurrentTaskMember, taskAssigneeId, taskAssigneeName } from '../src/task-assignment.js';
import { selectedSkillBindings } from '../src/resource-sharing.js';
import { currentProjectSkillPackage, loadNativeSkillPackage, loadSourceSkillPackage } from './skill-packages.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError, type DemoState, type Role } from '../src/domain.js';
import type { Presentation } from '../src/api.js';
import type { CollaborationScope, CollaborationEvidence, CollaborationReceipt } from '../src/collaboration.js';
import { userSkillExamples } from '../src/project-skill-examples.js';
import { createSourcePluginCatalog } from '../src/source-plugins.js';
import { legacyAssetSourceIds } from '../src/project-asset-links.js';
import { root, talentOrigin } from './config.js';
import { sharedTaskInputs } from './talent-intake.js';
import { projectKnowledge } from './shared-data.js';
import type { Store } from './store.js';

export const collaborationSkillPath = join(root, 'skills/teams-demo-collaboration/SKILL.md');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function need(value: unknown, message: string, status = 400): asserts value { if (!value) throw new DomainError(message, status); }
const string = (value: unknown, name: string, limit = 200) => { need(typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), `${name} 无效`); return value.trim(); };
export function checkedCollaborationScope(value: unknown): CollaborationScope {
  need(value && typeof value === 'object' && !Array.isArray(value), 'scope 无效');
  const v = value as Record<string, unknown>;
  const scope: CollaborationScope = { projectId: string(v.projectId, 'projectId') };
  for (const key of ['taskId', 'nodeId', 'tab'] as const) if (v[key] !== undefined) scope[key] = string(v[key], key);
  need(!scope.nodeId || scope.taskId, 'nodeId 必须携带 taskId'); return scope;
}
const cardNodes = Object.fromEntries(Object.entries(taskNodeDefinitions).map(([id,node])=>[id,{name:node.label,brief:node.inputRequirements.map(item=>item.label).join('、'),output:node.deliverableRequirements.map(item=>item.label).join('、')}]));
/** Reads exact project/task/node basis. Does not freeze, adopt, launch or mutate state. */
export async function collaborationContext(state: DemoState, data: Presentation, input: unknown) {
  const scope = checkedCollaborationScope(input), card = scope.projectId === 'carddemo', teams = scope.projectId === 'teams';
  const created = state.workspace.projects?.find(p => p.id === scope.projectId);
  need(card || teams || created, '项目不存在', 404);
  const live = deliveryRequirement(state,scope.projectId,scope.taskId);
  const task = teams && scope.taskId ? data.teamsProject.tasks.find(t => t.id === scope.taskId) : undefined;
  if (scope.taskId) need(Boolean(live) || (card ? scope.taskId === 'DEMO-MKT-001' : Boolean(task)), '任务不属于所选项目', 404);
  const node = scope.nodeId ? card || live ? cardNodes[scope.nodeId as keyof typeof cardNodes] : task?.nodes.find(n => n.id === scope.nodeId) : undefined;
  if (scope.nodeId) need(node, '节点不属于所选任务', 404);
  const frozen = card && !!scope.taskId && (!live || live.legacyBasis?.contextId && !live.talentInputsSnapshot) ? state.context : null;
  const scopedNode = scope.nodeId && (live || task) ? (live ? scope.nodeId : importedNodeStages[scope.nodeId] ?? scope.nodeId) as RequirementNode : undefined;
  const selectedSkills = scopedNode ? [] : live ? [...live.skillIds,...(live.userSkillIds??[])] : card ? frozen?.selectedSkills ?? state.workspace.selectedSkills : [];
  const materials = card&&scope.taskId==='DEMO-MKT-001' ? frozen?.materials ?? state.workspace.materials : [];
  const assets = card ? frozen?.assets ?? state.workspace.project.assets : created?.assets ?? [];
  const catalog = createSourcePluginCatalog(data);
  const raw = teams ? catalog.list({ sourceProjectId: 'teams' }).filter(a => a.kind === 'repository' || a.kind === 'document') : assets.flatMap(asset => legacyAssetSourceIds(asset).flatMap(id => { const found = catalog.get(id); return found ? [found] : []; }));
  const nodeReferences=scopedNode?raw.filter(asset=>(scopedNode==='develop'||scopedNode==='verify')&&(asset.kind==='repository'||asset.kind==='code')):raw;
  const references = [...new Map(nodeReferences.map(a => [a.id, a])).values()].map(asset => ({ id: asset.id, title: asset.title, kind: asset.kind, version: asset.version ?? 'imported-snapshot', origin: asset.origin, references: asset.references.map(ref => ({ ...ref, content: catalog.readReference(ref) ?? null, loadedByAgent: false })) }));
  const bindings = live?.skillBindings??frozen?.skillBindings ?? (!frozen ? selectedSkillBindings(state, 'member') : []);
  let skills: {id:string;scope:string;version:string;path:string|null;content:string|null;availability:string;loadedByAgent:boolean;sha256?:string|null;contentSha256?:string|null;files?:{path:string;sha256:string;executable:boolean}[];error?:string}[] = await Promise.all(selectedSkills.map(async id => {
    const user = userSkillExamples.find(s => s.id === id), project = data.skills.find(s => s.name === id);
    if (user) return {id,scope:'user',version:id==='teams-collaboration'?'demo-cli-v1':'example-v1',path:id==='teams-collaboration'?collaborationSkillPath:null,content:id==='teams-collaboration'?await readFile(collaborationSkillPath,'utf8'):user.content,availability:id==='teams-collaboration'?'demo-local-cli':'example-only',loadedByAgent:false};
    // Before the context is frozen a project skill is used at its current version, including one Talents wrote; a frozen context keeps its version.
    const binding = bindings.find(item=>item.id===id), expectedVersion = binding?.version ?? (frozen ? (id==='dev-frontend-ui' ? frozen.skillVersion : project?.version) : undefined);
    try {
      const pkg=binding?.sha256 ? await loadNativeSkillPackage(id,binding.version,binding.sha256) : frozen ? await loadSourceSkillPackage(id) : await currentProjectSkillPackage(scope.projectId,id);
      if(expectedVersion && pkg.version!==expectedVersion) throw new Error('冻结版本与实际文件版本不一致');
      const primary=pkg.files.find(file=>file.path==='SKILL.md')!;
      if(binding?.contentSha256 && primary.sha256!==binding.contentSha256)throw new Error('冻结正文摘要与内容包不一致');
      return {id,scope:binding?.source??'project',version:pkg.version,sha256:pkg.sha256,contentSha256:primary.sha256,path:binding?.sha256?null:project?.path??null,content:primary.bytes.toString('utf8'),files:pkg.files.map(({path,sha256,executable})=>({path,sha256,executable})),availability:binding?.sha256?'fixed-subscription-package':'imported-local-file',loadedByAgent:false};
    } catch(error) {
      return {id,scope:binding?.source??'project',version:expectedVersion??'unknown',sha256:binding?.sha256??null,contentSha256:binding?.contentSha256??null,path:null,content:null,availability:frozen?'frozen-version-unavailable':'source-version-unavailable',error:(error as Error).message,loadedByAgent:false};
    }
  }));
  let talentInputs:TalentTaskInputs | null = live?.talentInputsSnapshot ?? null;
  let nodeInputs:TalentNodeInputs|null=null;
  let knowledge: { status: string; origin: string; selectedVersion: string | null; assets: unknown[]; error?: string };
  if(scopedNode&&scope.taskId){
    try{nodeInputs=await readTalentNodeInputs(state,data,{projectId:scope.projectId,taskId:scope.taskId,nodeId:scopedNode});talentInputs=nodeInputs;knowledge={status:nodeInputs.knowledge.assets.length?'available':'not-built',origin:talentOrigin,selectedVersion:nodeInputs.knowledge.version??null,assets:nodeInputs.knowledge.assets};skills=nodeInputs.skills.map(item=>({...item,scope:'talent',path:null,files:[],availability:nodeInputs!.selection.basis==='historical-subset'?'historical-node-subset':'talent-node-input',loadedByAgent:false}));}
    catch(error){knowledge={status:'unavailable',origin:talentOrigin,selectedVersion:null,assets:[],error:(error as Error).message};skills=[];}
  } else if (live && !frozen) {
    try {
      talentInputs ??= await sharedTaskInputs(state, scope.projectId, live.id);
      if(talentInputs.projectId!==scope.projectId||talentInputs.taskId!==live.id||!Array.isArray(talentInputs.skills)||!Array.isArray(talentInputs.knowledge.assets))throw new Error('Talents 输入范围或结构无效');
      knowledge={status:talentInputs.knowledge.assets.length?'available':'not-built',origin:talentOrigin,selectedVersion:talentInputs.knowledge.version??null,assets:talentInputs.knowledge.assets};
      skills=[...talentInputs.skills.map(item=>({id:item.id,scope:'talent',version:item.version,sha256:item.sha256,contentSha256:item.contentSha256,path:null,content:item.content,files:[],availability:'talent-registered-asset',loadedByAgent:false})),...skills.filter(item=>item.scope==='user')];
    }catch(error){knowledge={status:'unavailable',origin:talentOrigin,selectedVersion:null,assets:[],error:(error as Error).message};skills=[];}
  } else {
  try {
    // Published Talents artifacts for this project, read from the shared data directory.
    const published = await projectKnowledge(scope.projectId);
    const assets = frozen ? published.filter(artifact => `${artifact.name} v${artifact.version}` === frozen.knowledgeVersion) : published;
    knowledge = { status: assets.length ? 'available' : frozen ? 'frozen-version-unavailable' : 'not-built', origin: talentOrigin, selectedVersion: frozen?.knowledgeVersion ?? null, assets };
  } catch (error) { knowledge = { status: 'unavailable', origin: talentOrigin, selectedVersion: frozen?.knowledgeVersion ?? null, assets: [], error: (error as Error).message }; }
  }
  const agreement = live ? {id:live.id,title:live.title,assignee:{id:live.assigneeId,name:projectMemberName(state,live.projectId,live.assigneeId)},background:live.description,criteria:[],revision:'requirement-v1:'+live.createdAt} : card && scope.taskId ? { id: scope.taskId, title: data.blueprint.scenario.slice, assignee: { id: taskAssigneeId(state), name: taskAssigneeName(state) }, background: data.blueprint.scenario.parent_requirement, criteria: data.blueprint.acceptance_criteria, revision: 'demo-r1' } : task ? { id: task.id, title: task.title, background: task.goal, scope: task.scope, criteria: task.criteria, revision: data.teamsProject.sourceCommit } : { id: scope.projectId, title: card ? state.workspace.project.name : teams ? data.teamsProject.project.name : created!.name, background: card ? state.workspace.project.description : teams ? data.teamsProject.project.description : created!.description, criteria: [], revision: 'project-preparation' };
  const nodeContract=live&&scopedNode?taskNodeView(state,live,scopedNode,data,nodeInputs):task&&scopedNode?importedTaskNodeView(task,scopedNode,nodeInputs,data):null;
  const basis = { scope, mode: frozen || live?.preparedAt ? 'frozen' : 'preparation', contextId: live?.preparedAt ? 'CTX-'+live.id : frozen?.id ?? null, frozenAt: live?.preparedAt ?? frozen?.createdAt ?? null, agreement, node: node ?? null, assets, materials, references, skills,
    projectSkills: teams && !scopedNode ? data.teamsProject.project.skills : [],
    agent: { name: 'iCode', configuration: card ? { codeAgentVersion: frozen?.agentVersion ?? state.adoptedAgent, instructions: (frozen?.agentVersion ?? state.adoptedAgent) === 'r2' ? '读取项目上下文 → 分析与实施 → 检查实际测试退出码和报告 → 同步问题及证据 → 提交待确认成果。报告缺失保持待验证。' : '读取项目上下文 → 分析与实施 → 运行项目检查 → 提交成果与验证依据。', origin: 'Teams Code Agent 定义', model: '沿用原生 iCode 配置；此上下文未读取模型或凭据' } : { status: 'native-configuration-selected-at-launch' }, loadedByAgent: false }, knowledge };
  const {mode:_mode,contextId:_contextId,frozenAt:_frozenAt,...stableBasis}=basis;
  const basisDigest = hash({...stableBasis,nodeContract:nodeContract?{version:taskNodeContractVersion,definition:nodeContract.definition,inputs:nodeContract.inputs.map(({id,label,references})=>({id,label,references}))}:null});
  const acquisition = scope.taskId && scopedNode && scopedNode!=='accept' ? taskNodeKnowledge(taskAutomation(state,{projectId:scope.projectId,taskId:scope.taskId}),scopedNode) : undefined;
  const preparationReady = !live || !taskAutomation(state,{projectId:live.projectId,taskId:live.id})?.preparation || taskAutomation(state,{projectId:live.projectId,taskId:live.id})!.preparation!.status==='ready';
  return { contract: 'teams-demo-collaboration-v1', revision: state.revision, basisDigest, ...basis,
    talentInputs, nodeInputs, nodeContract:nodeContract?{version:live?.nodeContractVersion??taskNodeContractVersion,...nodeContract}:null,
    automaticPreparation: scope.taskId && scope.nodeId!=='accept' ? taskNodeKnowledge(taskAutomation(state, {projectId:scope.projectId,taskId:scope.taskId}),scope.nodeId==='develop'||scope.nodeId==='verify'?scope.nodeId:'prepare') ?? null : null,
    inputSources: scopedNode ? {knowledge:nodeInputs?.selection.basis==='historical-subset'?'当前节点相关历史采用知识':'Teams 当前节点知识与 Talents 共享产物',skills:'Teams 当前节点所选登记包',talentSkillLoading:nodeInputs?'shared-inputs':'unavailable'} : { knowledge: frozen?'历史冻结的 Talent 知识版本':'Talent 项目知识', skills: live&&!frozen ? 'Talent 登记资产（Teams 源包）' : 'Teams 项目与固定订阅版本', talentSkillLoading: live&&!frozen ? 'connected' : 'not-connected' },
    stage: live ? live.stage : card ? state.stage : task?.status ?? 'no-task',
    adoptedBasis: (state.workspace.collaboration?.adoptions ?? []).filter(a => a.projectId === scope.projectId && a.taskId === scope.taskId && a.nodeId === scope.nodeId),
    events: (state.workspace.collaboration?.events ?? []).filter(e => e.projectId === scope.projectId && (!scope.taskId || e.taskId === scope.taskId) && (!scope.nodeId || e.nodeId === scope.nodeId)),
    availableActions: live && scope.nodeId && scope.nodeId !== 'accept' && preparationReady && (!acquisition || acquisition.status==='ready' || live.nodeInputSnapshots?.[scope.nodeId as RequirementNode]) ? ['inputs.adopt', 'progress.add', 'result.submit'] : ['context.get'],
    safety: { security: 'unverified', contextReadIsAdoption: false, resultIsAcceptance: false }, skillPath: collaborationSkillPath };
}
export function collaborationOperation(state: DemoState, operationId: string) {
  const receipt = state.workspace.collaboration?.operations.find(r => r.operationId === operationId);
  need(receipt, '操作回执不存在；保留原操作 ID 和载荷核对', 404); return { ok: true, receipt };
}
export async function collaborationWrite(store: Store, data: Presentation, body: Record<string, any>) {
  if (body.kind === 'session.report') throw new DomainError('会话随开发或验证进度关联；验收通过后自动归集，无需再次上报', 409);
  need(['inputs.adopt', 'progress.add', 'result.submit'].includes(body.kind), '不支持的协作写操作');
  need(body.role === 'member'||body.role==='owner', '请选择角色', 403);
  const operationId = string(body.operationId, 'operationId', 100), p = body.input;
  need(p && typeof p === 'object' && !Array.isArray(p), 'input 必须为对象');
  const scope = checkedCollaborationScope(p), runId = string(p.runId, 'runId');
  const sessionId = p.sessionId == null ? null : string(p.sessionId, 'sessionId');
  need(scope.taskId && scope.nodeId, '写入必须明确 projectId、taskId、nodeId');
  need(Number.isSafeInteger(p.expectedRevision), 'expectedRevision 必须是读取到的 revision');
  const requestDigest = hash({ role: body.role, kind: body.kind, input: p, operationId });
  const existing = store.state.workspace.collaboration?.operations.find(r => r.operationId === operationId);
  if (existing) { need(existing.requestDigest === requestDigest, '同一 operationId 的载荷不同', 409); return { ok: true, replayed: true, receipt: existing }; }
  const context = await collaborationContext(store.state, data, scope);
  need(scope.nodeId !== 'accept', '验收节点不可通过 CLI 提交或确认', 403);
  const live=deliveryRequirement(store.state,scope.projectId,scope.taskId);
  if(live){requireDeliveryMember(store.state,live,body.role);const preparation=taskAutomation(store.state,scope as {projectId:string;taskId:string})?.preparation;if(preparation&&preparation.status!=='ready')throw new DomainError('当前需求的知识与会话准备尚未完成',409);const acquisition=taskNodeKnowledge(taskAutomation(store.state,scope as {projectId:string;taskId:string}),scope.nodeId as 'prepare'|'develop'|'verify');if(acquisition&&acquisition.status!=='ready'&&!live.nodeInputSnapshots?.[scope.nodeId as RequirementNode])throw new DomainError('当前节点知识尚未获取完成，请等待或重试后重新读取上下文',409);need(scope.nodeId==='prepare'||live.preparedAt,'请先在准备节点采用输入',409);need(!['awaiting-acceptance','accepted'].includes(live.stage),'需求已进入Owner验收',409);need(sessionId,'实际工作回传必须携带原生会话标识');}
  else throw new DomainError('所选任务未纳入本地交付；导入快照保持只读',403);
  const at = new Date().toISOString(); let replayed = false;
  const state = await store.transact(current => {
    const prior = current.workspace.collaboration?.operations.find(r => r.operationId === operationId);
    if (prior) { need(prior.requestDigest === requestDigest, '同一 operationId 的载荷不同', 409); replayed = true; return current; }
    need(current.revision === p.expectedRevision && current.revision === context.revision, 'revision 已变化，请重新读取上下文并核对原操作', 409);
    need(current.workspace.foundation.progressEnabled, '团队协作进度同步未启用', 409);
    const next = structuredClone(current), ledger = next.workspace.collaboration ??= { adoptions: [], events: [], operations: [] };
    const revision = next.revision + 1;
    let adoptionId: string, eventId: string | undefined;
    if (body.kind === 'inputs.adopt') {
      need(p.basisDigest === context.basisDigest, '采用依据已变化，请读取当前上下文', 409);
      const allowed = [...context.references.map(r => r.id), ...context.materials.map(m => m.id), ...context.skills.map(s => s.id), ...context.knowledge.assets.map((a: any) => a.id),...(context.nodeContract?.inputs.flatMap(item=>item.references.map(reference=>reference.id))??[])];
      need(Array.isArray(p.readReferences) && p.readReferences.every((id: unknown) => typeof id === 'string' && allowed.includes(id)), 'readReferences 只能列出当前上下文内实际阅读的引用');
      const selected=deliveryRequirement(next,scope.projectId,scope.taskId);
      if(selected&&scope.nodeId==='prepare'&&!selected.preparedAt){need(context.talentInputs && context.skills.length>0,'Skill 尚未就绪',409);selected.talentInputsSnapshot=context.talentInputs;selected.preparedAt=at;selected.inputDigest=context.basisDigest;selected.nodes.prepare={status:'running',updatedAt:at,summary:'iCode明确采用需求、知识与Skill输入；等待PRD及澄清完成标准'};selected.updatedAt=at;}
      if(selected){need(context.nodeInputs&&context.nodeInputs.selection.status==='configured','当前节点尚未配置输入',409);selected.nodeInputSnapshots??={};selected.nodeInputSnapshots[scope.nodeId as RequirementNode]??=structuredClone(context.nodeInputs);selected.nodeContractVersion??=taskNodeContractVersion;}
      adoptionId = randomUUID();
      ledger.adoptions.push({ ...scope, id: adoptionId, role: body.role, runId, sessionId, basisDigest: context.basisDigest, readReferences: [...new Set(p.readReferences as string[])], at, revision });
    } else {
      adoptionId = string(p.adoptionId, 'adoptionId');
      const adoption = ledger.adoptions.find(a => a.id === adoptionId);
      need(adoption && adoption.projectId === scope.projectId && adoption.taskId === scope.taskId && adoption.nodeId === scope.nodeId && adoption.role === body.role && adoption.runId === runId && adoption.sessionId === sessionId, '采用记录与项目、任务、节点或会话范围不符', 409);
      need(adoption.basisDigest === context.basisDigest, '采用依据已变化，请先核对并明确采用新依据', 409);
      const phase = body.kind === 'result.submit' ? 'result' : p.phase;
      need(['started', 'progress', 'blocked', 'result'].includes(phase) && (body.kind === 'result.submit' || phase !== 'result'), 'phase 无效');
      const summary = string(p.summary, 'summary', 2000), blocker = phase === 'blocked' ? string(p.blocker, 'blocker', 2000) : null;
      need(Array.isArray(p.evidence) && p.evidence.length <= 30, 'evidence 必须为引用数组');
      const evidence: CollaborationEvidence[] = p.evidence.map((e: any) => { need(e && ['reference', 'local-file'].includes(e.kind), '证据类型无效');const result:CollaborationEvidence={kind:e.kind,value:string(e.value,'证据引用',2000),description:string(e.description,'证据说明',1000)};if(e.artifact!==undefined){need(taskArtifactKinds.includes(e.artifact)&&!['owner-decision','delivery-manifest'].includes(e.artifact),'产物类型无效或属于Owner');need(['actual','preset'].includes(e.source),'产物必须明确actual/preset来源');need(e.source!=='preset'||['functional-test-report','code-review-report','static-analysis-report','agent-review-report','security-report','issues-retest'].includes(e.artifact),'仅检查报告可声明为预置');result.artifact=e.artifact;result.version=string(e.version,'产物版本',200);result.source=e.source;if(e.codeVersion!==undefined)result.codeVersion=string(e.codeVersion,'代码版本',200);}
        if(e.execution!==undefined){need(e.artifact==='unit-test-result','执行声明只属于单元测试结果');const errors=unitTestExecutionShapeErrors(e.execution);need(!errors.length,errors.join('；'));result.execution=structuredClone(e.execution);}return result; });
      const completedCriteria=p.completedCriteria??[];need(Array.isArray(completedCriteria)&&new Set(completedCriteria).size===completedCriteria.length&&completedCriteria.every((id:unknown)=>typeof id==='string'&&taskNodeDefinitions[scope.nodeId as RequirementNode].completionCriteria.some(item=>item.id===id)),'完成标准只可引用本节点定义的ID');
      if (phase === 'result') need(evidence.length > 0, '成果报告需要至少一条可核对引用；本地文件只作为本机引用');
      eventId = randomUUID();
      const selected=deliveryRequirement(next,scope.projectId,scope.taskId);
      if(selected?.nodeContractVersion&&phase==='result'){const errors=nodeResultErrors(next,selected,scope.nodeId as RequirementNode,evidence,completedCriteria,p.checks);need(!errors.length,errors.join('；'),409);}
      if(selected)applyRequirementProgress(selected,{nodeId:scope.nodeId as RequirementNode,phase,summary,sessionId,checks:p.checks,evidence},at);
      ledger.events.push({ ...scope, id: eventId, operationId, role: body.role, runId, sessionId, adoptionId, phase, summary, blocker, evidence, completedCriteria, at, revision });
      if(phase==='result'&&selected)queueNextNodeKnowledge(next,{projectId:scope.projectId,taskId:scope.taskId!},scope.nodeId!,at);
    }
    const receipt: CollaborationReceipt = { ...scope, operationId, requestDigest, revision, kind: body.kind, adoptionId, ...(eventId ? { eventId } : {}), at, status: 'saved' };
    ledger.operations.push(receipt); next.revision = revision;
    next.audit.push({ id: revision, at, role: body.role as Role, system: 'Teams', action: 'Teams CLI · ' + body.kind, detail: `${scope.projectId}/${scope.taskId}/${scope.nodeId} · ${operationId}`, origin: 'simulated' });
    return next;
  });
  return { ok: true, replayed, receipt: state.workspace.collaboration!.operations.find(r => r.operationId === operationId)! };
}
