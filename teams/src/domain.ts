import { projectMembers } from './teams-domain.js';
import { deliveryRequirement, mainRequirementId } from './delivery-requirements.js';
import { requireCurrentTaskMember, taskAssigneeName } from './task-assignment.js';
import { queueTaskCollection } from './task-automation.js';
import { campaign, calculateCashback, runCashbackChecks } from './cashback.js';
import { availableSkillIdsFor, selectedSkillBindings, type SkillBinding } from './resource-sharing.js';
import { initialWorkspace, type WorkspaceState, type Asset, type Material } from './workspace.js';
export type Role = 'owner' | 'member';
export type Stage = 'draft' | 'assigned' | 'developing' | 'failed' | 'fixed' | 'submitted' | 'returned' | 'accepted';
export type Evolution = 'none' | 'candidate' | 'evaluated' | 'published' | 'adopted';
export interface Audit { id: number; at: string; role: Role; system: 'Teams' | 'Talent'; action: string; detail: string; origin: 'simulated' }
export interface DemoState {
  assigneeId?: string | null;
  talentGeneration?: string;
  /** Version of the knowledge Talents published for this project, synced from the shared data directory. */
  knowledgeVersion?: string;
  campaignId?: string;
  schemaVersion: 2; workspace: WorkspaceState;
  revision: number; published: boolean; assigned: boolean; knowledge: boolean; stage: Stage;
  context: null | { id: string; skillVersion: string; agentVersion: string; knowledgeVersion: string; createdAt: string; selectedSkills: string[]; skillBindings?: SkillBinding[]; materials: Material[]; assets: Asset[] };
  checks: 'none' | 'failed' | 'passed'; security: 'unverified'; enrolled: boolean;
  transactions: { id: string; amount: number; reward: number }[]; balance: number;
  duplicateChecked: boolean; uat: boolean; returnReason: string;
  evolution: Evolution; adoptedSkill: string; adoptedAgent: string; audit: Audit[];
}
export type Action = 'assign' | 'knowledge' | 'prepare' | 'replay' | 'check-fail' | 'fix' | 'submit' | 'enroll' | 'purchase' | 'deduplicate' | 'uat' | 'accept' | 'return' | 'candidate' | 'evaluate' | 'release' | 'adopt';
export const stageLabels: Record<Stage, string> = { draft: '待立项', assigned: '待开始', developing: '开发中', failed: '待修复', fixed: '待提交', submitted: '待 Owner 验收', returned: '已退回', accepted: '已验收' };
export function initialState(): DemoState {
  return { assigneeId: null, campaignId: campaign.id, schemaVersion:2, workspace:initialWorkspace(), revision: 0, published: false, assigned: false, knowledge: false, stage: 'draft', context: null, checks: 'none', security: 'unverified', enrolled: false, transactions: [], balance: 2550.75, duplicateChecked: false, uat: false, returnReason: '', evolution: 'none', adoptedSkill: '1.0.0', adoptedAgent: 'r1', audit: [] };
}
export class DomainError extends Error { constructor(message: string, public status = 409) { super(message); } }
function requireCondition(ok: unknown, message: string): asserts ok { if (!ok) throw new DomainError(message); }
const owners: Action[] = ['assign', 'knowledge', 'candidate', 'evaluate', 'enroll', 'purchase', 'deduplicate', 'uat', 'accept', 'return', 'release', 'adopt'];
const members: Action[] = ['prepare', 'replay', 'check-fail', 'fix', 'submit'];
export const actionLabels: Record<Action, string> = { assign: '确认需求并分配', knowledge: '发起项目知识整合', prepare: '采用能力并冻结上下文', replay: '开始开发', 'check-fail': '查看首次检查结果', fix: '关联修复与复测结果', submit: '提交交付包', enroll: '确认白金卡资格', purchase: '消费 120 元', deduplicate: '重复评估同一交易', uat: '运行边界验收', accept: '通过功能验收', return: '退回补充', candidate: '生成改进候选', evaluate: '评估 Skill 与 Agent', release: '发布能力新版本', adopt: '项目采用新版本' };
export function transition(previous: DemoState, action: Action, role: Role, payload: { reason?: string; knowledgeVersion?: string; assigneeId?: string } = {}): DemoState {
  requireCondition(Object.hasOwn(actionLabels, action), '未知操作');
  if (owners.includes(action) && role !== 'owner' || members.includes(action) && role !== 'member') throw new DomainError('当前角色无权执行此操作', 403);
  const unified=deliveryRequirement(previous,'carddemo',mainRequirementId);
  if(unified&&['prepare','replay','check-fail','fix','submit','enroll','purchase','deduplicate','uat','accept','return'].includes(action))throw new DomainError('请使用任务节点的 Teams CLI 回传与 Owner 验收；旧演练推进入口已停用');
  requireCondition(previous.campaignId === campaign.id, '当前工作区使用旧活动规则，请由 Owner 在个人设置中重置工作区后继续');
  if (previous.assigned && members.includes(action)) requireCurrentTaskMember(previous);
  const s = structuredClone(previous);
  let detail = '';
  switch (action) {
    case 'assign': {
      const task=deliveryRequirement(s,'carddemo',mainRequirementId);
      requireCondition((task?.stage??s.stage) !== 'accepted', '已验收需求不能调整交付人');
      const member = projectMembers(s, 'carddemo').find(member => member.id === payload.assigneeId && member.status === 'active');
      requireCondition(member, '请选择有效的项目成员作为交付人');
      requireCondition(task?task.assigneeId!==member.id:!s.assigned || s.assigneeId !== member.id, '该成员已是当前交付人');
      if(task){task.assigneeId=member.id;task.updatedAt=new Date().toISOString();}
      else {if (!s.assigned) s.stage = 'assigned'; s.assigned = true; s.assigneeId = member.id;}
      detail = 'DEMO-MKT-001 → ' + taskAssigneeName(s) + ' · 交付人'; break;
    }
    case 'knowledge': { const version = payload.knowledgeVersion ?? 'Talents 项目知识'; requireCondition(version !== s.knowledgeVersion, 'Talents 尚未发布新的项目知识'); s.knowledge = true; s.knowledgeVersion = version; detail = 'Talents 已发布项目知识：' + version; break; }
    case 'prepare': requireCondition(s.assigned && !s.context, '请先分配需求；上下文不可重复冻结'); requireCondition(s.workspace.selectedSkills.length > 0 && s.workspace.selectedSkills.every(id => availableSkillIdsFor(s,role).includes(id)), '请选择有效的项目或用户 Skill'); s.context = { id: 'CTX-MKT-001', skillVersion: s.adoptedSkill, agentVersion: s.adoptedAgent, knowledgeVersion: s.knowledgeVersion ?? 'knowledge-v1', createdAt: new Date().toISOString(),selectedSkills:[...s.workspace.selectedSkills],skillBindings:selectedSkillBindings(s,role),materials:structuredClone(s.workspace.materials),assets:structuredClone(s.workspace.project.assets) }; detail = '冻结需求、验收标准、知识与能力版本'; break;
    case 'replay': requireCondition(s.context && s.stage === 'assigned', '请先冻结上下文'); s.stage = 'developing'; detail = '开始本次需求开发，记录工作进度'; break;
    case 'check-fail': requireCondition(s.stage === 'developing', '请先开始开发'); s.checks = 'failed'; s.stage = 'failed'; detail = '检查记录 E3 · 6/7 · 普通卡被错误纳入返现范围'; break;
    case 'fix': requireCondition(s.stage === 'failed' || s.stage === 'returned', '当前没有待修复事项'); s.checks = 'passed'; s.stage = 'fixed'; s.uat = false; detail = '修复记录 E4 → 复测 E5 · 7/7 · 安全仍待验证'; break;
    case 'submit': requireCondition(s.stage === 'fixed' && s.checks === 'passed', '检查未通过，不能提交'); s.stage = 'submitted'; detail = 'DELIVERY-MKT-001 · 包含变更、失败与复测证据'; break;
    case 'enroll': requireCondition(s.stage === 'submitted' && !s.enrolled, '资格已确认或当前不可操作'); s.enrolled = true; detail = '卡尾号 9900 · 白金卡资格已确认'; break;
    case 'purchase': { requireCondition(s.stage === 'submitted' && !s.transactions.length, '请先提交交付；该交易只记账一次'); const result = calculateCashback({ amountCents: 12000, cardTier: 'platinum', purchasedAt: campaign.purchaseAt }); s.transactions.push({ id: 'TX-PLATINUM-120', amount: 120, reward: result.rewardCents / 100 }); s.balance = (255075 + 12000 - result.rewardCents) / 100; detail = '消费记录 120.00 → 额外返现 0.60 → 欠款 2670.15'; break; }
    case 'deduplicate': requireCondition(s.stage === 'submitted' && s.transactions.length === 1 && !s.duplicateChecked, '请先完成交易'); s.duplicateChecked = true; detail = 'ALREADY_EVALUATED · 奖励条数仍为 1'; break;
    case 'uat': requireCondition(s.stage === 'submitted' && s.duplicateChecked, '请先验证消费与去重'); requireCondition(runCashbackChecks().every(check => check.passed), '边界验收未通过'); s.uat = true; detail = '已核对 7 项资格、期间、金额与重复入账规则；生产安全仍待验证'; break;
    case 'accept': requireCondition(s.stage === 'submitted' && s.uat && s.checks === 'passed', '验收条件未完成'); s.stage = 'accepted'; queueTaskCollection(s); detail = '功能验收通过 · 生产安全放行仍未验证'; break;
    case 'return': requireCondition(s.stage === 'submitted' && payload.reason?.trim(), '请填写退回原因'); s.stage = 'returned'; s.returnReason = payload.reason!.trim().slice(0, 500); s.uat = false; detail = s.returnReason; break;
    case 'candidate': requireCondition(s.stage === 'accepted' && s.evolution === 'none', '请先完成验收');requireCondition(s.workspace.analysis.status==='analyzed','请先完成 Talents 轨迹分析'); s.evolution = 'candidate'; detail = 'Talents 根据 E3/E4/E5 记录 Skill 1.1.0 与 Agent r2 改进候选'; break;
    case 'evaluate': requireCondition(s.evolution === 'candidate', '请先生成候选'); s.evolution = 'evaluated'; detail = '固定输入的 Skill / Agent 独立对照评估结果'; break;
    case 'release': requireCondition(s.evolution === 'evaluated', '候选尚未评估'); s.evolution = 'published'; detail = 'Talents 发布 Skill 1.1.0、Agent r2 版本'; break;
    case 'adopt': requireCondition(s.evolution === 'published', '请先在 Talents 发布候选'); s.evolution = 'adopted'; s.adoptedSkill = '1.1.0'; s.adoptedAgent = 'r2'; detail = '供下一次作业采用；CTX-MKT-001 仍保持 Skill 1.0.0 / Agent r1'; break;
  }
  s.revision++;
  s.audit.push({ id: s.revision, at: new Date().toISOString(), role, system: ['candidate', 'evaluate', 'release'].includes(action) ? 'Talent' : 'Teams', action: actionLabels[action], detail, origin: 'simulated' });
  return s;
}
