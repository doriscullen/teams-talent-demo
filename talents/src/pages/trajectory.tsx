// 会话轨迹诊断的工作台。诊断不走审阅发布：左侧是诊断报告和各条优化建议，中间是报告或一条建议的内容，
// 右侧逐条应用或暂不采纳。Skill 建议写成项目 Skill 的新版本；工具和任务指令建议加入项目的 AGENTS.md 规则。
import { useState } from 'react';
import { App, Button, Collapse, Input, Modal, Tag } from 'antd';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import type { Artifact, SuggestionState } from '../types.ts';
import { artifact, session } from '../demo/model.ts';
import { when } from '../demo/format.ts';
import { applyRule, applySkill, currentSkill, decline, kindLabel, nextVersion, pendingCount, priorityLabel, proposedRule, reopen, report, rulesId, stateOf, type Report, type Suggestion } from '../demo/suggestions.ts';
import { ArtifactStatus, EmptyState, Fields } from '../components/ui.tsx';
import { DiffView, FileContent, FileList } from '../components/files.tsx';

const REPORT = 'report';
function StatusMark({ state }: { state: SuggestionState }) {
  if (state.status === 'applied') return <Tag className="file-mark" bordered={false} color="success">已应用</Tag>;
  if (state.status === 'declined') return <Tag className="file-mark" bordered={false}>不采纳</Tag>;
  return <Tag className="file-mark" bordered={false} color="warning">待应用</Tag>;
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
    <Fields rows={[['会话', sessions], ['诊断于', when(a.draft?.created)], ['问题链', r.chains + ' 条'], ['优化建议', r.suggestions.length + ' 条，' + pendingCount(a) + ' 条待应用']]} />
    <p className="caption">诊断不需要发布。逐条查看优化建议并应用：Skill 建议成为项目 Skill 的新版本；工具调用和任务指令建议加入项目的 AGENTS.md 规则。成员下次拉取后生效。</p>
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
  const { state: st, update, toast } = useTalents();
  const { modal } = App.useApp();
  const [declining, setDeclining] = useState(false);
  const state = stateOf(a, s.id), pid = a.projectId;
  const skill = s.skill && pid ? currentSkill(st, pid, s.skill) : null;
  const rulesVersion = (pid ? artifact(st, rulesId(pid))?.published?.version : 0) ?? 0;
  // Applying writes the suggestion as it is: the next skill version, or the next version of the AGENTS.md rules.
  const result = s.kind === 'skill' ? skill && s.skill + ' ' + nextVersion(skill.skill.version) : 'AGENTS.md 规则 v' + (rulesVersion + 1);
  const target = s.kind === 'skill'
    ? skill ? <>项目 Skill <code>{s.skill}</code>：{skill.skill.version} → {nextVersion(skill.skill.version)}</> : <>项目中没有 Skill <code>{s.skill}</code></>
    : <>项目的 AGENTS.md 规则：加入一条规则，发布 v{rulesVersion + 1}</>;
  const effect = s.kind === 'skill' ? '应用后，iCode Teams 中这个项目的 Skill 更新到新版本；成员下次准备任务时使用新版本，已冻结的上下文不变。'
    : '应用后，开发者端“项目知识”中的 AGENTS.md 规则显示“有更新”，成员更新后写入本机代码仓的 AGENTS.md。';
  const apply = () => modal.confirm({
    title: '应用这条优化建议？', content: <>{s.kind === 'skill' ? '写入' : '加入'}{target}。</>, okText: '应用', cancelText: '取消',
    onOk: () => {
      update(d => { const x = artifact(d, a.id)!; if (s.kind === 'skill') applySkill(d, x, s, nextVersion(skill!.skill.version), s.title); else applyRule(d, x, s, proposedRule(a.topic, s.id), s.title); });
      toast('已应用：' + result);
    },
  });
  return <>
    <h3>应用到</h3>
    <p>{target}</p>
    <p className="caption">{effect}</p>
    {state.status === 'pending' ? <div className="actions">
      <Button type="primary" disabled={!result} onClick={apply}>应用优化</Button>
      <Button onClick={() => setDeclining(true)}>暂不采纳</Button>
    </div> : state.status === 'applied'
      ? <div className="update-note"><b>已应用：{state.result}</b><span className="caption">{when(state.at)}</span></div>
      : <><div className="update-note"><b>暂不采纳</b><span className="caption">{state.reason ?? '没有填写原因'}，{when(state.at)}</span></div>
        <div className="actions"><Button onClick={() => { update(d => reopen(d, a, s.id)); toast('已恢复为待应用'); }}>重新考虑</Button></div></>}
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
