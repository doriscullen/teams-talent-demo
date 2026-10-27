import { projectTasksVisibleTo } from '../task-visibility.js';
import { defaultTeamId, findTeam, projectTeam } from '../teams-domain.js';
import { ProjectTaskManagement } from '../components/project-task-management.js';
import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Space, Tag } from 'antd';
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { createdProjectRoute, type CreatedProject, type CreatedProjectFields } from '../created-projects.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { ProjectToolbar, projectPages } from '../components/project-toolbar.js';
import { ProjectContentTemplate } from '../components/project-content-template.js';
import { ProjectAssets } from '../components/project-assets.js';
import { ProjectKnowledge } from '../components/project-knowledge.js';
import { ProjectWorkLaunch } from '../components/project-work-launch.js';
import { Mono, Origin } from '../components/common.js';
import { preferredDeliveryTask, projectDeliveryTasks } from '../project-delivery-tasks.js';
import type { RequirementNode } from '../delivery-requirements.js';
import { DeliveryTaskSidebar } from '../components/delivery-task-sidebar.js';
import { visibleGenericTasks } from '../task-visibility.js';
import { LiveTaskDelivery } from '../components/live-task-delivery.js';
import { TaskExecutionRecords } from '../components/task-execution-records.js';

/** Fields follow RealProjectIndex in Teams project-real.tsx; project creation carries an explicit team scope. */
function ProjectFields({ teamName }: { teamName: string }) {
  return <>
    <Form.Item label="所属团队"><Input value={teamName} disabled /></Form.Item>
    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: '请填写项目名称' }]}><Input aria-label="项目名称" maxLength={80} /></Form.Item>
    <Form.Item name="description" label="项目说明"><Input.TextArea aria-label="项目说明" rows={3} maxLength={1500} /></Form.Item>
    <Form.Item name="remoteUrl" label="代码仓地址" rules={[{ required: true, whitespace: true, message: '请填写代码仓地址' }]}><Input aria-label="代码仓地址" maxLength={500} placeholder="HTTPS、Git SSH 地址或本机仓库路径" /></Form.Item>
    <Form.Item name="repositoryIdentity" label="代码仓标识（主机/组织/仓库）" rules={[{ required: true, whitespace: true, message: '请填写代码仓标识' }]}><Input aria-label="代码仓标识（主机/组织/仓库）" maxLength={200} placeholder="例如：github.com/example/service" /></Form.Item>
  </>;
}

export function CreateProjectButton({ teamId = defaultTeamId }: { teamId?: string }) {
  const { state, role, busy, update, navigate } = useDemo();
  const [open, setOpen] = useState(false), [draftId, setDraftId] = useState(''), [failed, setFailed] = useState(false);
  const [form] = Form.useForm<CreatedProjectFields>();
  if (role !== 'owner') return null;
  return <>
    <Button type="primary" icon={<PlusOutlined />} aria-label="添加项目" onClick={() => { form.resetFields(); setFailed(false); setDraftId(crypto.randomUUID()); setOpen(true); }}>添加项目</Button>
    <Modal title="添加项目" open={open} width={620} okText="创建项目" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} onCancel={() => setOpen(false)} onOk={() => form.submit()}>
      <p className="muted">在当前团队创建项目，保存项目说明和主代码仓。</p>
      {failed && <Alert type="error" title="项目未保存，填写内容已保留，请核对错误提示后重试。" />}
      <Form form={form} layout="vertical" initialValues={{ description: '' }} disabled={busy} onFinish={async values => {
        setFailed(false);
        const saved = await update('project.create', { id: draftId, teamId, ...values });
        if (!saved) { setFailed(true); return; }
        setOpen(false); form.resetFields(); navigate(createdProjectRoute(draftId));
      }}><ProjectFields teamName={findTeam(state, teamId).name} /></Form>
      <p className="muted">代码仓保存为项目引用；本次创建不会拉取代码或启动原生工具。</p>
    </Modal>
  </>;
}

export function CreatedProjectCard({ project }: { project: CreatedProject }) {
  const { state, role, navigate } = useDemo();
  return <FrameworkCard title={project.name} action={<Tag>新建项目</Tag>}>
    <p>{project.description || '尚未填写项目说明。'}</p>
    <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'team', label: '所属团队', children: projectTeam(state, project.id).name }, { key: 'owner', label: '项目 Owner', children: '林悦' }, { key: 'repository', label: '主仓', children: project.repositoryIdentity }, { key: 'scope', label: '项目数据', children: `${visibleGenericTasks(state, project.id, role).length} 个通用任务` }]} />
    <Space wrap><Button type="primary" data-project-primary={project.id} aria-label={(role === 'owner' ? '进入任务管理：' : '进入任务交付：') + project.name} onClick={() => navigate(createdProjectRoute(project.id, role === 'owner' ? 'management' : 'delivery'))}>{role === 'owner' ? '进入任务管理' : '进入任务交付'}</Button><Button onClick={() => navigate(createdProjectRoute(project.id))}>项目资料</Button>{role === 'owner' && <Button aria-label={'编辑项目：' + project.name} onClick={() => navigate(createdProjectRoute(project.id, 'settings'))}>编辑项目</Button>}</Space>
  </FrameworkCard>;
}

