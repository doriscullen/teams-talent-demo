// 来源：一个层级（团队或项目）的代码仓和文档集；项目另有成员共享的会话和项目 Skill。代码仓、设计文档、
// 会话和 Skill 来自 iCode Teams，在这里只读；Talents 只登记本地文档目录。
import { useEffect, useState, type ReactNode } from 'react';
import { App, AutoComplete, Button, Collapse, Drawer, Form, Input, Modal, Space, Table, Tag, type TableColumnsType } from 'antd';
import { ExportOutlined, PlusOutlined } from '@ant-design/icons';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import type { DocVersion, ProjectSkill, Session, SkillVersion, Source, TalentsState } from '../types.ts';
import { changeCounts, knownFiles, latestVersion, levelName, levelSessions, levelSources, memberName, project, source, sourceFiles } from '../demo/model.ts';
import { now, tokens, uid, when } from '../demo/format.ts';
import { getSkill } from '../api.ts';
import { Markdown } from '../components/files.tsx';
import { currentSkill } from '../demo/suggestions.ts';
import { CardGrid, EmptyState, Fields, FileMark, ItemCard, Section, SourceIcon } from '../components/ui.tsx';
import type { Toolbar } from './level.tsx';

const fromText = (s: Source) => s.from ? { teams: '来自 iCode Teams', git: '来自 Git 仓库', shared: '来自共享目录' }[s.from.kind] : '';

export function LevelSources({ pid, toolbar }: { pid: string | null; toolbar: Toolbar }) {
  const { state: st, teamsLink } = useTalents();
  const [open, setOpen] = useState<string | null>(null), [registering, setRegistering] = useState(false);
  const [collection, setCollection] = useState<'sessions' | 'skills' | null>(null);
  const list = levelSources(st, pid), p = project(st, pid);
  const card = (s: Source) => <ItemCard key={s.id} icon={<SourceIcon type={s.type} />} title={s.name} subtitle={<span className="path">{s.path}</span>} onClick={() => setOpen(s.id)}
    caption={s.fromTeams ? <Tag>iCode Teams</Tag> : <Tag>本地登记</Tag>}
    actions={<Button type="link" size="small" onClick={() => setOpen(s.id)}>详情</Button>}>
    {s.desc && <p>{s.desc}</p>}
    <Fields rows={s.type === 'repo' ? [['分支', s.branch]] : [['文件', s.files + ' 个' + (fromText(s) ? '，' + fromText(s) : '')], !!latestVersion(s) && ['最近变化', when(latestVersion(s))]]} />
  </ItemCard>;
  const section = (type: Source['type'], title: string, empty: ReactNode) => {
    const items = list.filter(s => s.type === type);
    return <Section title={title} note={items.length}>{items.length ? <CardGrid>{items.map(card)}</CardGrid> : <EmptyState>{empty}</EmptyState>}</Section>;
  };
  return <>
    {toolbar(<Button type="primary" icon={<PlusOutlined />} onClick={() => setRegistering(true)}>登记本地文档来源</Button>)}
    {p ? <>
      {section('repo', '代码仓', <>没有代码仓 <a href={teamsLink(p.id)}>去 Teams 添加</a></>)}
      {section('docs', '文档集', <>没有文档集 <a href={teamsLink(p.id)}>去 Teams 添加</a></>)}
      <TeamsCollections p={p} sessions={levelSessions(st, p.id)} onOpen={setCollection} />
    </> : section('docs', '文档集', '没有文档集')}
    {open && source(st, open) && <SourceDrawer id={open} onClose={() => setOpen(null)} />}
    {p && collection === 'sessions' && <SessionsDrawer sessions={levelSessions(st, p.id)} onClose={() => setCollection(null)} />}
    {p && collection === 'skills' && <SkillsDrawer pid={p.id} skills={p.skills} onClose={() => setCollection(null)} />}
    {registering && <RegisterSource pid={pid} onClose={() => setRegistering(false)} />}
  </>;
}

