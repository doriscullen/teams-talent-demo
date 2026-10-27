import { createHash } from 'node:crypto';
import { DomainError, type DemoState } from '../src/domain.js';
import { deliveryRequirement } from '../src/delivery-requirements.js';
import { collectTaskSessions } from '../src/task-automation.js';
import type { TalentTaskInputs, TalentTaskIntake, TalentTaskSession, TalentTaskSessionPayload } from '../src/talent-contract.js';
import type { SkillBinding } from '../src/resource-sharing.js';
import { loadSourceSkillPackage, loadNativeSkillPackage } from './skill-packages.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './store.js';
import { sharedDir, talentOrigin } from './config.js';
import { projectKnowledge } from './shared-data.js';

/** Resolve the recorded immutable package; never relabel current bytes as an old version. */
export async function registeredTaskSkill(id:string,binding?:SkillBinding):Promise<TalentTaskInputs['skills'][number]>{
 const pkg=binding?.sha256?await loadNativeSkillPackage(id,binding.version,binding.sha256):await loadSourceSkillPackage(id);
 if(binding&&pkg.version!==binding.version)throw new DomainError('已登记 Skill 与所选版本不一致',409);
 const main=pkg.files.find(file=>file.path==='SKILL.md');if(!main)throw new DomainError('已登记 Skill 缺少正文',500);
 if(binding?.contentSha256&&binding.contentSha256!==main.sha256)throw new DomainError('固定 Skill 正文摘要不一致',409);
 return{id:pkg.id,name:pkg.name,version:pkg.version,sha256:pkg.sha256,contentSha256:main.sha256,content:main.bytes.toString('utf8'),source:'teams-registered-package'};
}

/** Task facts stay in Teams; published knowledge comes from the Talents shared directory. */
export async function sharedTaskInputs(state: DemoState, projectId: string, taskId: string): Promise<TalentTaskInputs> {
  const task = deliveryRequirement(state, projectId, taskId);
  if (!task) throw new DomainError('交付需求不存在或不属于所选项目', 404);
  const published = await projectKnowledge(projectId);
  const sourceDigest = createHash('sha256').update(JSON.stringify({ title: task.title, description: task.description, skillIds: task.skillIds })).digest('hex');
  const version = 'requirement-' + sourceDigest.slice(0, 12);
  const skills = await Promise.all(task.skillIds.map(id=>registeredTaskSkill(id,task.skillBindings?.find(binding=>binding.id===id))));
  return { projectId, taskId, generation: state.talentGeneration ?? 'initial', origin: talentOrigin,
    requirement: { id: taskId, title: task.title, description: task.description },
    knowledge: { status: 'ready', version, assets: [
      { id: 'requirement:' + projectId + ':' + taskId, title: '本需求确认内容 · ' + task.title, version, detail: task.description, origin: 'teams-task' },
      ...published.map(item => ({ id: item.id, title: item.name, version: String(item.version), detail: item.description, origin: 'talents-shared' as const })),
    ] }, skills };
}

