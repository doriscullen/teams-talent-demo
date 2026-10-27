import { projectMembers } from '../src/teams-domain.js';
const projectMemberName=(state:DemoState,projectId:string,id:string)=>projectMembers(state,projectId).find(member=>member.id===id)?.name ?? id;
import { deliveryRequirement, requireDeliveryMember, applyRequirementProgress, type RequirementNode } from '../src/delivery-requirements.js';
import type { TalentTaskInputs } from '../src/talent-contract.js';
import { mainTask, taskAutomation } from '../src/task-automation.js';
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
const cardNodes = {
  prepare: { name: '需求准备', brief: '核对需求、验收标准和材料，明确采用的 Skill 与知识版本。', output: '准备说明与实际采用依据' },
  develop: { name: '开发', brief: '按冻结的范围实现；报告里程碑、阻塞与可核对证据。', output: '变更摘要、验证证据及剩余问题' },
  verify: { name: '验证', brief: '核对功能检查、失败与复测记录；安全缺口保持未验证。', output: '真实检查范围、结果与证据引用' },
  accept: { name: '验收', brief: 'Owner 对照标准验收；CLI 只提供读取，不能代替确认。', output: 'Owner 验收结论' },
};
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
  const frozen = card && !!scope.taskId && !live ? state.context : null;
  const selectedSkills = live ? live.skillIds : card ? frozen?.selectedSkills ?? state.workspace.selectedSkills : [];
  const materials = live ? [] : card ? frozen?.materials ?? state.workspace.materials : [];
  const assets = card ? frozen?.assets ?? state.workspace.project.assets : created?.assets ?? [];
  const catalog = createSourcePluginCatalog(data);
  const raw = teams ? catalog.list({ sourceProjectId: 'teams' }).filter(a => a.kind === 'repository' || a.kind === 'document') : assets.flatMap(asset => legacyAssetSourceIds(asset).flatMap(id => { const found = catalog.get(id); return found ? [found] : []; }));
  const references = [...new Map(raw.map(a => [a.id, a])).values()].map(asset => ({ id: asset.id, title: asset.title, kind: asset.kind, version: asset.version ?? 'imported-snapshot', origin: asset.origin, references: asset.references.map(ref => ({ ...ref, content: catalog.readReference(ref) ?? null, loadedByAgent: false })) }));
  const bindings = frozen?.skillBindings ?? (!frozen ? selectedSkillBindings(state, 'member') : []);
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
  let knowledge: { status: string; origin: string; selectedVersion: string | null; assets: unknown[]; error?: string };
  if (live) {
    try {
      talentInputs ??= await sharedTaskInputs(state, scope.projectId, live.id);
      if(talentInputs.projectId!==scope.projectId||talentInputs.taskId!==live.id||!Array.isArray(talentInputs.skills)||!Array.isArray(talentInputs.knowledge.assets))throw new Error('Talents 输入范围或结构无效');
      knowledge={status:talentInputs.knowledge.assets.length?'available':'not-built',origin:talentOrigin,selectedVersion:talentInputs.knowledge.version??null,assets:talentInputs.knowledge.assets};
      skills=talentInputs.skills.map(item=>({id:item.id,scope:'project',version:item.version,sha256:item.sha256,contentSha256:item.contentSha256,path:null,content:item.content,files:[],availability:'teams-registered-package',loadedByAgent:false}));
    }catch(error){knowledge={status:'unavailable',origin:talentOrigin,selectedVersion:null,assets:[],error:(error as Error).message};skills=[];}
  } else {
  try {
    // Published Talents artifacts for this project, read from the shared data directory.
    const published = await projectKnowledge(scope.projectId);
    const assets = frozen ? published.filter(artifact => `${artifact.name} v${artifact.version}` === frozen.knowledgeVersion) : published;
    knowledge = { status: assets.length ? 'available' : frozen ? 'frozen-version-unavailable' : 'not-built', origin: talentOrigin, selectedVersion: frozen?.knowledgeVersion ?? null, assets };
  } catch (error) { knowledge = { status: 'unavailable', origin: talentOrigin, selectedVersion: frozen?.knowledgeVersion ?? null, assets: [], error: (error as Error).message }; }
  }
  const agreement = live ? {id:live.id,title:live.title,assignee:{id:live.assigneeId,name:projectMemberName(state,live.projectId,live.assigneeId)},background:live.description,criteria:[],revision:live.inputDigest??'requirement-v1'} : card && scope.taskId ? { id: scope.taskId, title: data.blueprint.scenario.slice, assignee: { id: taskAssigneeId(state), name: taskAssigneeName(state) }, background: data.blueprint.scenario.parent_requirement, criteria: data.blueprint.acceptance_criteria, revision: 'demo-r1' } : task ? { id: task.id, title: task.title, background: task.goal, scope: task.scope, criteria: task.criteria, revision: data.teamsProject.sourceCommit } : { id: scope.projectId, title: card ? state.workspace.project.name : teams ? data.teamsProject.project.name : created!.name, background: card ? state.workspace.project.description : teams ? data.teamsProject.project.description : created!.description, criteria: [], revision: 'project-preparation' };
  const basis = { scope, mode: frozen || live?.preparedAt ? 'frozen' : 'preparation', contextId: live?.preparedAt ? 'CTX-'+live.id : frozen?.id ?? null, frozenAt: live?.preparedAt ?? frozen?.createdAt ?? null, agreement, node: node ?? null, assets, materials, references, skills,
    projectSkills: teams ? data.teamsProject.project.skills : [],
    agent: { name: 'iCode', configuration: card ? { codeAgentVersion: frozen?.agentVersion ?? state.adoptedAgent, instructions: (frozen?.agentVersion ?? state.adoptedAgent) === 'r2' ? '读取项目上下文 → 分析与实施 → 检查实际测试退出码和报告 → 同步问题及证据 → 提交待确认成果。报告缺失保持待验证。' : '读取项目上下文 → 分析与实施 → 运行项目检查 → 提交成果与验证依据。', origin: 'Teams Code Agent 定义', model: '沿用原生 iCode 配置；此上下文未读取模型或凭据' } : { status: 'native-configuration-selected-at-launch' }, loadedByAgent: false }, knowledge };
  const basisDigest = hash(basis);
  return { contract: 'teams-demo-collaboration-v1', revision: state.revision, basisDigest, ...basis,
    talentInputs,
    automaticPreparation: scope.taskId ? taskAutomation(state, {projectId:scope.projectId,taskId:scope.taskId})?.knowledge ?? null : null,
    inputSources: { knowledge: 'Teams 需求与 Talents 已发布知识', skills: 'Teams 项目与固定订阅版本', talentSkillLoading: 'not-connected' },
    stage: live ? live.stage : card ? state.stage : task?.status ?? 'no-task',
    adoptedBasis: (state.workspace.collaboration?.adoptions ?? []).filter(a => a.projectId === scope.projectId && a.taskId === scope.taskId && a.nodeId === scope.nodeId),
    events: (state.workspace.collaboration?.events ?? []).filter(e => e.projectId === scope.projectId && (!scope.taskId || e.taskId === scope.taskId) && (!scope.nodeId || e.nodeId === scope.nodeId)),
    availableActions: scope.taskId && scope.nodeId && scope.nodeId !== 'accept' ? ['inputs.adopt', 'progress.add', 'result.submit'] : ['context.get'],
    safety: { security: 'unverified', contextReadIsAdoption: false, resultIsAcceptance: false }, skillPath: collaborationSkillPath };
}
export function collaborationOperation(state: DemoState, operationId: string) {
  const receipt = state.workspace.collaboration?.operations.find(r => r.operationId === operationId);
  need(receipt, '操作回执不存在；保留原操作 ID 和载荷核对', 404); return { ok: true, receipt };
}
export async function collaborationWrite(store: Store, data: Presentation, body: Record<string, any>) {
  if (body.kind === 'session.report') throw new DomainError('会话随开发或验证进度关联；验收通过后自动归集，无需再次上报', 409);
  need(['inputs.adopt', 'progress.add', 'result.submit'].includes(body.kind), '不支持的协作写操作');
  need(body.role === 'member', 'CLI 贡献写入仅供项目成员；Owner 确认须通过验收流程', 403);
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
  if(live){requireDeliveryMember(store.state,live,body.role);need(scope.nodeId==='prepare'||live.preparedAt,'请先在准备节点采用输入',409);need(!['awaiting-acceptance','accepted'].includes(live.stage),'需求已进入Owner验收',409);need(sessionId,'实际工作回传必须携带原生会话标识');}
  else if (scope.projectId === 'carddemo') {
    requireCurrentTaskMember(store.state);
    need(store.state.assigned, '请先由 Owner 确认并分配需求', 409);
    need(scope.nodeId === 'prepare' || store.state.context, '开发与验证须先冻结需求上下文', 409);
    need(!['submitted', 'accepted'].includes(store.state.stage), '当前交付已提交或已验收；请通过原交付流程处理反馈', 409);
  } else {
    need(!['已验收', '待验收'].includes(context.stage), '当前任务已进入验收；保留原确认流程', 409);
  }
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
      const allowed = [...context.references.map(r => r.id), ...context.materials.map(m => m.id), ...context.skills.map(s => s.id), ...context.knowledge.assets.map((a: any) => a.id)];
      need(Array.isArray(p.readReferences) && p.readReferences.every((id: unknown) => typeof id === 'string' && allowed.includes(id)), 'readReferences 只能列出当前上下文内实际阅读的引用');
      const selected=deliveryRequirement(next,scope.projectId,scope.taskId);
      if(selected&&scope.nodeId==='prepare'&&!selected.preparedAt){need(context.talentInputs && context.skills.length>0,'Skill 尚未就绪',409);selected.talentInputsSnapshot=context.talentInputs;selected.preparedAt=at;selected.inputDigest=context.basisDigest;selected.nodes.prepare={status:'complete',updatedAt:at,summary:'iCode明确采用需求、知识与Skill输入'};selected.updatedAt=at;}
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
      const evidence: CollaborationEvidence[] = p.evidence.map((e: any) => { need(e && ['reference', 'local-file'].includes(e.kind), '证据类型无效'); return { kind: e.kind, value: string(e.value, '证据引用', 2000), description: string(e.description, '证据说明', 1000) }; });
      if (phase === 'result') need(evidence.length > 0, '成果报告需要至少一条可核对引用；本地文件只作为本机引用');
      eventId = randomUUID();
      const selected=deliveryRequirement(next,scope.projectId,scope.taskId);
      if(selected)applyRequirementProgress(selected,{nodeId:scope.nodeId as RequirementNode,phase,summary,sessionId,checks:p.checks},at);
      if (!selected && scope.projectId === 'carddemo' && scope.nodeId === 'develop' && next.stage === 'assigned' && next.context) next.stage = 'developing';
      ledger.events.push({ ...scope, id: eventId, operationId, role: body.role, runId, sessionId, adoptionId, phase, summary, blocker, evidence, at, revision });
    }
    const receipt: CollaborationReceipt = { ...scope, operationId, requestDigest, revision, kind: body.kind, adoptionId, ...(eventId ? { eventId } : {}), at, status: 'saved' };
    ledger.operations.push(receipt); next.revision = revision;
    next.audit.push({ id: revision, at, role: body.role as Role, system: 'Teams', action: 'Teams CLI · ' + body.kind, detail: `${scope.projectId}/${scope.taskId}/${scope.nodeId} · ${operationId}`, origin: 'simulated' });
    return next;
  });
  return { ok: true, replayed, receipt: state.workspace.collaboration!.operations.find(r => r.operationId === operationId)! };
}