// ---------- Sessions and skills (from Teams, read-only) ----------
// Each is one card; the card opens a drawer listing them, and a row switches the drawer to its details.
const PAGE = 10;
const latest = (sessions: Session[]) => sessions.reduce((a, s) => s.updated > a ? s.updated : a, '');
function TeamsCollections({ p, sessions, onOpen }: { p: { skills: ProjectSkill[] }; sessions: Session[]; onOpen(which: 'sessions' | 'skills'): void }) {
  const members = new Set(sessions.map(s => s.owner)).size, names = p.skills.slice(0, 2).map(s => s.name).join('、');
  const card = (which: 'sessions' | 'skills', title: string, rows: [string, ReactNode][]) =>
    <ItemCard key={which} icon={<SourceIcon type={which} />} title={title} onClick={() => onOpen(which)}
      caption={<Tag>iCode Teams</Tag>} actions={<Button type="link" size="small" onClick={() => onOpen(which)}>查看</Button>}><Fields rows={rows} /></ItemCard>;
  return <Section title="会话与 Skill">
    <CardGrid>
      {card('sessions', '成员共享的会话', sessions.length
        ? [['会话', sessions.length + ' 个，' + members + ' 位成员'], ['最近更新', when(latest(sessions))]] : [['会话', '0 个']])}
      {card('skills', '项目 Skill', p.skills.length
        ? [['Skill', p.skills.length + ' 个'], ['包括', names + (p.skills.length > 2 ? ' 等' : '')]] : [['Skill', '0 个']])}
    </CardGrid>
  </Section>;
}

/** A drawer listing items with search and pages; picking one shows its details in the same drawer. */
function ListDrawer<T extends { id: string }>({ title, items, search, columns, detail, onClose }: {
  title: string; items: T[]; search(item: T, q: string): boolean; columns: TableColumnsType<T>;
  detail(item: T): { title: ReactNode; body: ReactNode }; onClose(): void;
}) {
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [picked, setPicked] = useState<T | null>(null);
  const shown = items.filter(item => !q.trim() || search(item, q.trim().toLowerCase())), d = picked && detail(picked);
  return <Drawer open width={760} onClose={onClose} title={d ? <div><a className="caption" onClick={() => setPicked(null)}>← 返回{title}</a><div>{d.title}</div></div> : <div><div className="caption">来自 iCode Teams</div>{title}</div>}>
    {d ? d.body : <div className="form-body">
      <Input.Search allowClear value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="搜索名称" />
      <Table<T> size="small" rowKey="id" dataSource={shown} columns={columns} locale={{ emptyText: '没有匹配的结果' }}
        pagination={shown.length > PAGE && { current: page, pageSize: PAGE, onChange: setPage, showSizeChanger: false, size: 'small' }}
        onRow={item => ({ onClick: () => setPicked(item), className: 'row-click' })} />
    </div>}
  </Drawer>;
}

function SessionsDrawer({ sessions, onClose }: { sessions: Session[]; onClose(): void }) {
  const { state: st } = useTalents();
  const owner = (s: Session) => memberName(st, s.owner, s.ownerName);
  return <ListDrawer<Session> title="成员共享的会话" items={[...sessions].sort((a, b) => a.updated < b.updated ? 1 : -1)} onClose={onClose}
    search={(s, q) => s.title.toLowerCase().includes(q) || s.id.includes(q) || owner(s).includes(q)}
    columns={[
      { title: '名称', dataIndex: 'title' },
      { title: '成员', width: 80, render: (_, s) => owner(s) },
      { title: '关联需求', width: 120, render: (_, s) => s.requirementId ?? <span className="ui-note">无</span> },
      { title: '对话轮次', dataIndex: 'turns', align: 'right', width: 90 },
      { title: '最后更新', width: 110, className: 'nowrap', render: (_, s) => when(s.updated) },
    ]}
    detail={s => ({ title: s.title, body: <div className="form-body">
      {s.summary && <p>{s.summary}</p>}
      <Fields rows={[['成员', owner(s)], !!s.agent && ['Agent', s.agent], !!s.model && ['模型', s.model], ['关联需求', s.requirementId ?? <span className="ui-note">无</span>],
        ['对话轮次', s.turns], ['消息', s.messages], ['Token', tokens(s.tokens)], ['最后更新', when(s.updated)], !!s.cwd && ['工作目录', <span className="path">{s.cwd}</span>], ['会话 ID', <code>{s.id}</code>]]} />
    </div> })} />;
}

