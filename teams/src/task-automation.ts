import { deliveryRequirement, requireDeliveryMember } from './delivery-requirements.js';
import type { TalentTaskSessionReceipt } from './talent-contract.js';
import { requireCurrentTaskMember, taskAssigneeId } from './task-assignment.js';
import { taskExecutableBy } from './task-visibility.js';
import type { TalentNodeInputs } from './talent-node-inputs.js';
import type { NativePreparationReceipt } from './native-preparation.js';
import { latestTaskArtifacts, type TaskNodeReference } from './task-node-contract.js';
import type { DemoState, Role } from './domain.js';
import { DomainError } from './domain.js';

export interface TaskScope { projectId: string; taskId: string }
export interface TaskSessionLink extends TaskScope {
  tool: 'icode' | 'opencode'; sessionId: string; nodeId: string; source: 'manual'; at: string;
}
export interface CollectedSession {
  tool: 'icode' | 'opencode'; sessionId: string; nodeIds: string[]; runIds: string[];
  sources: string[]; firstAt: string; lastAt: string;
}
export interface ImportedTaskInputs {
  mode: 'preparation' | 'frozen'; contextId: string | null; requirement: string;
  knowledge: { id: string; title: string; version: string }[];
  knowledgeStatus: string; skills: { id: string; version: string; available: boolean }[];
  references: { id: string; title: string; version: string }[]; materials: { id: string; title: string }[];
  notes: string[];
}
interface AutomaticExecution { id: string; attempts: number; startedAt: string; finishedAt: string | null; error?: string }
export interface KnowledgeImport extends AutomaticExecution { status: 'waiting-upstream' | 'queued' | 'running' | 'ready' | 'waiting' | 'failed'; nodeId?:KnowledgeNode; delayMs?:number; queuedAt?:string; basisKey?:string; upstream?:TaskNodeReference[]; externalInputs?:TaskNodeReference[]; inputs?: ImportedTaskInputs; nodeInputs?: TalentNodeInputs }
export type KnowledgeNode='prepare'|'develop'|'verify';
/** Legacy knowledge belongs only to prepare; it must never satisfy another node. */
export const taskNodeKnowledge=(record:TaskAutomation|undefined,node:KnowledgeNode):KnowledgeImport|undefined=>node==='prepare'?record?.knowledge:record?.nodeKnowledge?.[node];
export type PreparedTaskSession = NativePreparationReceipt;
export interface TaskPreparation {
  id:string;basisKey:string;assigneeId:string;status:'queued'|'importing'|'preparing-session'|'ready'|'waiting-directory'|'failed';
  queuedAt:string;startedAt:string|null;updatedAt:string;finishedAt:string|null;attempts:number;retryable:boolean;error?:string;
  progress:Array<{at:string;phase:'knowledge'|'session';status:'started'|'completed'|'waiting'|'failed';summary:string;source:'teams-import'|'native-cli'}>;
  session?:PreparedTaskSession;
}
export interface SessionCollection extends AutomaticExecution { reporting?: { status: 'pending'|'uploading'|'reported'|'failed'; reason: string; receipt?:TalentTaskSessionReceipt }; status: 'queued' | 'running' | 'collected' | 'empty' | 'failed'; sessions: CollectedSession[] }
export interface TaskAutomation extends TaskScope { sessions: TaskSessionLink[]; knowledge?: KnowledgeImport; nodeKnowledge?:Partial<Record<'develop'|'verify',KnowledgeImport>>; preparation?:TaskPreparation; collection?: SessionCollection }
export const mainTask: TaskScope = { projectId: 'carddemo', taskId: 'DEMO-MKT-001' };
export const sameTask = (a: TaskScope, b: TaskScope) => a.projectId === b.projectId && a.taskId === b.taskId;
export const taskAutomation = (state: DemoState, scope: TaskScope) => state.workspace.taskAutomation?.find(item => sameTask(item, scope));
export function mutableTaskAutomation(state: DemoState, scope: TaskScope) {
  state.workspace.taskAutomation ??= [];
  let record = taskAutomation(state, scope);
  if (!record) { record = { ...scope, sessions: [] }; state.workspace.taskAutomation.push(record); }
  return record;
}
/** Current preparation identity; execution status and adopted evidence are deliberately excluded. */
export function taskPreparationBasis(state:DemoState,scope:TaskScope){
 const task=deliveryRequirement(state,scope.projectId,scope.taskId);if(!task)throw new DomainError('交付需求不存在',404);
 return JSON.stringify({projectId:task.projectId,taskId:task.id,title:task.title,description:task.description,assigneeId:task.assigneeId,skillIds:task.skillIds,createdAt:task.createdAt});
}
/** Called only by an explicit create/assign transaction; never infers work for historical tasks. */
export function queueTaskPreparation(state:DemoState,scope:TaskScope,at:string){
 const task=deliveryRequirement(state,scope.projectId,scope.taskId);
 if(!task||task.stage!=='preparing'||task.preparedAt||Object.values(task.nodes).some(node=>node.status!=='pending'))return;
 const record=mutableTaskAutomation(state,scope),basisKey=taskPreparationBasis(state,scope);
 if(record.preparation?.basisKey===basisKey)return;
 record.preparation={id:crypto.randomUUID(),basisKey,assigneeId:task.assigneeId,status:'queued',queuedAt:at,startedAt:null,updatedAt:at,finishedAt:null,attempts:0,retryable:false,progress:[]};
 record.knowledge={id:crypto.randomUUID(),nodeId:'prepare',delayMs:20000,queuedAt:at,basisKey,status:'queued',attempts:0,startedAt:at,finishedAt:null,upstream:[]};
 record.nodeKnowledge={develop:waitingNodeKnowledge('develop',at),verify:waitingNodeKnowledge('verify',at)};
}
function waitingNodeKnowledge(node:'develop'|'verify',at:string):KnowledgeImport{return{id:crypto.randomUUID(),nodeId:node,delayMs:20000,status:'waiting-upstream',attempts:0,startedAt:at,finishedAt:null};}
export function nodeKnowledgeUpstream(state:DemoState,scope:TaskScope,node:'develop'|'verify'){
 const task=deliveryRequirement(state,scope.projectId,scope.taskId);if(!task)throw new DomainError('需求不存在',404);
 const kinds=node==='develop'?['prd']:['prd','software-design','code-change','unit-test-result'];
 return latestTaskArtifacts(state,task).filter(item=>kinds.includes(item.artifact??''));
}
export function nodeKnowledgeBasis(state:DemoState,scope:TaskScope,node:'develop'|'verify'){return JSON.stringify({requirement:taskPreparationBasis(state,scope),nodeId:node,upstream:nodeKnowledgeUpstream(state,scope,node)});}
/** Only a newly confirmed upstream CLI result calls this. Historical states are never inferred as new work. */
export function queueNextNodeKnowledge(state:DemoState,scope:TaskScope,completedNode:string,at:string){
 const node=completedNode==='prepare'?'develop':completedNode==='develop'?'verify':null;if(!node)return;
 const task=deliveryRequirement(state,scope.projectId,scope.taskId);if(!task||task.nodeInputSnapshots?.[node]||task.nodes[node].status!=='pending')return;
 const record=mutableTaskAutomation(state,scope),existing=record.nodeKnowledge?.[node];
 const upstream=nodeKnowledgeUpstream(state,scope,node),required=node==='develop'?['prd']:['prd','software-design','code-change'];
 if(required.some(kind=>!upstream.some(item=>item.artifact===kind)))return;
 const basisKey=nodeKnowledgeBasis(state,scope,node);
 if(existing?.basisKey===basisKey)return;
 // Only unadopted suggestions can be replaced. A new identity fences off any
 // in-flight import of the previous upstream version; adopted snapshots above
 // and the original collaboration result events remain unchanged.
 record.nodeKnowledge??={};record.nodeKnowledge[node]={id:existing?.status==='waiting-upstream'?existing.id:crypto.randomUUID(),nodeId:node,delayMs:20000,queuedAt:at,basisKey,upstream:structuredClone(upstream),status:'queued',attempts:0,startedAt:at,finishedAt:null};
}
export function requireWritableTask(scope: TaskScope,state?:DemoState) {
  if (!sameTask(scope, mainTask) && !(state&&deliveryRequirement(state,scope.projectId,scope.taskId))) throw new DomainError('所选任务不支持写入自动步骤；导入项目记录保持只读', 403);
}
export function canLinkTaskSession(state: DemoState, role: Role, scope: TaskScope, nodeId: string) {
  if (!['develop', 'verify'].includes(nodeId)) return false;
  const task = deliveryRequirement(state, scope.projectId, scope.taskId);
  return task ? taskExecutableBy(role, task.assigneeId) && !!task.preparedAt && !['awaiting-acceptance', 'accepted'].includes(task.stage)
    : sameTask(scope, mainTask) && role === 'member' && taskExecutableBy(role, taskAssigneeId(state)) && state.assigned && !!state.context && !['submitted', 'accepted'].includes(state.stage);
}
export function linkTaskSession(state: DemoState, role: Role, input: Record<string, unknown>, at: string) {
  const scope = { projectId: String(input.projectId ?? ''), taskId: String(input.taskId ?? '') }; requireWritableTask(scope,state);
  const live=deliveryRequirement(state,scope.projectId,scope.taskId);
  if(live)requireDeliveryMember(state,live,role);else requireCurrentTaskMember(state);
  if (!live && role !== 'member') throw new DomainError('仅当前交付人可以关联工作会话', 403);
  if (live ? !live.preparedAt || ['awaiting-acceptance','accepted'].includes(live.stage) : !state.assigned || !state.context || ['submitted', 'accepted'].includes(state.stage)) throw new DomainError('请在需求上下文冻结后、交付提交前关联开发或验证会话');
  if (!['develop', 'verify'].includes(String(input.nodeId))) throw new DomainError('会话应关联到开发或验证节点');
  if (!['icode', 'opencode'].includes(String(input.tool)) || typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 200 || /[\x00-\x1f]/.test(input.sessionId)) throw new DomainError('工具或会话标识无效');
  const record = mutableTaskAutomation(state, scope), sessionId = input.sessionId.trim();
  if (!record.sessions.some(item => item.tool === input.tool && item.sessionId === sessionId && item.nodeId === input.nodeId)) record.sessions.push({ ...scope, tool: input.tool as TaskSessionLink['tool'], sessionId, nodeId: String(input.nodeId), source: 'manual', at });
}
/** Only task-scoped, development/verification associations are eligible; no global/native seed session is inferred. */
export function collectTaskSessions(state: DemoState, scope: TaskScope): CollectedSession[] {
  const entries = new Map<string, CollectedSession>();
  const add = (tool: CollectedSession['tool'], sessionId: string | null, nodeId: string | undefined, at: string, source: string, runId?: string) => {
    if (!sessionId || !nodeId || !['develop', 'verify'].includes(nodeId)) return;
    const key = tool + ':' + sessionId;
    let entry = entries.get(key);
    if (!entry) { entry = { tool, sessionId, nodeIds: [], runIds: [], sources: [], firstAt: at, lastAt: at }; entries.set(key, entry); }
    if (!entry.nodeIds.includes(nodeId)) entry.nodeIds.push(nodeId);
    if (runId && !entry.runIds.includes(runId)) entry.runIds.push(runId);
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (at < entry.firstAt) entry.firstAt = at; if (at > entry.lastAt) entry.lastAt = at;
  };
  for (const link of taskAutomation(state, scope)?.sessions ?? []) if (sameTask(link, scope)) add(link.tool, link.sessionId, link.nodeId, link.at, '成员关联');
  for (const event of state.workspace.collaboration?.events ?? []) if (event.taskId && sameTask({ projectId: event.projectId, taskId: event.taskId }, scope)) add('icode', event.sessionId, event.nodeId, event.at, 'Teams CLI 回传', event.runId);
  return [...entries.values()].sort((a,b) => a.tool.localeCompare(b.tool) || a.sessionId.localeCompare(b.sessionId));
}
export function queueTaskCollection(state: DemoState, scope = mainTask, at = new Date().toISOString()) {
  const record = mutableTaskAutomation(state, scope);
  if (!record.collection) record.collection = { id: crypto.randomUUID(), attempts: 0, status: 'queued', startedAt: at, finishedAt: null, sessions: [] };
}
export function finishTaskCollection(state: DemoState, scope: TaskScope, sessions: CollectedSession[], at: string) {
  const record = taskAutomation(state, scope)?.collection;
  if ((deliveryRequirement(state,scope.projectId,scope.taskId)?.stage ?? state.stage) !== 'accepted' || !record) throw new DomainError('验收尚未通过或没有归集任务');
  record.sessions = sessions; record.status = sessions.length ? 'collected' : 'empty'; record.finishedAt = at;
  record.reporting = { status: 'pending', reason: sessions.length ? '会话已归集，尚未写入共享目录。' : '尚无关联会话，未共享至 Talents。' };
  // Local collection is not an upload receipt; historical reporting fields are left unchanged.
}
export function validateTaskAutomation(state: DemoState) {
  if (!Object.hasOwn(state.workspace, 'taskAutomation')) return;
  const records = state.workspace.taskAutomation;
  if (!Array.isArray(records) || new Set(records.map(record => record.projectId + '/' + record.taskId)).size !== records.length || records.some(record =>
    !record || !(sameTask(record, mainTask)||deliveryRequirement(state,record.projectId,record.taskId)) || !Array.isArray(record.sessions)
    || record.sessions.some(link => !sameTask(link, record) || !['icode','opencode'].includes(link.tool) || !link.sessionId || !['develop','verify'].includes(link.nodeId) || link.source !== 'manual' || typeof link.at !== 'string')
    || record.knowledge && (!record.knowledge.id || !Number.isSafeInteger(record.knowledge.attempts) || !['waiting-upstream','queued','running','ready','waiting','failed'].includes(record.knowledge.status))
    || record.nodeKnowledge && (typeof record.nodeKnowledge!=='object'||Object.entries(record.nodeKnowledge).some(([node,job])=>!['develop','verify'].includes(node)||!job||job.nodeId!==node||!job.id||!Number.isSafeInteger(job.attempts)||!['waiting-upstream','queued','running','ready','failed'].includes(job.status)||job.delayMs!==20000||job.status==='ready'&&(!job.nodeInputs||job.nodeInputs.nodeId!==node)))
    || record.preparation && (!record.preparation.id || !record.preparation.basisKey || typeof record.preparation.assigneeId!=='string' || !['queued','importing','preparing-session','ready','waiting-directory','failed'].includes(record.preparation.status) || !Number.isSafeInteger(record.preparation.attempts) || !Array.isArray(record.preparation.progress) || record.preparation.status==='ready'&&!record.preparation.session)
    || record.collection && (!record.collection.id || !Number.isSafeInteger(record.collection.attempts) || !['queued','running','collected','empty','failed'].includes(record.collection.status) || !Array.isArray(record.collection.sessions))
  )) throw new Error('任务自动步骤记录无效；未自动覆盖');
}

/** Node work status is projected from the persisted, task-scoped CLI receipts, independently of acceptance. */
export function taskNodeWorkStatus(state: DemoState, scope: TaskScope, nodeId: string) {
 const latest=(state.workspace.collaboration?.events ?? []).filter(event=>event.projectId===scope.projectId && event.taskId===scope.taskId && event.nodeId===nodeId).sort((a,b)=>b.revision-a.revision)[0];
 return latest ? ({started:'进行中',progress:'进行中',blocked:'阻塞',result:'成果待确认'}[latest.phase]) : null;
}
