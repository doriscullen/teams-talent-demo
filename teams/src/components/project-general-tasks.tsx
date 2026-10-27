import { projectMembers } from '../teams-domain.js';
import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { useDemo } from '../context.js';
import { genericTaskLabels } from '../generic-tasks.js';
import type { OverviewRequirement } from '../project-overview.js';
import { taskManagementRoute } from './project-task-shared.js';
import { taskExecutableBy, visibleGenericTasks } from '../task-visibility.js';

export function GeneralTasks({ projectId, research }: { projectId: string; research: OverviewRequirement[] }) {
  const { state, role, busy, update, navigate } = useDemo();
  const [creating, setCreating] = useState(false), [draftId, setDraftId] = useState(''), [failed, setFailed] = useState(false), [result, setResult] = useState('');
  const [form] = Form.useForm();
  const tasks = visibleGenericTasks(state, projectId, role);
  const itemId = new URLSearchParams(location.hash.split('?')[1] ?? '').get('item');
  const selected = tasks.find(task => task.id === itemId);
  useEffect(() => setResult(''), [itemId, role]);
  useEffect(() => setCreating(false), [projectId, role]);
  const teamMembers = projectId === 'teams' ? [] : projectMembers(state, projectId);
  const members = teamMembers.filter(member => member.status === 'active');
  const memberName = (id: string | null) => teamMembers.find(member => member.id === id)?.name ?? '未分配';
  const show = (id?: string) => navigate(taskManagementRoute(projectId, 'general', id ? { item: id } : {}));
  const rows = [...tasks.map(task => ({ id: task.id, title: task.title, owner: memberName(task.assigneeId), status: genericTaskLabels[task.status], due: task.due, description: task.description, route: undefined as string | undefined, original: false })), ...research.map(task => ({ id: task.id, title: task.source.title, owner: task.owner, status: task.phase, due: task.due, description: task.source.summary, route: task.route, original: true }))];
  return <div className="page-stack">
    <div className="overview-header"><p className="muted">用于环境准备、技术优化、文档整理等工作，独立于需求与问题统计。</p>{role === 'owner' && projectId !== 'teams' && <Button type="primary" aria-label="新建通用任务" onClick={() => { setDraftId('GT-' + crypto.randomUUID()); form.resetFields(); setFailed(false); setCreating(true); }}>新建通用任务</Button>}</div>
    <Table className="general-task-table" size="small" rowKey="id" dataSource={rows} pagination={false} scroll={{ x: 760 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无通用任务" /> }} columns={[
      { title: '任务', width: 300, render: (_, item) => <><Button type="link" className="overview-title" onClick={() => show(item.id)}>{item.title}</Button><p className="muted">{item.description}</p></> },
      { title: '负责人', dataIndex: 'owner', width: 100 }, { title: '状态', render: (_, item) => <Tag>{item.status}</Tag>, width: 110 }, { title: '计划完成', render: (_, item) => item.due ?? '未排期', width: 120 },

    ]} />
    {projectId === 'teams' && <p className="muted">原 Teams 调研任务保留原身份和交付节点；导入记录只读。</p>}
    <Modal title="新建通用任务" open={creating && role === 'owner'} onCancel={() => setCreating(false)} okText="创建任务" cancelText="取消" confirmLoading={busy} okButtonProps={{ 'aria-label': '创建通用任务', disabled: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} onOk={() => form.submit()}>
      {failed && <Alert type="error" title="任务未保存，请核对错误信息后重试。" />}
      <Form form={form} layout="vertical" disabled={busy} initialValues={{ title: '', description: '', assigneeId: members.some(member => member.id === 'member') ? 'member' : '', due: '' }} onFinish={async values => { setFailed(false); const saved = await update('task.create', { projectId, id: draftId, ...values }); if (!saved) { setFailed(true); return; } setCreating(false); show(draftId); }}>
        <Form.Item name="title" label="任务名称" rules={[{ required: true, whitespace: true }]}><Input aria-label="通用任务名称" maxLength={120} /></Form.Item>
        <Form.Item name="description" label="工作说明"><Input.TextArea aria-label="通用任务说明" rows={3} maxLength={3000} /></Form.Item>
        <Form.Item name="assigneeId" label="负责人"><Select aria-label="通用任务负责人" options={[{ value: '', label: '暂不分配' }, ...members.map(member => ({ value: member.id, label: member.name }))]} /></Form.Item>
        <Form.Item name="due" label="计划完成"><Input type="date" aria-label="通用任务计划完成" /></Form.Item>
      </Form>
    </Modal>
    <Drawer title={selected?.title ?? '通用任务'} open={!!selected} width={640} onClose={() => show()} destroyOnHidden>{selected && <div className="page-stack">
      <Descriptions column={1} items={[{ key: 'id', label: '任务标识', children: selected.id }, { key: 'status', label: '状态', children: genericTaskLabels[selected.status] }, { key: 'owner', label: '负责人', children: memberName(selected.assigneeId) }, { key: 'due', label: '计划完成', children: selected.due ?? '未排期' }]} />
      <p>{selected.description || '未填写工作说明。'}</p>
      {role === 'owner' && selected.status === 'pending' && <><label>分配负责人</label><Select aria-label="分配通用任务负责人" value={selected.assigneeId ?? ''} disabled={busy} options={[{ value: '', label: '暂不分配' }, ...members.map(member => ({ value: member.id, label: member.name }))]} onChange={assigneeId => void update('task.assign', { projectId, id: selected.id, assigneeId })} /></>}
      {taskExecutableBy(role, selected.assigneeId) && selected.status === 'pending' && <Button type="primary" loading={busy} disabled={busy} onClick={() => void update('task.start', { projectId, id: selected.id })}>开始处理任务</Button>}
      {taskExecutableBy(role, selected.assigneeId) && selected.status === 'active' && <><Input.TextArea aria-label="通用任务完成说明" value={result} onChange={event => setResult(event.target.value)} rows={4} maxLength={3000} placeholder="说明完成的工作及可核对的成果" /><Button type="primary" loading={busy} disabled={busy || !result.trim()} onClick={() => void update('task.complete', { projectId, id: selected.id, result })}>提交完成说明</Button></>}
      {selected.status === 'completed' && <><strong>完成说明</strong><p>{selected.result}</p></>}
      <p className="muted">此处记录通用工作的处理进展；不生成需求验收、代码测试或发布证据。</p>
    </div>}</Drawer>
  </div>;
}