function SkillsDrawer({ pid, skills, onClose }: { pid: string; skills: ProjectSkill[]; onClose(): void }) {
  const { state: st } = useTalents();
  // A skill Talents wrote a new version of shows that version (Teams takes it up from the shared directory).
  const written = (s: ProjectSkill) => currentSkill(st, pid, s.id)?.written ?? null;
  return <ListDrawer<ProjectSkill> title="项目 Skill" items={skills} onClose={onClose}
    search={(s, q) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)}
    columns={[
      { title: '名称', width: 220, render: (_, s) => <code>{s.name}</code> },
      { title: '版本', width: 130, render: (_, s) => written(s) ? <>{written(s)!.version} <Tag color="purple">Talents 改进</Tag></> : s.version },
      { title: '说明', dataIndex: 'description', ellipsis: true },
    ]}
    detail={s => ({ title: s.name, body: <SkillDetail pid={pid} skill={s} written={written(s)} /> })} />;
}
function SkillDetail({ pid, skill, written }: { pid: string; skill: ProjectSkill; written: SkillVersion | null }) {
  const [text, setText] = useState<string | null>(null), [error, setError] = useState('');
  const writtenText = written?.files.find(f => f.path === 'SKILL.md')?.text;
  useEffect(() => { if (writtenText) setText(writtenText); else getSkill(pid, skill.id).then(s => setText(s.content), e => setError((e as Error).message)); }, [pid, skill.id, writtenText]);
  return <div className="form-body">
    <Fields rows={written ? [['版本', <>{written.version} <Tag color="purple">Talents 改进</Tag></>], ['基于', skill.version], ['说明', skill.description], ['改进', written.note + '，' + when(written.at)],
      ['修改的文件', written.files.map(f => f.path).join('、')]] : [['版本', skill.version], ['说明', skill.description], ['路径', <span className="path">{skill.path}</span>]]} />
    {error ? <p className="hint">{error}</p> : text === null ? <p className="ui-note">正在读取 SKILL.md…</p> : <article className="markdown"><Markdown text={text} /></article>}
  </div>;
}

// ---------- Details ----------
function projectField(st: TalentsState, s: Source): [string, ReactNode] {
  return ['所属', levelName(st, s.projectId ?? null)];
}

/** Checking a Teams document set compares the documents Teams lists now with the latest recorded version;
 *  a difference is recorded as a new version. Local directories are mock: their check finds no change. */
function check(s: Source): DocVersion | null {
  s.lastCheck = now();
  if (!s.fromTeams || s.type !== 'docs') return null;
  const files = sourceFiles(s), known = knownFiles(s);
  const added = files.filter(f => !known.includes(f)), removed = known.filter(f => !files.includes(f));
  if (!added.length && !removed.length) return null;
  const v: DocVersion = { at: s.lastCheck };
  if (added.length) v.added = added;
  if (removed.length) v.removed = removed;
  s.versions = [v, ...(s.versions ?? [])];
  return v;
}

function VersionList({ versions }: { versions: DocVersion[] }) {
  return <Collapse size="small" className="version-list" items={versions.map(v => {
    const c = { added: v.added ?? [], modified: v.modified ?? [], removed: v.removed ?? [] };
    return v.initial
      ? { key: v.at, label: <><b>{when(v.at)}</b> <span className="ui-note">首次检查，{v.initial} 个文件</span></>, children: v.files ? <ul className="file-lines">{v.files.map(f => <li key={f}>{f}</li>)}</ul> : null, collapsible: v.files ? undefined : 'disabled' as const }
      : { key: v.at, label: <><b>{when(v.at)}</b> <span>{changeCounts(c)}</span></>, children: <ul className="file-lines">
          {c.added.map(f => <li key={f}><FileMark kind="new" />{f}</li>)}{c.modified.map(f => <li key={f}><FileMark kind="mod" />{f}</li>)}{c.removed.map(f => <li key={f}><FileMark kind="del" />{f}</li>)}
        </ul> };
  })} />;
}

