// 会话轨迹诊断的工作台。诊断不走审阅发布：左侧是诊断报告和各条优化建议，中间是报告或一条建议的内容，
// 右侧逐条提交改进 PR 或暂不采纳。Skill 建议修改项目 Skill 的文件；工具和任务指令建议向 AGENTS.md 补充规则。
import { useState } from 'react';
import { Button, Collapse, Input, Modal, Tag } from 'antd';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import type { Artifact, SuggestionState } from '../types.ts';
import { artifact, session } from '../demo/model.ts';
import { when } from '../demo/format.ts';
import { decline, kindLabel, pendingCount, priorityLabel, proposedRule, reopen, report, stateOf, type Report, type Suggestion } from '../demo/suggestions.ts';
import { SubmitDialog, SubmissionLink } from '../components/submit-pr.tsx';
import { ArtifactStatus, EmptyState, Fields } from '../components/ui.tsx';
import { DiffView, FileContent, FileList } from '../components/files.tsx';

const REPORT = 'report';
function StatusMark({ state }: { state: SuggestionState }) {
  if (state.status === 'submitted' || state.status === 'applied') return <Tag className="file-mark" bordered={false} color="success">PR 已创建</Tag>;
  if (state.status === 'declined') return <Tag className="file-mark" bordered={false}>不采纳</Tag>;
  return <Tag className="file-mark" bordered={false} color="warning">待提交</Tag>;
}

export function DiagnosisWorkbench({ id }: { id: string }) {
  const { state: st } = useTalents();
  const [item, setItem] = useState(REPORT);
  const a = artifact(st, id), r = report(a?.topic);
  if (!a || !r) return <EmptyState>找不到这个诊断。<a href="#/projects">返回项目</a></EmptyState>;
  const picked = r.suggestions.find(s => s.id === item);
  return <div className="wb">
    <PageHeader title={a.name} description="会话轨迹诊断" actions={<ArtifactStatus a={a} />} />
    <div className="wb-body">
      <FileList current={item} onSelect={setItem} groups={[
        { title: '', items: [{ key: REPORT, label: '诊断报告' }] },
        { title: '优化建议', items: r.suggestions.map(s => ({ key: s.id, indent: true, label: <>{s.title}<StatusMark state={stateOf(a, s.id)} /></> })) },
      ]} />
      <section className="wb-main"><div className="wb-view" key={item}>
        {picked ? <SuggestionView a={a} s={picked} /> : <FileContent st={st} a={a} file={a.files![0]} text={null} />}
      </div></section>
      <aside className="wb-side"><div className="side-body">
        {picked ? <SuggestionSide a={a} s={picked} /> : <DiagnosisSide a={a} r={r} onOpen={setItem} />}
      </div></aside>
    </div>
  </div>;
}

function DiagnosisSide({ a, r, onOpen }: { a: Artifact; r: Report; onOpen(id: string): void }) {
  const { state: st } = useTalents();
  const sessions = (a.sessions ?? []).map(id => session(st, id)?.title ?? id).join('、');
  return <>
    <h3>诊断</h3>
    <Fields rows={[['会话', sessions], ['诊断于', when(a.draft?.created)], ['问题链', r.chains + ' 条'], ['优化建议', r.suggestions.length + ' 条，' + pendingCount(a) + ' 条待提交']]} />
    <p className="caption">逐条查看优化建议，提交对项目 Skill 或 AGENTS.md 的改进 PR，由开发者审阅合入。</p>
    <div className="suggestion-list">{r.suggestions.map(s => <a key={s.id} onClick={() => onOpen(s.id)}><span>{s.title}</span><StatusMark state={stateOf(a, s.id)} /></a>)}</div>
  </>;
}

function SuggestionView({ a, s }: { a: Artifact; s: Suggestion }) {
  const list = (label: string, items: string[]) => items.length > 0 && <div className="suggestion-section"><h3>{label}</h3><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  const [main, ...supporting] = s.files;
  return <div className="suggestion">
    <header className="suggestion-head">
      <div className="suggestion-tags"><Tag color="purple">{kindLabel[s.kind]}</Tag><Tag color={s.priority === 'high' ? 'error' : s.priority === 'medium' ? 'warning' : 'default'}>优先级：{priorityLabel[s.priority]}</Tag></div>
      <h2>{s.title}</h2>
    </header>
    <dl className="suggestion-story">
      {([['背景', s.background], ['现象', s.observation], ['目标', s.goal]] as const).filter(([, text]) => text).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
    </dl>
    {s.kind === 'skill'
      ? <div className="suggestion-section"><h3>修改内容</h3>{s.change && <p className="ui-note">{s.change}</p>}
        {s.files.map(f => <div className="suggestion-file" key={f.path}><code>{f.path}</code><DiffView before={f.before} after={f.after} /></div>)}</div>
      : <>
        <div className="suggestion-section"><h3>写入 AGENTS.md 的规则</h3><div className="rule-text">{proposedRule(a.topic, s.id)}</div></div>
        <Collapse size="small" items={[
          { key: 'origin', label: '报告中的原始建议：' + (s.kind === 'prompt' ? '在任务指令后追加验收要求' : '修改工具调用'), children: <DiffView before={main.before} after={main.after} /> },
          ...supporting.map(f => ({ key: f.path, label: '配套修改（需在代码仓中提交）：' + f.path, children: <>{f.reason && <p className="ui-note">{f.reason}</p>}<DiffView before={f.before} after={f.after} /></> })),
        ]} />
      </>}
    <div className="suggestion-columns">{list('风险', s.risks)}{list('验证方法', s.validation)}</div>
  </div>;
}

function SuggestionSide({ a, s }: { a: Artifact; s: Suggestion }) {
  const { update, toast } = useTalents();
  const [declining, setDeclining] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const state = stateOf(a, s.id);
  return <>
    <h3>提交改进</h3>
    <p>{s.kind === 'skill' ? '修改项目 Skill：' + s.skill : '向项目 AGENTS.md 补充规则'}</p>
    <p className="caption">自动创建 PR，由开发者审阅合入。不直接修改当前项目的能力版本。</p>
    {state.status === 'pending' ? <div className="actions">
      <Button type="primary" onClick={() => setSubmitting(true)}>提交改进 PR</Button>
      <Button onClick={() => setDeclining(true)}>暂不采纳</Button>
    </div> : state.status === 'submitted' ? <SubmissionLink submission={state.submission!} />
      : state.status === 'declined' ? <><p>暂不采纳：{state.reason ?? '没有填写原因'}</p>
        <Button onClick={() => update(d => reopen(d, a, s.id))}>重新考虑</Button></> : <p>历史处理记录</p>}
    {submitting && <SubmitDialog a={a} suggestion={s} onClose={() => setSubmitting(false)} />}
    {declining && <DeclineDialog onClose={() => setDeclining(false)} onDone={reason => { update(d => decline(d, a, s.id, reason)); setDeclining(false); toast('已标记为暂不采纳'); }} />}
  </>;
}

function DeclineDialog({ onClose, onDone }: { onClose(): void; onDone(reason: string): void }) {
  const [reason, setReason] = useState('');
  return <Modal open title="暂不采纳这条建议？" okText="暂不采纳" cancelText="取消" onOk={() => onDone(reason)} onCancel={onClose}>
    <div className="form-body"><label className="field"><span className="label">原因 <span className="caption">可选</span></span>
      <Input.TextArea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：已有其他方案覆盖" /></label></div>
  </Modal>;
}
