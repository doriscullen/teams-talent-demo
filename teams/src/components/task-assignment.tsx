import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Select } from 'antd';
import { deliveryRequirementAction } from '../api.js';
import { taskAutomation } from '../task-automation.js';
import { deliveryRequirement } from '../delivery-requirements.js';
import { displayRequirementId } from '../display-text.js';
import { projectMembers } from '../teams-domain.js';
import { useDemo } from '../context.js';

export function TaskAssignment({ secondary = false, projectId = 'carddemo', taskId = 'DEMO-MKT-001' }: { secondary?: boolean; projectId?: string; taskId?: string }) {
  const { state, role, busy, run, receiveState } = useDemo();
  const [open, setOpen] = useState(false), [assigneeId, setAssigneeId] = useState(''), [failed, setFailed] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setOpen(false); setFailed(false); }, [projectId, taskId, role]);
  const task = deliveryRequirement(state, projectId, taskId);
  const preparing = taskAutomation(state, {projectId, taskId})?.preparation;
  if (role !== 'owner' || !task || preparing && ['preparing-session', 'ready'].includes(preparing.status) || task.stage !== 'preparing' || task.preparedAt || Object.values(task.nodes).some(node => node.status !== 'pending')) return null;
  const assigned = !!task.assigneeId;
  const members = projectMembers(state, projectId).filter(member => member.status === 'active');
  return <><Button type={secondary ? 'link' : 'primary'} size={secondary ? 'small' : 'middle'} aria-label={assigned ? '调整交付人' : '分配交付人'} onClick={() => { setAssigneeId(task.assigneeId); setFailed(false); setOpen(true); }}>{assigned ? '调整交付人' : '分配交付人'}</Button>
    <Modal title={assigned ? '调整需求交付人' : '确认需求并分配'} open={open} onCancel={() => setOpen(false)} closable={!busy} maskClosable={!busy} okText="确认分配" cancelText="取消" okButtonProps={{ 'aria-label': '确认分配需求', disabled: busy || assigneeId === task.assigneeId }} cancelButtonProps={{ disabled: busy }} confirmLoading={busy} onOk={async () => {
      if (busy) return;
      setFailed(false);
      const saved = await run(() => deliveryRequirementAction(state, role, { action: 'assign', input: { projectId, taskId, assigneeId } }), '交付人已更新');
      if (saved) receiveState(saved);
      if (!active.current) return;
      if (saved) setOpen(false); else setFailed(true);
    }}>
      <p>{task.title} · {displayRequirementId(task.id)}</p><p className="muted">{assigned ? '当前交付人：' + (members.find(member => member.id === task.assigneeId)?.name ?? '原交付人') + '。开始执行前可以调整交付人。' : '选择负责澄清、开发与验证的项目成员。'}Owner 负责验收。</p>
      <label htmlFor="requirement-assignee">交付人</label><Select id="requirement-assignee" aria-label="选择需求交付人" style={{ width: '100%', marginTop: 8 }} value={assigneeId} disabled={busy} options={[{ value: '', label: '暂不分配' }, ...members.map(member => ({ value: member.id, label: member.name }))]} onChange={setAssigneeId} />
      {failed && <Alert type="error" title="分配未保存，请核对错误提示。" />}
    </Modal>
  </>;
}