export function CreatedProjectPage({ project, tab }: { project: CreatedProject; tab: string }) {
  const { state, role, busy, update, navigate } = useDemo();
  const [failed, setFailed] = useState(false);
  if (!projectTasksVisibleTo(state, project.id, role)) return <Alert type="info" title="当前身份不在该项目任务范围内" description="请由项目 Owner 确认团队成员范围。" />;
  const tasks = projectDeliveryTasks(state, project.id, role);
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const requestedTask = params.get('task');
  const selected = requestedTask ? tasks.find(task => task.id === requestedTask) : preferredDeliveryTask(tasks, role);
  const requestedNode = params.get('node');
  const node: RequirementNode = requestedNode && ['prepare', 'develop', 'verify', 'accept'].includes(requestedNode) ? requestedNode as RequirementNode : selected?.node ?? 'prepare';
  const jump = (next: string) => navigate(createdProjectRoute(project.id, next) + (next === 'delivery' && selected ? '&task=' + encodeURIComponent(selected.id) : ''));
  if (![...projectPages.map(page => page.key), 'settings'].includes(tab)) return <Alert type="error" title="项目页面不存在" action={<Button onClick={() => jump('content')}>进入项目概览</Button>} />;
  const empty = { delivery: ['任务交付', '尚无可交付任务'] };
  return <div className="page-stack project-workspace project-detail created-project">
    <ProjectToolbar activeKey={tab} onChange={jump} actions={<>{selected?.record && <TaskExecutionRecords key={project.id + ':' + selected.id + ':' + role} task={selected.record} />}{role === 'owner' ? <Button type="text" icon={<SettingOutlined />} aria-label="项目设置" onClick={() => jump('settings')}><span className="project-secondary-action-label">项目设置</span></Button> : <Tag>项目成员</Tag>}{(tab !== 'delivery' || selected) && <ProjectWorkLaunch target={{ projectId: project.id, tab, ...(tab === 'delivery' && selected ? { taskId: selected.id, nodeId: node } : {}) }} />}</>} />
    {tab === 'content' ? <ProjectContentTemplate projectId={project.id} name={project.name} description={project.description} origin={<Origin kind="simulated" />}
      information={[{ key: 'team', label: '所属团队', children: projectTeam(state, project.id).name }, { key: 'owner', label: '项目 Owner', children: '林悦' }, { key: 'repository', label: '主仓', span: 2, children: <><strong>{project.repositoryIdentity}</strong><p><Mono>{project.remoteUrl}</Mono></p></> }, { key: 'id', label: '项目标识', span: 2, children: <Mono>{project.id}</Mono> }, { key: 'directory', label: '本机目录', span: 2, children: '尚未绑定本机工作目录' }]}
      members={<><p>所属团队成员可查看项目，由 Owner 林悦维护项目资料。</p><Button onClick={() => navigate('team?team=' + projectTeam(state, project.id).id)}>查看团队成员</Button></>}
      assets={<ProjectAssets projectId={project.id} />}
      knowledge={<ProjectKnowledge projectId={project.id} />}
      requirements={<>{tasks.length ? <p>已登记 {tasks.length} 项交付需求。</p> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未登记交付需求" />}<p className="muted">来源资料与实际交付需求分别管理；已建立的交付需求可查看节点进度，通用工作保留独立入口。</p><Button onClick={() => jump('management')}>查看任务管理</Button></>}
      skills={[]}
    /> : tab === 'management' ? <ProjectTaskManagement projectId={project.id} /> : tab === 'settings' ? <>
      <Button className="self-start" onClick={() => jump('content')}>返回项目概览</Button>
      <FrameworkCard title="项目基础信息">
        {role !== 'owner' && <p className="muted">项目成员可查看基础信息，由 Owner 维护。</p>}
        {failed && <Alert type="error" title="保存未完成，填写内容已保留，请核对错误提示后重试。" />}
        <Form key={project.id + project.updatedAt} layout="vertical" initialValues={project} disabled={role !== 'owner' || busy} onFinish={async values => { setFailed(false); if (!await update('project.metadata.update', { id: project.id, ...values })) setFailed(true); }}>
          <ProjectFields teamName={projectTeam(state, project.id).name} />
          {role === 'owner' && <Button type="primary" htmlType="submit" loading={busy}>保存项目信息</Button>}
        </Form>
      </FrameworkCard>
    </> : selected?.record ? <LiveTaskDelivery key={project.id + ':' + selected.id + ':' + role} task={selected.record} node={node} /> : <div className="project-delivery-layout without-background"><DeliveryTaskSidebar projectId={project.id} selectedTaskId="" /><div className="project-node-main">{requestedTask ? <Alert type="info" title="此项目中不存在该需求任务" action={<Button onClick={() => navigate(createdProjectRoute(project.id, 'delivery'))}>查看本项目任务</Button>} /> : <FrameworkCard title={empty[tab as keyof typeof empty][0]}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={role === 'member' ? '本项目尚无交付任务' : empty[tab as keyof typeof empty][1]} /><p className="muted">{project.name}当前没有此类记录。</p><Button onClick={() => jump('content')}>查看项目概览</Button></FrameworkCard>}</div></div>}
  </div>;
}
