import { projectTasksVisibleTo } from '../task-visibility.js';
import { preferredDeliveryTask, projectDeliveryTasks } from '../project-delivery-tasks.js';
import { DeliveryTaskSidebar } from '../components/delivery-task-sidebar.js';
import { LiveTaskDelivery } from '../components/live-task-delivery.js';
import { TaskExecutionRecords } from '../components/task-execution-records.js';
import { projectMembers, projectTeam } from '../teams-domain.js';
import { displayProjectDescription, displayText } from '../display-text.js';
import { Alert, Button, Descriptions, Empty, Space, Tag } from 'antd';
import { ArrowLeftOutlined, FileTextOutlined, SettingOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { Heading } from '../components/common.js';
import { ProjectToolbar } from '../components/project-toolbar.js';
import { stageLabels } from '../domain.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { ProjectWorkLaunch } from '../components/project-work-launch.js';
import { TeamsProjectCard } from './teams-project.js';
import { CreateProjectButton, CreatedProjectCard } from './created-project.js';
import { ProjectContent, ProjectManagement, ProjectSettings } from './project-content.js';
import { ProjectDelivery, nodeLabels, type DeliveryNode } from './project-delivery.js';
import '../project.css';

export function Project({ tab = 'content', node }: { tab?: string; node?: string }) {
  const { state, role, navigate } = useDemo();
  const mainDelivery=projectDeliveryTasks(state,'carddemo').find(task=>task.id==='DEMO-MKT-001');
  if (tab === 'list') return <div className="page-stack project-workspace"><Heading eyebrow="团队空间" title="项目" description={role === 'owner' ? '管理项目任务，协调问题并验收交付成果。' : '进入参与的项目，完成分配给自己的任务。'} actions={role === 'owner' ? <CreateProjectButton /> : undefined} />
    <FrameworkCard title={state.workspace.project.name} action={<Tag color={mainDelivery?.accepted ? 'green' : 'purple'}>{mainDelivery?.status}</Tag>}><p>{displayText(displayProjectDescription(state.workspace.project.description))}</p><Descriptions size="small" column={2} items={[{ key: 'team', label: '所属团队', children: projectTeam(state, 'carddemo').name }, { key: 'people', label: '协作角色', children: projectMembers(state, 'carddemo').filter(member => member.status === 'active').map(member => member.name + ' · ' + (member.role === 'owner' ? 'Owner' : '成员')).join('、') }, { key: 'repository', label: '主仓', children: state.workspace.project.repository }, { key: 'task', label: '本次需求', children: '信用卡消费返现 · MKT-001' }]} /><Space wrap><Button type="primary" data-project-primary="carddemo" aria-label={(role === 'owner' ? '进入任务管理：' : '进入任务交付：') + state.workspace.project.name} onClick={() => navigate('projects?tab=' + (role === 'owner' ? 'management' : 'delivery'))}>{role === 'owner' ? '进入任务管理' : '进入任务交付'}</Button><Button onClick={() => navigate('projects?tab=content')}>项目资料</Button>{role === 'owner' && <Button onClick={() => navigate('projects?tab=delivery')}>交付与验收</Button>}{role === 'owner' && <Button onClick={() => navigate('projects?tab=settings')}>编辑项目</Button>}</Space></FrameworkCard>
    <TeamsProjectCard />
    {(state.workspace.projects ?? []).map(project => <CreatedProjectCard key={project.id} project={project} />)}
  </div>;
  if (!projectTasksVisibleTo(state, 'carddemo', role)) return <Alert type="info" title="当前身份不在该项目任务范围内" description="请由项目 Owner 确认团队成员范围。" />;
  const tasks = projectDeliveryTasks(state, 'carddemo', role);
  const requestedTask = new URLSearchParams(location.hash.split('?')[1] ?? '').get('task');
  const selected = requestedTask ? tasks.find(task => task.id === requestedTask) : preferredDeliveryTask(tasks, role);
  const taskId = selected?.id;
  const task = selected?.record;
  const legacy = tab === 'requirement' ? 'management' : ['context', 'acceptance'].includes(tab) ? 'delivery' : tab;
  const selectedNode: DeliveryNode = tab === 'context' ? 'prepare' : tab === 'acceptance' ? 'accept' : node && Object.hasOwn(nodeLabels, node) ? node as DeliveryNode : selected?.node ?? 'prepare';
  return <div className="page-stack project-workspace project-detail">
    <ProjectToolbar activeKey={legacy} onChange={value => navigate('projects?project=carddemo&tab=' + value + (value === 'delivery' && selected ? '&task=' + encodeURIComponent(selected.id) : ''))} actions={<>
      {task ? <TaskExecutionRecords key={task.projectId + ':' + task.id + ':' + role} task={task} /> : selected ? <Button type="text" icon={<FileTextOutlined />} aria-label="查看需求执行记录" title="查看需求执行记录" onClick={() => navigate('trace')}><span className="project-secondary-action-label">执行记录</span></Button> : null}
      <Button type="text" icon={<SettingOutlined />} aria-label="项目设置" title="项目设置" onClick={() => navigate('projects?tab=settings')}><span className="project-secondary-action-label">项目设置</span></Button>
      {(legacy !== 'delivery' || selected) && <ProjectWorkLaunch target={{ projectId: 'carddemo', tab: legacy, ...(legacy === 'delivery' ? { taskId, nodeId: selectedNode } : {}) }} />}
    </>} />
    {legacy === 'content' ? <ProjectContent /> : legacy === 'management' ? <ProjectManagement /> : legacy === 'delivery' ? task ? <LiveTaskDelivery key={task.projectId+':'+task.id+':'+role} task={task} node={selectedNode}/> : taskId==='DEMO-MKT-001'?<ProjectDelivery node={selectedNode} />:<div className="project-delivery-layout without-background"><DeliveryTaskSidebar projectId="carddemo" selectedTaskId="" /><div className="project-node-main">{requestedTask ? <Alert type="info" title="此项目中不存在该需求任务" action={<Button onClick={() => navigate('projects?project=carddemo&tab=delivery')}>查看本项目任务</Button>} /> : <Empty description="本项目尚无交付任务" />}</div></div> : legacy === 'settings' ? <><Button className="self-start" icon={<ArrowLeftOutlined />} onClick={() => navigate('projects?tab=content')}>返回项目概览</Button><ProjectSettings /></> : <Alert type="error" title="项目页面不存在" action={<Button onClick={() => navigate('projects?tab=content')}>进入项目概览</Button>} />}

  </div>;
}
