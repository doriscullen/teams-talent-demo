// 知识任务：一个层级（团队或项目）的任务列表、新建任务（来源在单独的选择弹窗中选），运行进度与产出。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Collapse, Drawer, Input, Modal, Progress, Radio, Segmented, Select, Space, Steps, Table, Tag } from 'antd';
import { PlusOutlined, StarOutlined } from '@ant-design/icons';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import type { Capability, Session, TalentsState, Task } from '../types.ts';
import { artifact, basisOf, capability, changesSince, levelName, levelSessions, levelSources, memberName, project, session, source, task, taskName } from '../demo/model.ts';
import { existingArtifact, runPlan, runProgress, startRun } from '../demo/runs.ts';
import { askICode } from '../demo/ask-icode.ts';
import { now, tokens, uid, versionLabel, when } from '../demo/format.ts';
import { CapIcon, CardGrid, EmptyState, Fields, ItemCard } from '../components/ui.tsx';
import { isDiagnosis, pendingCount } from '../demo/suggestions.ts';
import type { Toolbar } from './level.tsx';

function ResultTag({ t }: { t: Task }) {
  if (t.status === 'running') return <Tag color="processing">运行中</Tag>;
  if (!t.lastRun) return <Tag>未运行</Tag>;
  if (t.status === 'failed') return <Tag color="error">失败</Tag>;
  return <Tag color="success">成功</Tag>;
}
function sourceText(st: TalentsState, t: Task) {
  if (t.sessions) return t.sessions.length + ' 个团队会话';
  const names = t.sources.map(id => source(st, id)?.name ?? '已移除的来源').join('、');
  return t.prs ? names + '，' + t.prs.length + ' 个 PR' : names;
}
function scheduleText(t: Task) {
  const s = t.schedule;
  if (s.kind === 'daily') return t.cap === 'traj' ? '每天 ' + s.time + ' 分析新共享的会话' : '每天 ' + s.time + (t.skipUnchanged ? '，来源没有变化时跳过' : '');
  if (s.kind === 'once') return '定于 ' + s.at.replace('T', ' ');
  return '一次性';
}
const isHistory = (t: Task) => t.status !== 'running' && t.schedule.kind !== 'daily' && !!t.lastRun;
function nextRun(t: Task) {
  if (t.status === 'running') return '';
  if (t.schedule.kind === 'daily') return (now().slice(11) < t.schedule.time ? '今天 ' : '明天 ') + t.schedule.time;
  if (t.schedule.kind === 'once') return t.schedule.at.replace('T', ' ').slice(5);
  return '';
}
function modeText(st: TalentsState, t: Task) {
  if (t.mode !== 'update') return '构建';
  if (!t.input) return '更新现有知识';
  return source(st, t.sources[0])?.type === 'docs' ? '更新，' + versionLabel(t.input.from) + ' → ' + versionLabel(t.input.to) : '更新，提交 ' + t.input.from + ' → ' + t.input.to;
}