const FILE_ROWS = 10;
function DocsDetail({ st, s, checking, onCheck }: { st: TalentsState; s: Source; checking: boolean; onCheck(): void }) {
  const [all, setAll] = useState(false);
  const versions = s.versions ?? [], latest = versions[0] ?? {}, first = versions.length ? versions[versions.length - 1].at : '', titles = s.titles ?? {};
  // When each file last changed: the newest version that added or modified it, otherwise the first version.
  const changedAt: Record<string, string> = {};
  versions.forEach(v => [...(v.added ?? []), ...(v.modified ?? [])].forEach(f => { changedAt[f] ??= v.at; }));
  const files = (s.tree ?? []).flatMap(g => g.files.map(f => ({ name: f, dir: g.dir || '根目录', key: (g.dir ? g.dir + '/' : '') + f })));
  const from = !s.from ? null : s.from.kind === 'git' ? <>Git 仓库 <span className="path">{s.from.origin}</span>，分支 {s.from.branch}</>
    : s.from.kind === 'teams' ? 'iCode Teams 项目「' + s.from.project + '」的设计文档' : '共享目录';
  return <div className="form-body">
    {s.desc && <p>{s.desc}</p>}
    <Fields rows={[['路径', <span className="path">{s.path}</span>], !!from && ['来自', from], ['文件', s.files + ' 个'],
      ['最近检查', <>{when(s.lastCheck)} <Button type="link" size="small" loading={checking} onClick={onCheck}>检查更新</Button></>],
      versions.length > 0 && ['版本记录', <VersionList versions={versions} />],
      projectField(st, s)]} />
    <div className="field"><span className="label">文件</span>
      <Table size="small" pagination={false} rowKey="key" dataSource={all ? files : files.slice(0, FILE_ROWS)} columns={[
        { title: '文件名', render: (_, f) => <>{f.name}{latest.added?.includes(f.key) ? <FileMark kind="new" /> : latest.modified?.includes(f.key) ? <FileMark kind="mod" /> : null}{titles[f.key] && <div className="caption">{titles[f.key]}</div>}</> },
        { title: '所在目录', dataIndex: 'dir', className: 'ui-note', width: 160, ellipsis: { showTitle: true } },
        { title: '更新时间', className: 'ui-note nowrap', render: (_, f) => when(changedAt[f.key] ?? first) },
      ]} />
      {!all && files.length > FILE_ROWS && <Button type="link" size="small" onClick={() => setAll(true)}>显示其余 {files.length - FILE_ROWS} 个文件</Button>}
    </div>
  </div>;
}

function SourceDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { state: st, update, go, toast, teamsLink } = useTalents();
  const { modal } = App.useApp();
  const [checking, setChecking] = useState(false), [editing, setEditing] = useState(false);
  const s = source(st, id)!, local = !s.fromTeams;
  const runCheck = () => {
    setChecking(true);
    setTimeout(() => {
      const v = update(d => check(source(d, id)!));
      setChecking(false);
      toast(v ? '检查完成：发现变化（' + changeCounts({ added: v.added ?? [], modified: [], removed: v.removed ?? [] }) + '），已记录新版本' : '检查完成：文件没有变化');
    }, 900);
  };
  const remove = () => modal.confirm({
    title: '移除来源“' + s.name + '”？', content: '移除后不再出现在来源列表中，已生成的产物仍然保留。', okText: '移除', okButtonProps: { danger: true }, cancelText: '取消',
    onOk: () => {
      update(d => { d.sources = d.sources.filter(x => x.id !== id); });
      onClose(); toast('已移除');
    },
  });
  return <Drawer open width={560} onClose={onClose} title={<div><div className="caption">{(s.type === 'repo' ? '代码仓' : '文档集') + (local ? '，本地登记' : '，来自 iCode Teams')}</div>{s.name}</div>}
    extra={local && <Button onClick={() => setEditing(true)}>编辑</Button>}
    footer={<div className="drawer-foot">{local ? <Button danger onClick={remove}>移除来源</Button> : <Button href={teamsLink(s.projectId)} icon={<ExportOutlined />}>在 iCode Teams 中管理</Button>}
      <span className="spacer" /><Button onClick={() => { onClose(); go(levelHash(s.projectId ?? null, 'tasks', { new: '1', source: id })); }}>新建知识任务</Button></div>}>
    {s.type === 'repo'
      ? <div className="form-body">{s.desc && <p>{s.desc}</p>}<Fields rows={[['路径', <span className="path">{s.path}</span>], !!s.origin && ['远端', <span className="path">{s.origin}</span>], ['当前分支', s.branch],
          !!s.commit && ['最近提交', <><code>{s.commit.sha}</code> {s.commit.message}<div className="caption">{s.commit.time}</div></>], projectField(st, s)]} /></div>
      : <DocsDetail st={st} s={s} checking={checking} onCheck={runCheck} />}
    {editing && <EditSource s={s} onClose={() => setEditing(false)} />}
  </Drawer>;
}

