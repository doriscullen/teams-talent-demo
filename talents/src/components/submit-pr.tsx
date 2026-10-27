import { useEffect, useState } from 'react';
import { Alert, Form, Input, Modal } from 'antd';
import { useTalents } from '../store.tsx';
import { pullRequestTarget, type PullRequestTarget } from '../api.ts';
import type { Artifact, Submission } from '../types.ts';
import type { Suggestion } from '../demo/suggestions.ts';
import { artifact } from '../demo/model.ts';
import { now } from '../demo/format.ts';

export function SubmissionLink({ submission }: { submission: Submission }) {
  return <div className="update-note"><b>PR 已创建</b><a href={submission.url} target="_blank" rel="noreferrer">查看 PR</a><span className="caption">{submission.repository} · {submission.base}</span></div>;
}

export function SubmitDialog({ a, suggestion, onClose }: { a: Artifact; suggestion?: Suggestion; onClose(): void }) {
  const { submit, update, toast } = useTalents();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [target, setTarget] = useState<PullRequestTarget | string | null>(null);
  const [form] = Form.useForm();
  const skillDirectory = (directory: string) => (directory ? directory + '/' : '') + '.agents/skills/' + suggestion?.skill;
  // The project's repository, or the fork of it among the local git remotes; a PR submitted before keeps its target.
  useEffect(() => {
    if (a.kind === 'index' || !a.projectId) return;
    pullRequestTarget(a.projectId).then(t => {
      setTarget(t);
      if (!a.submission) form.setFieldsValue({ repository: t.repository, base: t.base });
      form.setFieldsValue({ skillDirectory: skillDirectory(t.directory) });
    }, e => setTarget((e as Error).message));
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const where = typeof target === 'string' ? target : target && (target.fork ? '检测到 fork 仓，默认提交到 fork 的 ' : '本地没有 fork 远端，默认提交到项目仓库的 ') + target.base + ' 分支。';
  if (a.kind === 'index') return <Modal open title="启用远端索引" okText="启用" onCancel={onClose} onOk={() => {
    update(d => { const x = artifact(d, a.id)!; x.published = { version: (x.published?.version ?? 0) + 1, at: now(), note: '远端索引已就绪', delivery: 'cloud', basis: x.draft?.basis }; x.draft = null; });
    onClose(); toast('远端索引已就绪');
  }}><p>索引保留在远端，可通过 MCP 在线查询。</p></Modal>;
  return <Modal open title={suggestion ? '提交改进 PR' : '提交知识 PR'} okText="提交 PR" cancelText="取消" confirmLoading={busy} onCancel={busy ? undefined : onClose} cancelButtonProps={{ disabled: busy }} onOk={() => form.submit()}>
    <p className="caption">在目标仓库创建分支和 PR，由开发者审阅合入。{where}</p>
    {error && <Alert type="error" showIcon title="提交失败" description={error} />}
    <Form form={form} layout="vertical" initialValues={{ repository: a.submission?.repository ?? '', base: a.submission?.base ?? 'main', note: suggestion?.title ?? a.name, skillDirectory: skillDirectory('') }} onFinish={async values => {
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