export function LevelTasks({ pid, toolbar }: { pid: string | null; toolbar: Toolbar }) {
  const { state: st, route, replace, update, go, toast, clock } = useTalents();
  const [tab, setTab] = useState<'current' | 'history'>('current'), [cat, setCat] = useState('all');
  const [form, setForm] = useState<Preset | null>(null), [detail, setDetail] = useState<string | null>(null);
  // ?new=1 (with cap / source / from) opens the form, ?open=<task> the detail; then the address drops them.
  useEffect(() => {
    const p = route.params;
    if (p.new) { setForm({ cap: p.cap, source: p.source, from: p.from }); replace(levelHash(pid, 'tasks')); }
    else if (p.open) { setDetail(p.open); replace(levelHash(pid, 'tasks')); }
  }, [route, replace, pid]);

  const run = (id: string) => { update(d => startRun(d, task(d, id)!)); setTab('current'); toast('已开始运行'); };
  const mine = st.tasks.filter(t => t.projectId === pid);
  const tasks = mine.filter(t => cat === 'all' || capability(st, t.cap).cat === cat);
  const current = tasks.filter(t => !isHistory(t)).sort((a, b) => {
    if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1;
    return (a.created ?? '') < (b.created ?? '') ? 1 : -1;
  });
  const history = tasks.filter(isHistory).sort((a, b) => (a.lastRun ?? '') < (b.lastRun ?? '') ? 1 : -1);
  const allCurrent = mine.filter(t => !isHistory(t)).length;
  const list = tab === 'current' ? current : history;
  const produced = (t: Task) => {
    const a = artifact(st, t.produced ?? t.artifact);
    return a && ['产出', <><a onClick={e => { e.stopPropagation(); go(levelHash(pid, 'review', { id: a.id })); }}>{a.name}</a>（{isDiagnosis(a) ? (pendingCount(a) ? pendingCount(a) + ' 条建议待应用' : '建议已处理') : a.draft ? '待审阅' : '已发布 v' + a.published!.version}）</>] as [string, ReactNode];
  };
  return <>
    {toolbar(<Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({})}>新建任务</Button>)}
    <div className="toolbar">
      <Segmented value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'current', label: '当前任务（' + allCurrent + '）' }, { value: 'history', label: '历史（' + (mine.length - allCurrent) + '）' }]} />
      <span className="spacer" />
      <Segmented value={cat} onChange={v => setCat(v as string)} options={[{ value: 'all', label: '全部能力' }, ...st.categories.map(c => ({ value: c.id, label: c.name }))]} />
    </div>
    {list.length ? <CardGrid>{list.map(t => {
      const cap = capability(st, t.cap), running = t.status === 'running', hist = isHistory(t), p = running ? runProgress(t, clock) : null;
      return <ItemCard key={t.id} icon={<CapIcon cap={cap} />} title={taskName(st, t)} extra={<ResultTag t={t} />} onClick={() => setDetail(t.id)}
        actions={!running && <Button size="small" onClick={() => run(t.id)}>{hist ? '再次运行' : '立即运行'}</Button>}>
        <Fields rows={hist
          ? [['来源', sourceText(st, t)], ['运行于', when(t.lastRun) + (t.duration ? '，用时 ' + t.duration : '')], produced(t)]
          : [['来源', sourceText(st, t)], ['时间', scheduleText(t)], !running && !!nextRun(t) && ['下次运行', nextRun(t)], !running && !!t.lastRun && ['最近运行', when(t.lastRun)], !running && !!t.lastRun && produced(t)]} />
        {p && <><Progress percent={p.pct} showInfo={false} size="small" /><p className="caption">{t.run!.plan.steps[p.step]}…</p></>}
      </ItemCard>;
    })}</CardGrid> : <EmptyState>{tab === 'current' ? '没有运行中或等待运行的任务' : '没有历史任务'}</EmptyState>}
    {detail && task(st, detail) && <TaskDetail id={detail} onClose={() => setDetail(null)} onRun={() => run(detail)} />}
    {form && <TaskForm level={pid} preset={form} onClose={() => setForm(null)} onCreated={(id, started) => { setTab('current'); setForm(null); if (started) setDetail(id); else toast('已创建任务'); }} />}
  </>;
}

