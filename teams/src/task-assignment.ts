import { projectMembers } from './teams-domain.js';
import type { DemoState } from './domain.js';
import { DomainError } from './domain.js';
export const currentMemberId = 'member';
/** The previous persisted contract always assigned this single task to Chen Chen. */
export function taskAssigneeId(state: DemoState) { const task=state.workspace.deliveryRequirements?.find(task=>task.projectId==='carddemo'&&task.id==='DEMO-MKT-001');return task?task.assigneeId||null:state.assigneeId === undefined ? state.assigned ? currentMemberId : null : state.assigneeId; }
export function taskAssignee(state: DemoState) { return projectMembers(state, 'carddemo').find(member => member.id === taskAssigneeId(state)); }
export function taskAssigneeName(state: DemoState) { return taskAssignee(state)?.name ?? '待分配'; }
export const currentMemberOwnsTask = (state: DemoState) => taskAssigneeId(state) === currentMemberId;
export function requireCurrentTaskMember(state: DemoState) { if (!currentMemberOwnsTask(state)) throw new DomainError('当前交付人为' + taskAssigneeName(state) + '，当前成员不能代其推进任务', 403); }
export function validateTaskAssignment(state: DemoState) {
  const id = taskAssigneeId(state), member = taskAssignee(state);
  const task=state.workspace.deliveryRequirements?.find(task=>task.projectId==='carddemo'&&task.id==='DEMO-MKT-001');
  if ((task?!!task.assigneeId:state.assigned) ? typeof id !== 'string' || !member || member.status !== 'active' : id !== null) throw new Error('需求交付人记录无效；未自动替换成员');
}
export function normalizeLegacyTaskAssignment(state: DemoState) {
  validateTaskAssignment(state);
  if (!Object.hasOwn(state, 'assigneeId')) state.assigneeId = state.assigned ? currentMemberId : null;
}
