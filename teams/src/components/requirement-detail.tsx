import { Button, Descriptions, Space } from 'antd';
import { useDemo } from '../context.js';
import { displayRequirementId, displayText } from '../display-text.js';
import type { OverviewRequirement } from '../project-overview.js';
import { deliveryRequirement } from '../delivery-requirements.js';
import { TaskAssignment } from './task-assignment.js';
import { taskExecutableBy, taskVisibleTo } from '../task-visibility.js';
export const requirementPhaseLabel = (phase: string) => ({ '待开展': '待开始', '准备': '需求澄清', '开发': '功能开发', '验证': '测试验证' }[phase] ?? phase);
export function RequirementDetail({ projectId, item }: { projectId: string; item: OverviewRequirement }) {
  const { state, role, navigate, showText } = useDemo();
  if (!taskVisibleTo(role, item.assigneeId)) return null;
  const local = !!item.taskId && !!deliveryRequirement(state, projectId, item.taskId);
  const stateLabel = item.deliveryStatus ?? requirementPhaseLabel(item.phase);
  const nextLabel = role === 'owner' ? item.phase === '待验收' ? '验收需求' : '查看交付进度' : taskExecutableBy(role, item.assigneeId) ? ['待开展','准备'].includes(item.phase) ? '开始处理' : item.phase === '已交付' ? '查看交付' : '继续处理' : '查看交付';
  const route = item.route;
  return <div className="page-stack requirement-detail">
    <p className="muted">来源：{item.source.origin==='teams-task'?'Teams':'需求平台'} · {displayRequirementId(item.taskId ?? item.source.sourceRecordId)}</p>
    <p>{displayText(item.source.summary)}</p>
    <Descriptions column={1} size="small" items={[
      { key: 'assignee', label: '交付人', children: <Space wrap>{item.owner}{local && !item.pendingConfirmation && <TaskAssignment key={projectId + ':' + item.taskId + ':' + role} projectId={projectId} taskId={item.taskId!} secondary />}</Space> },
      { key: 'state', label: '当前状态', children: stateLabel },
      { key: 'due', label: '计划完成', children: item.due ?? '未排期' },
    ]} />
    {!local && item.source.origin!=='teams-task' && <p className="muted">{projectId === 'teams' ? '原项目任务记录只读，交付人和状态沿用来源。' : '此需求保留来源记录，尚未创建本地交付任务。'}</p>}
    <Space wrap>{local && item.pendingConfirmation && <TaskAssignment key={projectId + ':' + item.taskId + ':' + role} projectId={projectId} taskId={item.taskId!} />}{route && <Button type="primary" aria-label={nextLabel} onClick={() => navigate(route)}>{nextLabel}</Button>}<Button type="link" size="small" onClick={() => showText(item.source.title + ' · 来源原文', displayText(item.source.detail))}>查看来源</Button></Space>
  </div>;
}