// ---------- Detail ----------
function TaskDetail({ id, onClose, onRun }: { id: string; onClose(): void; onRun(): void }) {
  const { state: st, go, clock } = useTalents();
  const log = useRef<HTMLPreElement>(null);
  const t = task(st, id)!, cap = capability(st, t.cap), running = t.status === 'running';
  const p = running ? runProgress(t, clock) : null;
  const a = artifact(st, t.produced ?? t.artifact);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; });
  const outcome = a && (isDiagnosis(a) ? '诊断完成，' + (a.suggestions ?? []).length + ' 条优化建议，' + pendingCount(a) + ' 条待应用' : !a.draft ? (t.unchanged ? '来源没有变化，保持 v' + a.published!.version : (a.published!.auto ? '已自动发布 v' : '已发布 v') + a.published!.version)
    : a.published ? '原产物的新版本，等待审阅后发布' : '新产物，等待审阅后发布');
  return <Drawer open width={560} onClose={onClose} title={<div><div className="caption">{cap.name}</div>{taskName(st, t)}</div>}
    footer={<div className="drawer-foot">{running ? <span className="ui-note">可以关闭此面板，任务会继续运行。</span> : <>
      <span className="spacer" /><Button onClick={onRun}>立即运行</Button>{a?.draft && <Button type="primary" onClick={() => { onClose(); go(levelHash(a.projectId, 'review', { id: a.id })); }}>{isDiagnosis(a) ? '查看建议' : '去审阅'}</Button>}</>}</div>}>
    <div className="form-body">
      <Fields rows={[['能力', cap.name], ['来源', <>{sourceText(st, t)}{t.sessions && <Collapse ghost size="small" items={[{ key: 's', label: '查看会话', children: <ul className="file-lines">{t.sessions.map(sid => <li key={sid}>{session(st, sid)?.title ?? sid}</li>)}</ul> }]} />}</>],
        !!t.prs && ['PR', t.prs.map(n => '#' + n).join('、')], !!cap.update && ['方式', modeText(st, t)], ['时间', scheduleText(t)], ['状态', <ResultTag t={t} />]]} />
      {p ? <>
        <div className="field"><span className="label">进度</span><Progress percent={p.pct} showInfo={false} size="small" />
          <Steps size="small" direction="vertical" current={p.step} items={t.run!.plan.steps.map(title => ({ title }))} /></div>
        <div className="field"><span className="label">日志</span><pre className="log" ref={log}>{p.logs.join('\n')}</pre></div>
      </> : <>
        {a && <div className="produced"><div className="caption">本次产出</div><b>{a.name}</b><span>{outcome}</span></div>}
        <div className="field"><span className="label">最近一次运行</span><p>{(t.lastRun ?? '尚未运行') + (t.duration ? '，用时 ' + t.duration : '')}</p></div>
        {t.lastRun && <Collapse size="small" items={[{ key: 'log', label: '日志', children: <pre className="log">{(t.lastLogs ?? runPlan(st, t).logs).join('\n')}</pre> }]} />}
      </>}
    </div>
  </Drawer>;
}