/** A persisted export receipt confirms sharing, not Talents processing or model execution. */
export async function exportTaskSessions(state: DemoState, value: unknown, directory = sharedDir) {
  const payload = taskSessionPayload(value), task = deliveryRequirement(state, payload.projectId, payload.taskId);
  const main = payload.projectId === 'carddemo' && payload.taskId === 'DEMO-MKT-001';
  if (!task && !main) throw new DomainError('交付需求不存在', 404);
  const acceptedAt = task?.acceptedAt ?? [...state.audit].reverse().find(item => item.action === '通过功能验收')?.at;
  if ((task?.stage ?? state.stage) !== 'accepted' || acceptedAt !== payload.acceptedAt) throw new DomainError('任务尚未验收或验收时间不匹配', 409);
  const inputDigest = task?.inputDigest ?? createHash('sha256').update(JSON.stringify(state.context)).digest('hex');
  if (inputDigest !== payload.inputDigest) throw new DomainError('采用依据摘要与已验收任务不匹配', 409);
  if (JSON.stringify(normalizeTaskSessions(collectTaskSessions(state, payload))) !== JSON.stringify(payload.sessions)) throw new DomainError('会话清单与已验收任务的节点关联不一致', 409);
  const key = createHash('sha256').update(payload.idempotencyKey).digest('hex');
  const path = join(directory, 'teams', 'task-sessions', key + '.json');
  const payloadSha256 = taskSessionPayloadDigest(payload);
  try {
    const previous = JSON.parse(await readFile(path, 'utf8')) as TalentTaskIntake;
    validateTaskIntakes([previous]);
    if (previous.generation !== (state.talentGeneration ?? 'initial') || previous.receipt.payloadSha256 !== payloadSha256) throw new DomainError('幂等标识已用于不同上报内容', 409);
    return previous.receipt;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const receipt = { id: 'SHARED-' + key, receivedAt: payload.acceptedAt, projectId: payload.projectId, taskId: payload.taskId,
    sessionIds: [...new Set(payload.sessions.map(item => item.sessionId))], payloadSha256,
    ...(payload.sessionDocuments ? { documentHashes: payload.sessionDocuments.map(({ sessionId, sha256 }) => ({ sessionId, sha256 })) } : {}) };
  await atomicJson(path, { generation: state.talentGeneration ?? 'initial', payload, receipt });
  return receipt;
}

const need: (value: unknown, message: string, status?: number) => asserts value = (value, message, status = 400) => { if (!value) throw new DomainError(message, status); };
const text = (value: unknown, label: string, max = 200) => { need(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), label + '无效'); return value; };
const at = (value: unknown, label: string) => { const result = text(value, label, 40); need(/^\d{4}-\d{2}-\d{2}T/.test(result) && Number.isFinite(Date.parse(result)), label + '无效'); return result; };
const digest = (value: unknown, label: string) => { need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), label + '无效'); return value; };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function values(value: unknown, label: string, empty = false) {
  need(Array.isArray(value) && value.length <= 100 && (empty || value.length > 0), label + '无效');
  return [...new Set(value.map(item => text(item, label)))].sort(compare);
}
export function normalizeTaskSessions(value: unknown): TalentTaskSession[] {
  need(Array.isArray(value) && value.length > 0 && value.length <= 200, '会话清单不能为空或超出范围');
  const keys = new Set<string>();
  return value.map((item): TalentTaskSession => {
    need(item && typeof item === 'object', '会话记录无效');
    const raw = item as Record<string, unknown>; need(raw.tool === 'icode' || raw.tool === 'opencode', '会话工具无效');
    const sessionId = text(raw.sessionId, '会话标识'), key = raw.tool + ':' + sessionId; need(!keys.has(key), '会话清单未按工具和标识去重'); keys.add(key);
    const nodeIds = values(raw.nodeIds, '关联节点'); need(nodeIds.every(id => ['develop','verify'].includes(id)), '只接收开发与验证节点会话');
    const firstAt = at(raw.firstAt, '首次关联时间'), lastAt = at(raw.lastAt, '最后关联时间'); need(Date.parse(firstAt) <= Date.parse(lastAt), '会话关联时间顺序无效');
    return { tool: raw.tool, sessionId, nodeIds, runIds: values(raw.runIds, '运行标识', true), sources: values(raw.sources, '关联来源'), firstAt, lastAt };
  }).sort((a,b) => compare(a.tool + ':' + a.sessionId, b.tool + ':' + b.sessionId));
}
function sessionDocuments(value: unknown, sessions: TalentTaskSession[]): NonNullable<TalentTaskSessionPayload['sessionDocuments']> {
  need(Array.isArray(value) && value.length <= sessions.length, '会话文档清单无效'); const ids = new Set<string>();
  return value.map(item => {
    need(item && typeof item === 'object', '会话文档无效'); const sessionId = text(item.sessionId, '文档会话标识');
    need(sessions.some(session => session.sessionId === sessionId) && !ids.has(sessionId), '会话文档标识重复或不属于上报范围'); ids.add(sessionId);
    need(typeof item.content === 'string' && Buffer.byteLength(item.content, 'utf8') > 0 && Buffer.byteLength(item.content, 'utf8') <= 8 * 1024 * 1024, '会话文档为空或超过 8 MiB');
    const sha256 = digest(item.sha256, '会话文档摘要'); need(createHash('sha256').update(item.content, 'utf8').digest('hex') === sha256, '会话文档内容与摘要不一致');
    let document: unknown; try { document = JSON.parse(item.content); } catch { throw new DomainError('会话文档不是合法 JSON', 400); }
    need(document && typeof document === 'object' && !Array.isArray(document), '会话文档必须是 JSON 对象');
    need(sessions.some(session => session.sessionId === sessionId && session.tool === 'icode'), '当前仅接收已核验 iCode 格式的会话文档');
    need((document as { meta?: { session_id?: unknown } }).meta?.session_id === sessionId, '原生会话文档自身标识与上报范围不一致');
    return { sessionId, sha256, content: item.content as string };
  }).sort((a,b) => compare(a.sessionId, b.sessionId));
}
export function taskSessionPayload(value: unknown): TalentTaskSessionPayload {
  need(value && typeof value === 'object' && !Array.isArray(value), '会话上报内容无效'); const input = value as Record<string, unknown>;
  const payload: TalentTaskSessionPayload = { projectId: text(input.projectId, '项目范围'), taskId: text(input.taskId, '任务范围'), deliveryId: text(input.deliveryId, '交付标识'), idempotencyKey: text(input.idempotencyKey, '幂等标识'), acceptedAt: at(input.acceptedAt, '验收时间'), inputDigest: digest(input.inputDigest, '采用依据摘要'), sessions: normalizeTaskSessions(input.sessions) };
  if (Object.hasOwn(input, 'sessionDocuments')) payload.sessionDocuments = sessionDocuments(input.sessionDocuments, payload.sessions);
  return payload;
}
export const taskSessionPayloadDigest = (payload: TalentTaskSessionPayload) => createHash('sha256').update(JSON.stringify(taskSessionPayload(payload))).digest('hex');
export function validateTaskIntakes(value: unknown): asserts value is TalentTaskIntake[] {
  need(Array.isArray(value), '共享会话清单损坏'); const keys = new Set<string>(), receiptIds = new Set<string>();
  for (const record of value) {
    need(record && typeof record === 'object', '共享会话记录损坏'); const payload = taskSessionPayload(record.payload), receipt = record.receipt;
    text(record.generation, '项目代次'); need(!keys.has(payload.idempotencyKey), '共享会话幂等标识重复'); keys.add(payload.idempotencyKey);
    need(receipt && typeof receipt === 'object', '共享会话回执损坏'); text(receipt.id, '回执标识'); at(receipt.receivedAt, '收件时间'); need(!receiptIds.has(receipt.id), '共享会话回执重复'); receiptIds.add(receipt.id);
    need(receipt.projectId === payload.projectId && receipt.taskId === payload.taskId && receipt.payloadSha256 === taskSessionPayloadDigest(payload) && JSON.stringify(receipt.sessionIds) === JSON.stringify([...new Set(payload.sessions.map(item => item.sessionId))]), '共享会话内容与回执不一致');
    need(JSON.stringify(receipt.documentHashes ?? []) === JSON.stringify(payload.sessionDocuments?.map(({ sessionId, sha256 }) => ({ sessionId, sha256 })) ?? []), '共享会话文档回执与内容不一致');
  }
}
