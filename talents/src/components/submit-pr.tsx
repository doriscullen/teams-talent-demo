import { useState } from 'react';
import { Alert, Form, Input, Modal } from 'antd';
import { useTalents } from '../store.tsx';
import type { Artifact, Submission } from '../types.ts';
import type { Suggestion } from '../demo/suggestions.ts';
import { artifact } from '../demo/model.ts';
import { now } from '../demo/format.ts';

export function SubmissionLink({ submission }: { submission: Submission }) {
  return <div className="update-note"><b>PR 已创建</b><a href={submission.url} target="_blank" rel="noreferrer">查看 PR</a><span className="caption">{submission.repository} · {submission.base}</span></div>;
}

export function SubmitDialog({ a, suggestion, onClose }: { a: Artifact; suggestion?: Suggestion; onClose(): void }) {
  const { state, submit, update, toast } = useTalents();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [form] = Form.useForm();
  const repo = state.sources.find(s => s.type === 'repo' && s.projectId === a.projectId);
  if (a.kind === 'index') return <Modal open title="启用远端索引" okText="启用" onCancel={onClose} onOk={() => {
    update(d => { const x = artifact(d, a.id)!; x.published = { version: (x.published?.version ?? 0) + 1, at: now(), note: '远端索引已就绪', delivery: 'cloud', basis: x.draft?.basis }; x.draft = null; });
    onClose(); toast('远端索引已就绪');
  }}><p>索引保留在远端，可通过 MCP 在线查询。</p></Modal>;
  return <Modal open title={suggestion ? '提交改进 PR' : '提交知识 PR'} okText="提交 PR" cancelText="取消" confirmLoading={busy} onCancel={busy ? undefined : onClose} cancelButtonProps={{ disabled: busy }} onOk={() => form.submit()}>
    <p className="caption">在目标仓库创建分支和 PR，由开发者审阅合入。{suggestion ? '' : '知识文件写入 docs/knowledge/' + a.id + '/。'}</p>
    {error && <Alert type="error" showIcon title="提交失败" description={error} />}
    <Form form={form} layout="vertical" initialValues={{ repository: a.submission?.repository ?? repo?.origin?.replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '') ?? '', base: a.submission?.base ?? repo?.branch ?? 'main', note: suggestion?.title ?? a.name, skillDirectory: '.agents/skills/' + suggestion?.skill }} onFinish={async values => {
      setBusy(true); setError('');
      try { await submit({ ...values, artifactId: a.id, suggestionId: suggestion?.id }); onClose(); toast('PR 已创建'); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <Form.Item name="repository" label="GitHub 仓库" rules={[{ required: true, pattern: /^[\w.-]+\/[\w.-]+$/, message: '请输入 owner/repo' }]}><Input placeholder="owner/repo" /></Form.Item>
      <Form.Item name="base" label="目标分支" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
      {suggestion?.kind === 'skill' && <Form.Item name="skillDirectory" label="仓内 Skill 目录" rules={[{ required: true }]}><Input /></Form.Item>}
      <Form.Item name="note" label="提交说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
    </Form>
  </Modal>;
}