// ---------- Selection dialogs ----------
function SessionPicker({ level, initial, onDone, onClose }: { level: string | null; initial: string[]; onDone(ids: string[]): void; onClose(): void }) {
  const { state: st } = useTalents();
  const all = levelSessions(st, level);
  const [selected, setSelected] = useState(() => new Set(initial));
  const [q, setQ] = useState(''), [member, setMember] = useState('all'), [inProject, setInProject] = useState('all'), [prompt, setPrompt] = useState('');
  const [ai, setAi] = useState<{ ids: string[]; answer: string } | null>(null), [busy, setBusy] = useState(false);
  // Example requests follow the Teams data: a member who shared sessions, other than the person viewing.
  const sharer = st.team.members.filter(m => m.id !== st.team.admin && all.some(s => s.owner === m.id))[1];
  const examples = ['对话轮次超过 50 的会话', '最近 7 天返现相关的会话', ...(sharer ? [sharer.name + '共享的会话'] : [])];
  const base = ai ? ai.ids.map(id => session(st, id)!).filter(Boolean) : all;
  const visible = base.filter(s => (member === 'all' || s.owner === member) && (inProject === 'all' || s.projectId === inProject) && (!q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase()) || s.id.includes(q.trim())));
  const ask = (text: string) => {
    if (!text.trim()) return;
    setPrompt(text); setBusy(true); setQ(''); setMember('all'); setInProject('all');
    setTimeout(() => { setAi(askICode(st, text, all)); setBusy(false); }, 1400 + Math.random() * 800);
  };
  // Only sessions whose transcript Teams collected can be diagnosed.
  const toggle = (ids: string[], on: boolean) => setSelected(prev => { const next = new Set(prev); ids.filter(id => !on || session(st, id)?.transcript).forEach(id => on ? next.add(id) : next.delete(id)); return next; });
  return <Modal open width={1000} title="选择会话" onCancel={onClose} className="picker-modal"
    footer={<div className="drawer-foot"><span className="ui-note">已选 <b>{selected.size}</b> 个会话</span><Button type="link" onClick={() => setSelected(new Set())}>清空</Button><span className="spacer" />
      <Button onClick={onClose}>取消</Button><Button type="primary" disabled={!selected.size} onClick={() => { onDone(all.filter(s => selected.has(s.id)).map(s => s.id)); onClose(); }}>确定</Button></div>}>
    <div className="form-body">
      <div className="ai-box"><div className="ai-title"><StarOutlined /> 让 iCode 帮你筛选</div>
        <Space.Compact style={{ width: '100%' }}><Input value={prompt} onChange={e => setPrompt(e.target.value)} onPressEnter={() => ask(prompt)} placeholder="用一句话描述要找的会话" /><Button type="primary" loading={busy} onClick={() => ask(prompt)}>{busy ? '筛选中' : '筛选'}</Button></Space.Compact>
        <div className="ai-examples"><span className="caption">试试：</span>{examples.map(x => <Button key={x} size="small" onClick={() => ask(x)}>{x}</Button>)}</div>
      </div>
      {ai && !busy && <Alert type="info" className="ai-answer" title={<><b>iCode：</b>{ai.answer}</>} action={<Space>{ai.ids.length > 0 && <Button size="small" onClick={() => toggle(ai.ids, true)}>全部选中</Button>}<Button size="small" type="link" onClick={() => setAi(null)}>显示全部会话</Button></Space>} />}
      <div className="picker-search">
        {level === null && <Select style={{ width: 160 }} aria-label="项目" value={inProject} onChange={setInProject} options={[{ value: 'all', label: '全部项目' }, ...st.projects.map(p => ({ value: p.id, label: p.name }))]} />}
        <Select showSearch optionFilterProp="label" style={{ width: 140 }} aria-label="成员" value={member} onChange={setMember} options={[{ value: 'all', label: '全部成员' }, ...st.team.members.map(m => ({ value: m.id, label: m.name }))]} />
        <Input.Search allowClear value={q} onChange={e => setQ(e.target.value)} placeholder="搜索会话名称或 ID" />
      </div>
      <Table<Session> size="small" rowKey="id" pagination={false} scroll={{ y: 360 }} dataSource={busy ? [] : visible} loading={busy && { tip: 'iCode 正在筛选会话…' }}
        locale={{ emptyText: busy ? ' ' : '没有匹配的会话' }}
        rowSelection={{ selectedRowKeys: [...selected], onSelect: (s, on) => toggle([s.id], on), onSelectAll: on => toggle(visible.filter(s => s.transcript).map(s => s.id), on),
          getCheckboxProps: s => ({ disabled: !s.transcript, title: s.transcript ? undefined : '没有会话原文，不能分析' }) }}
        onRow={s => ({ onClick: () => s.transcript && toggle([s.id], !selected.has(s.id)), className: s.transcript ? 'row-click' : 'row-disabled', title: s.transcript ? undefined : '没有会话原文，不能分析' })}
        columns={[
          { title: '名称', dataIndex: 'title' },
          ...(level === null ? [{ title: '项目', width: 130, ellipsis: true, render: (_: unknown, s: Session) => project(st, s.projectId)?.name ?? s.projectId }] : []),
          { title: '成员', width: 90, render: (_, s) => memberName(st, s.owner, s.ownerName) },
          { title: '最后更新', width: 110, render: (_, s) => when(s.updated) },
          { title: '对话轮次', dataIndex: 'turns', align: 'right', width: 90 },
          { title: '消息', dataIndex: 'messages', align: 'right', width: 70 },
          { title: 'Token', align: 'right', width: 90, render: (_, s) => tokens(s.tokens) },
        ]} />
    </div>
  </Modal>;
}

