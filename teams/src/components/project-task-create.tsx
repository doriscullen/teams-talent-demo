import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { deliveryRequirementAction } from '../api.js';
import { useDemo } from '../context.js';
import { projectMembers } from '../teams-domain.js';

/** Creation is explicit; a failed save keeps both the draft and its request identity. */
export function ProjectTaskCreate({ projectId, kind, onCreated }: { projectId: string; kind: 'requirement' | 'issue'; onCreated(): void }) {
  const { state, role, busy, run, update, receiveState } = useDemo();
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false), [draftId, setDraftId] = useState('');
  const [form] = Form.useForm();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const requirement = kind === 'requirement', label = requirement ? '需求' : '问题';
  const members = projectMembers(state, projectId).filter(member => member.status === 'active');
  if (role !== 'owner') return null;
  return <>
    <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setDraftId((requirement ? 'REQ-' : 'ISSUE-') + crypto.randomUUID()); setFailed(false); setOpen(true); }}>新建{label}</Button>
    <Modal title={'新建' + label} open={open} okText={'创建' + label} cancelText="取消" onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={busy} okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} destroyOnHidden>
      {failed && <Alert type="error" title={label + '未保存，请核对错误提示后重试。填写内容已保留。'} />}
      <Form form={form} layout="vertical" disabled={busy} initialValues={{ title: '', description: '', assigneeId: '', due: '', severity: 'medium' }} onFinish={async values => {
        setFailed(false);
        const payload = { projectId, id: draftId, title: values.title.trim(), description: values.description.trim(), assigneeId: values.assigneeId ?? '' };
        const saved = requirement
          ? await run(() => deliveryRequirementAction(state, role, { action: 'create', input: { ...payload, ...(values.due ? { due: values.due } : {}) } }), '需求已创建')
          : await update('issue.create', { ...payload, severity: values.severity });
        if (saved && requirement) receiveState(saved);
        if (!active.current) return;
        if (!saved) { setFailed(true); return; }
        setOpen(false); onCreated();
      }}>
        <Form.Item name="title" label={label + '标题'} rules={[{ required: true, whitespace: true, message: '请填写' + label + '标题' }]}><Input aria-label={label + '标题'} maxLength={160} /></Form.Item>
        <Form.Item name="description" label={label + '描述'} rules={[{ required: true, whitespace: true, message: '请填写' + label + '描述' }]}><Input.TextArea aria-label={label + '描述'} rows={4} maxLength={4000} showCount /></Form.Item>
        {!requirement && <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}><Select aria-label="问题严重程度" options={[{ value: 'critical', label: '严重' }, { value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} /></Form.Item>}
        <Form.Item name="assigneeId" label={requirement ? '交付人' : '负责人'}><Select aria-label={requirement ? '需求交付人' : '问题负责人'} options={[{ value: '', label: '暂不分配' }, ...members.map(member => ({ value: member.id, label: member.name }))]} /></Form.Item>
        {requirement && <Form.Item name="due" label="计划完成"><Input type="date" aria-label="需求计划完成" /></Form.Item>}
      </Form>
    </Modal>
  </>;
}