function EditSource({ s, onClose }: { s: Source; onClose(): void }) {
  const { update, toast } = useTalents();
  const [form] = Form.useForm<{ name: string; desc: string }>();
  const save = (v: { name: string; desc?: string }) => {
    update(d => { const x = source(d, s.id)!; x.name = v.name.trim(); x.desc = (v.desc ?? '').trim(); });
    onClose(); toast('已保存');
  };
  return <Modal open title={<div><div className="caption">本地文档目录</div>编辑来源</div>} okText="保存" cancelText="取消" onOk={() => form.submit()} onCancel={onClose}>
    <Form form={form} layout="vertical" onFinish={save} initialValues={{ name: s.name, desc: s.desc ?? '' }}>
      <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请填写名称' }]}><Input /></Form.Item>
      <Form.Item name="desc" label="说明"><Input.TextArea rows={2} placeholder="一句话说明这个来源的内容" /></Form.Item>
    </Form>
  </Modal>;
}

// ---------- Register a local document directory ----------
interface Sample { path: string; files: number; ext: string; from: NonNullable<Source['from']>; tree: { dir: string; files: string[] }[] }
const samples: Sample[] = [
  { path: '/Volumes/team-share/carddemo/meeting-notes', files: 46, ext: 'md 46', from: { kind: 'shared' }, tree: [{ dir: '', files: ['2026-10-21 需求评审.md', '2026-10-14 架构评审.md', '2026-10-09 返现方案周会.md'] }] },
  { path: '~/work/carddemo/requirements', files: 31, ext: 'md 18、docx 9、pdf 4', from: { kind: 'git', origin: 'git@code.bank.local:carddemo/carddemo-requirements.git', branch: 'main' }, tree: [{ dir: '2026Q3', files: ['分期还款需求说明.docx', '额度调整需求说明.md'] }, { dir: '2026Q4', files: ['营销活动二期需求.md', '账单分期改造.md'] }] },
];
/** Registers a local document directory in the level (team or project) the user is in. */
function RegisterSource({ pid, onClose }: { pid: string | null; onClose(): void }) {
  const { state: st, update, toast } = useTalents();
  const [path, setPath] = useState(samples[0].path), [probing, setProbing] = useState(false), [probe, setProbe] = useState<Sample | null>(null);
  const [name, setName] = useState(''), [desc, setDesc] = useState('');
  const read = () => {
    if (!path.trim()) return;
    setProbing(true);
    setTimeout(() => {
      const base: Sample = structuredClone(samples.find(x => x.path === path.trim()) ?? samples[0]);
      base.path = path.trim();
      setProbe(base); setName(base.path.split('/').pop()!); setProbing(false);
    }, 700);
  };
  const submit = () => {
    const p = probe!, id = uid('s');
    const src: Source = { id, type: 'docs', name: name.trim() || p.path.split('/').pop()!, path: p.path, files: p.files, tree: p.tree,
      from: p.from, lastCheck: now(), versions: [{ at: now(), initial: p.files }], desc: desc.trim(), projectId: pid };
    update(d => { d.sources.push(src); });
    onClose(); toast('已登记“' + src.name + '”');
  };
  return <Drawer open width={520} title={<div><div className="caption">{levelName(st, pid)}</div>登记本地文档来源</div>} onClose={onClose}
    footer={<div className="drawer-foot"><span className="spacer" /><Button onClick={onClose}>取消</Button><Button type="primary" disabled={!probe} onClick={submit}>登记</Button></div>}>
    <div className="form-body">
      <div className="field"><span className="label"><span className="step">1</span>目录</span>
        <Space.Compact style={{ width: '100%' }}>
          <AutoComplete style={{ flex: 1 }} value={path} onChange={setPath} options={samples.map(x => ({ value: x.path }))} placeholder="选择或输入本地文档目录" />
          <Button loading={probing} onClick={read}>读取</Button>
        </Space.Compact>
        {probe && <div className="info-box"><Fields rows={[['来自', probe.from.kind === 'git' ? <>Git 仓库 <span className="path">{probe.from.origin}</span></> : '共享目录'],
          ['文件', probe.files + ' 个（' + probe.ext + '）'], ['示例', probe.tree[0].files.slice(0, 2).join('、')]]} /></div>}
      </div>
      {probe && <>
        <label className="field"><span className="label"><span className="step">2</span>名称</span><Input value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span className="label">说明</span><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话说明这个来源的内容" /></label>
      </>}
    </div>
  </Drawer>;
}
