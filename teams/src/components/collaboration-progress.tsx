import { displayRequirementId } from '../display-text.js';
import { Button, Empty, Tag, Timeline } from 'antd';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { projectDeliveryTasks } from '../project-delivery-tasks.js';

const phases = { started: '已开始', progress: '进展', blocked: '阻塞', result: '成果待确认' };
export function CollaborationProgress({ projectId, taskId, nodeId, embedded = false }: { projectId: string; taskId: string; nodeId?: string; embedded?: boolean }) {
  const { state, role, showText } = useDemo();
  if (role === 'member' && !projectDeliveryTasks(state, projectId, role).some(task => task.id === taskId)) return null;
  const inScope = (record: { projectId: string; taskId?: string; nodeId?: string }) => record.projectId === projectId && record.taskId === taskId && (!nodeId || record.nodeId === nodeId);
  const events = (state.workspace.collaboration?.events ?? []).filter(inScope);
  const adoptions = (state.workspace.collaboration?.adoptions ?? []).filter(inScope);
  const content = <>
    {adoptions.length > 0 && <Button type="link" onClick={() => showText('采用依据 · ' + displayRequirementId(taskId) + (nodeId ? ' · ' + nodeId : ''), JSON.stringify(adoptions, null, 2))}>查看采用依据（{adoptions.length}）</Button>}
    {events.length ? <Timeline items={events.map(event => ({ key: event.id, color: event.phase === 'blocked' ? 'orange' : 'blue', content: <div>
      <p data-collaboration-event={event.id} data-task-id={event.taskId} data-node-id={event.nodeId}><Tag>{phases[event.phase]}</Tag><strong>{event.summary}</strong></p>
      {event.blocker && <p>阻塞：{event.blocker}</p>}
      <p className="muted">Teams CLI · {event.role === 'owner' ? 'Owner' : '交付成员'} · {new Date(event.at).toLocaleString('zh-CN')}</p>
      <Button type="link" size="small" onClick={() => showText('协作回执 · ' + event.operationId, JSON.stringify(event, null, 2))}>查看会话、操作与证据引用</Button>
    </div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={nodeId ? '尚无此节点的 CLI 进度回传' : '尚无此任务的 CLI 回传'} />}
    <p className="muted">回传记录绑定项目、任务、节点与 run/session。成员成果等待确认；质量检查、安全结论与 Owner 验收保持原流程。</p>
  </>;
  return embedded ? <div className="task-cli-progress" data-cli-task={taskId} data-cli-node={nodeId}>{content}</div> : <FrameworkCard title="Teams CLI 协作回传" action={<Tag>本机接入</Tag>}>{content}</FrameworkCard>;
}
