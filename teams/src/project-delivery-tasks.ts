import { requirementNode, requirementStageLabels, type DeliveryRequirement, type RequirementNode } from './delivery-requirements.js';
import { stageLabels, type DemoState, type Role } from './domain.js';
import { taskAssigneeId, taskAssigneeName } from './task-assignment.js';
import { projectTasksVisibleTo, taskExecutableBy, taskVisibleTo } from './task-visibility.js';
import { mainTask } from './task-automation.js';
import { projectMembers } from './teams-domain.js';

export type DeliveryPhase = '待开展' | '准备' | '开发' | '验证' | '待验收' | '已交付';
export interface ProjectDeliveryTask {
  id: string; projectId: string; title: string; owner: string; assigneeId: string | null; status: string; phase: DeliveryPhase;
  node: RequirementNode; route: string; accepted: boolean; pendingAssignment: boolean; createdAt?: string; record?: DeliveryRequirement;
}
const phases: Record<DemoState['stage'], DeliveryPhase> = { draft: '待开展', assigned: '准备', developing: '开发', failed: '验证', fixed: '验证', submitted: '待验收', returned: '开发', accepted: '已交付' };
const taskRoute = (projectId: string, taskId: string, node: RequirementNode) => 'projects?' + new URLSearchParams({ project: projectId, tab: 'delivery', task: taskId, node });

/** Actual local delivery instances only. Source-only requirements and general tasks keep their own views. */
export function projectDeliveryTasks(state: DemoState, projectId: string, role: Role = 'owner'): ProjectDeliveryTask[] {
  if (!projectTasksVisibleTo(state, projectId, role)) return [];
  const tasks: ProjectDeliveryTask[] = [];
  if (projectId === mainTask.projectId && !state.workspace.deliveryRequirements?.some(task=>task.projectId===projectId&&task.id===mainTask.taskId)) {
    const node: RequirementNode = ['submitted', 'accepted'].includes(state.stage) ? 'accept' : ['failed', 'fixed'].includes(state.stage) ? 'verify' : ['developing', 'returned'].includes(state.stage) ? 'develop' : 'prepare';
    tasks.push({ id: mainTask.taskId, projectId, title: '信用卡消费返现', owner: taskAssigneeName(state), assigneeId: state.assigned ? taskAssigneeId(state) : null, status: state.assigned ? stageLabels[state.stage] : '待分配', phase: phases[state.stage], node, route: taskRoute(projectId, mainTask.taskId, node), accepted: state.stage === 'accepted', pendingAssignment: !state.assigned });
  }
  const records = (state.workspace.deliveryRequirements ?? []).filter(record => record.projectId === projectId);
  if (!records.length) return tasks.filter(task => taskVisibleTo(role, task.assigneeId));
  const members = projectMembers(state, projectId);
  for (const record of records) {
    const phase: DeliveryPhase = record.stage === 'accepted' ? '已交付' : record.stage === 'awaiting-acceptance' ? '待验收' : record.stage === 'verifying' ? '验证' : record.stage === 'preparing' ? '准备' : '开发';
    const node = requirementNode(record);
    tasks.push({ id: record.id, projectId, title: record.title, owner: members.find(member => member.id === record.assigneeId)?.name ?? '待分配', assigneeId: record.assigneeId||null, status:record.assigneeId?requirementStageLabels[record.stage]:'待分配', phase:record.assigneeId?phase:'待开展', node, route: taskRoute(projectId, record.id, node), accepted: record.stage === 'accepted', pendingAssignment:!record.assigneeId, createdAt:record.createdAt, record });
  }
  return tasks.filter(task => taskVisibleTo(role, task.assigneeId));
}

/** Prefer the actor's assignment only when there is no explicit task selection. */
export const preferredDeliveryTask = (tasks: readonly ProjectDeliveryTask[], role: Role) => tasks.find(task => taskExecutableBy(role, task.assigneeId)) ?? tasks[0];

/** Display ordering only: no updatedAt, guessed dates, state writes or selection changes. */
export function orderDeliveryTasks<T extends {id:string;createdAt?:string}>(tasks:readonly T[]):T[]{
  const created=(value?:string)=>value&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
  return [...tasks].sort((a,b)=>{const x=created(a.createdAt),y=created(b.createdAt);return x===null&&y!==null?1:x!==null&&y===null?-1:x!==null&&y!==null&&x!==y?y-x:a.id.localeCompare(b.id,'en');});
}