function PrPicker({ repoId, initial, onDone, onClose }: { repoId: string; initial: number[]; onDone(list: number[]): void; onClose(): void }) {
  const { state: st } = useTalents();
  const [selected, setSelected] = useState(() => new Set(initial)), [q, setQ] = useState('');
  const s = q.trim().toLowerCase().replace(/^#/, '');
  const list = (st.prs[repoId] ?? []).slice().reverse().filter(p => !s || String(p.number).startsWith(s) || p.title.toLowerCase().includes(s));
  const toggle = (n: number) => setSelected(prev => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  return <Modal open title="选择 PR" onCancel={onClose}
    footer={<div className="drawer-foot"><span className="ui-note">已选 <b>{selected.size}</b> 个 PR</span><span className="spacer" /><Button onClick={onClose}>取消</Button>
      <Button type="primary" disabled={!selected.size} onClick={() => { onDone([...selected].sort((a, b) => a - b)); onClose(); }}>确定</Button></div>}>
    <div className="form-body">
      <Input.Search allowClear value={q} onChange={e => setQ(e.target.value)} placeholder="按编号或标题搜索" />
      <Table size="small" rowKey="number" pagination={false} showHeader={false} scroll={{ y: 'min(420px, 55vh)' }} dataSource={list} locale={{ emptyText: '没有匹配的 PR' }}
        rowSelection={{ selectedRowKeys: [...selected], onSelect: p => toggle(p.number), hideSelectAll: true }}
        onRow={p => ({ onClick: () => toggle(p.number), className: 'row-click' })}
        columns={[{ render: (_, p) => <b>#{p.number}</b>, width: 60 }, { dataIndex: 'title' }, { dataIndex: 'merged', width: 100, className: 'caption' }]} />
    </div>
  </Modal>;
}

// ---------- Form ----------
interface Preset { cap?: string; source?: string; from?: string }
/** level: the team (null) or project the task belongs to; undefined lets the user choose (from 知识能力). */
export function TaskForm({ level: fixed, preset, onClose, onCreated }: { level?: string | null; preset: Preset; onClose(): void; onCreated(id: string, started: boolean, level: string | null): void }) {
  const { state: st, update, focusProject } = useTalents();
  // "重新提取" on an artifact: start from the task that built it.
  const fromArtifact = artifact(st, preset.from);
  const fromTask = fromArtifact ? st.tasks.find(t => (t.produced ?? t.artifact) === fromArtifact.id) : undefined;
  const presetSource = source(st, fromArtifact ? fromArtifact.sources[0] : preset.source);
  const [capId, setCapId] = useState(fromArtifact?.cap ?? preset.cap ?? (presetSource ? (presetSource.type === 'repo' ? 'miner-pr' : 'doc-extract') : 'traj'));
  const [chosen, setChosen] = useState<string | null>(presetSource?.id ?? null);
  // Chosen in the form only when not given: start with the project the user came for.
  const [level, setLevel] = useState<string | null>(fixed !== undefined ? fixed : focusProject ?? st.projects[0]?.id ?? null);
  const [prs, setPrs] = useState<number[]>([]), [sessions, setSessions] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<'now' | 'once' | 'daily'>('now'), [mode, setMode] = useState<'update' | 'build'>('update');
  const [at, setAt] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T09:00'), [time, setTime] = useState('02:00'), [skip, setSkip] = useState(true);
  const [name, setName] = useState(''), [agentId, setAgentId] = useState(fromTask?.agent ?? st.agents[0]?.id);
  const cap: Capability = capability(st, capId);
  const [prompt, setPrompt] = useState(fromTask?.prompt ?? cap.prompt ?? '');
  const [scenario, setScenario] = useState(''), [snippets, setSnippets] = useState('');
  const [picking, setPicking] = useState<'sessions' | 'prs' | null>(null);

  const own = levelSources(st, level), repos = own.filter(s => s.type === 'repo');
  const pool = cap.input === 'docs' ? own.filter(s => s.type === 'docs') : cap.input === 'repo+pr' ? repos.filter(s => s.prs) : repos;
  const src = cap.input === 'sessions' ? 's-sessions' : pool.some(s => s.id === chosen) ? chosen : pool[0]?.id ?? null;
  // Update vs rebuild: only when the capability declares an update and this input already has knowledge.
  const modeInfo = (() => {
    if (!cap.update || !src || cap.input === 'sessions') return null;
    const a = existingArtifact(st, { projectId: level, cap: capId, sources: [src] }), basis = a && basisOf(a);
    return basis ? { artifact: a!, changes: changesSince(source(st, src), basis) } : null;
  })();

  let ok = !!src, hint = src ? '' : levelName(st, level) + '还没有' + (cap.input === 'docs' ? '文档集' : cap.input === 'repo+pr' ? '有 PR 记录的代码仓' : '代码仓');
  if (modeInfo && mode === 'update' && schedule !== 'daily' && modeInfo.changes && !modeInfo.changes.count) { ok = false; hint = '来源没有变化，无需更新'; }
  if (cap.input === 'sessions') { ok = sessions.length > 0; hint = ok ? '' : '请选择会话'; }
  if (cap.input === 'repo+pr' && src) { ok = prs.length > 0; hint = ok ? '' : '请选择 PR'; }
  if (cap.input === 'repo+snippet' && src) { ok = !!scenario.trim() && !!snippets.trim(); hint = ok ? '' : '请填写场景和代码片段'; }

  const changeCap = (id: string) => { setCapId(id); setPrs([]); setPrompt(capability(st, id).prompt ?? ''); };
  const changeLevel = (id: string | null) => { setLevel(id); setChosen(null); setPrs([]); setSessions([]); };
  const submit = () => {
    const id = uid('t');
    const t: Task = {
      id, projectId: level, name: name.trim(), cap: capId, sources: [src!], created: now(), status: 'idle',
      mode: modeInfo ? mode : 'build', prompt: cap.skill ? prompt : undefined,
      schedule: schedule === 'daily' ? { kind: 'daily', time: time || '02:00' } : schedule === 'once' ? { kind: 'once', at } : { kind: 'now' },
    };
    if (cap.input === 'sessions') t.sessions = sessions.slice();
    if (cap.input === 'repo+pr') t.prs = prs.slice();
    if (t.schedule.kind === 'daily' && cap.input !== 'sessions') t.skipUnchanged = skip;
    update(d => { d.tasks.unshift(t); if (schedule === 'now') startRun(d, d.tasks[0]); });
    onCreated(id, schedule === 'now', level);
  };
  const pickRow = (text: string, label: string, empty: boolean, onPick: () => void) =>
    <div className={'pick-summary' + (empty ? ' empty' : '')}><span>{text}</span><Button size="small" onClick={onPick}>{label}</Button></div>;
  const changeNote = modeInfo && (() => {
    const c = modeInfo.changes, s = source(st, src)!, docs = s.type === 'docs', verb = docs ? '提取' : '构建', what = docs ? '文档' : '代码';
    return c && c.count ? '上次' + verb + '后' + what + '有变化：' + (docs ? versionLabel(c.from) + ' → ' + versionLabel(c.to) + '，' : '') + c.text : '上次' + verb + '后' + what + '没有变化';
  })();

  return <Drawer open width={560} title={fixed === undefined ? '新建任务' : <div><div className="caption">{levelName(st, level)}</div>新建任务</div>} onClose={onClose}
    footer={<div className="drawer-foot"><span className="ui-note">{hint}</span><span className="spacer" /><Button onClick={onClose}>取消</Button><Button type="primary" disabled={!ok} onClick={submit}>{schedule === 'now' ? '创建并运行' : '创建'}</Button></div>}>
    <div className="form-body">
      {fixed === undefined && <div className="field"><span className="label">所属</span>
        <Select value={level ?? ''} onChange={v => changeLevel(v || null)} options={[{ value: '', label: '团队' }, ...st.projects.map(p => ({ value: p.id, label: p.name }))]} />
        <span className="caption">任务只能使用{level ? '这个项目' : '团队级'}的来源，产出的知识也归属{level ? '这个项目' : '团队'}。</span></div>}
      <div className="field"><span className="label">能力</span>
        <Select value={capId} onChange={changeCap} options={st.categories.map(c => ({ label: c.name, title: c.name, options: st.capabilities.filter(x => x.cat === c.id).map(x => ({ value: x.id, label: x.name })) }))} />
        <span className="caption">{cap.desc}</span></div>
      <div className="field"><span className="label">来源</span>
        {cap.input === 'sessions'
          ? pickRow(sessions.length ? '已选 ' + sessions.length + ' 个会话' : '还没有选择会话', sessions.length ? '重新选择' : '选择会话…', !sessions.length, () => setPicking('sessions'))
          : <div className="stack">
            <Select value={src ?? undefined} onChange={v => { setChosen(v); setPrs([]); }} options={pool.map(s => ({ value: s.id, label: s.name }))} />
            {cap.input === 'repo+pr' && pickRow(prs.length ? '已选 ' + prs.length + ' 个 PR：' + prs.map(n => '#' + n).join('、') : '还没有选择 PR', prs.length ? '重新选择' : '选择 PR…', !prs.length, () => setPicking('prs'))}
            {cap.input === 'repo+snippet' && <><Input value={scenario} onChange={e => setScenario(e.target.value)} placeholder="场景，例如：账户余额更新" />
              <Input.TextArea rows={2} value={snippets} onChange={e => setSnippets(e.target.value)} placeholder="代码片段文件，每行一个路径" /></>}
          </div>}
      </div>
      {modeInfo && <div className="field"><span className="label">方式</span>
        <Radio.Group className="option-list" value={mode} onChange={e => setMode(e.target.value)}>
          <Radio value="update"><b>更新现有知识</b><span className="caption">{changeNote}</span></Radio>
          <Radio value="build"><b>重新构建</b><span className="caption">全部重新处理，生成「{modeInfo.artifact.name}」的新版本</span></Radio>
        </Radio.Group></div>}
      <div className="field"><span className="label">时间</span>
        <Select value={schedule} onChange={setSchedule} options={[{ value: 'now', label: '立即执行' }, { value: 'once', label: '指定时间执行一次' }, { value: 'daily', label: '每天定时' }]} />
        {schedule === 'once' && <Input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />}
        {schedule === 'daily' && <Input type="time" value={time} onChange={e => setTime(e.target.value)} />}
        {schedule === 'daily' && cap.input === 'sessions' && <span className="caption">每天分析新共享的会话；首次运行分析上面选择的会话。</span>}
        {schedule === 'daily' && cap.input !== 'sessions' && <Checkbox checked={skip} onChange={e => setSkip(e.target.checked)}>来源没有变化时跳过</Checkbox>}
      </div>
      <label className="field"><span className="label">名称 <span className="caption">可选</span></span>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={taskName(st, { cap: capId, sources: src ? [src] : [], sessions: cap.input === 'sessions' ? sessions : undefined })} /></label>
      {cap.skill && <Collapse size="small" items={[{ key: 'adv', label: '高级设置', children: <div className="form-body flush">
        <div className="field"><span className="label">执行任务的智能体</span><Select value={agentId} onChange={setAgentId} options={st.agents.map(a => ({ value: a.id, label: a.name }))} /></div>
        <div className="field"><span className="label">提示词</span><Input.TextArea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} /></div>
      </div> }]} />}
    </div>
    {picking === 'sessions' && <SessionPicker level={level} initial={sessions} onDone={setSessions} onClose={() => setPicking(null)} />}
    {picking === 'prs' && src && <PrPicker repoId={src} initial={prs} onDone={setPrs} onClose={() => setPicking(null)} />}
  </Drawer>;
}
