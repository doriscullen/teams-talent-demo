// 来源管理：项目、代码仓和设计文档来自 iCode Teams，在这里只读；Talents 只登记本地文档目录。
// 团队会话也由 iCode Teams 管理，只在新建任务选择会话时出现。
import { useState, type ReactNode } from 'react';
import { App, AutoComplete, Button, Collapse, Drawer, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { ExportOutlined, PlusOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import type { DocVersion, Project, Source, TalentsState } from '../types.ts';
import { changeCounts, knownFiles, latestVersion, levelName, levelSources, project, source, sourceFiles } from '../demo/model.ts';
import { now, uid, when } from '../demo/format.ts';
import { CardGrid, EmptyState, Fields, FileMark, ItemCard, Section, SourceIcon } from '../components/ui.tsx';

const fromText = (s: Source) => s.from ? { teams: '来自 iCode Teams', git: '来自 Git 仓库', shared: '来自共享目录' }[s.from.kind] : '';
const names = (list: Source[]) => list.length ? list.map(s => s.name).join('、') : <span className="ui-note">无</span>;

export function Sources() {
  const { state: st, route, go, teamsLink } = useTalents();
  const [open, setOpen] = useState<string | null>(null), [registering, setRegistering] = useState(false);
  const p = project(st, route.params.project);
  const teamsButton = (projectId: string | null, label = '在 iCode Teams 中管理') => <Button href={teamsLink(projectId)} icon={<ExportOutlined />}>{label}</Button>;
  const register = <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegistering(true)}>登记本地文档来源</Button>;
  const card = (s: Source, showType: boolean) => <ItemCard key={s.id} icon={<SourceIcon type={s.type} />} title={s.name} subtitle={<span className="path">{s.path}</span>} onClick={() => setOpen(s.id)}
    caption={<Space size={4}>{s.fromTeams ? <Tag>iCode Teams</Tag> : <Tag>本地登记</Tag>}{showType && <Tag>{s.type === 'repo' ? '代码仓' : '文档集'}</Tag>}</Space>}
    actions={<Button type="link" size="small" onClick={() => setOpen(s.id)}>详情</Button>}>
    {s.desc && <p>{s.desc}</p>}
    <Fields rows={s.type === 'repo' ? [['分支', s.branch]] : [['文件', s.files + ' 个' + (fromText(s) ? '，' + fromText(s) : '')], !!latestVersion(s) && ['最近变化', when(latestVersion(s))]]} />
  </ItemCard>;

  let body;
  if (p) {
    const list = levelSources(st, p.id);
    const section = (type: Source['type'], title: string, empty: string) => {
      const items = list.filter(s => s.type === type);
      return <Section title={title} note={items.length + ' 个'}>{items.length ? <CardGrid>{items.map(s => card(s, false))}</CardGrid> : <EmptyState>{empty}</EmptyState>}</Section>;
    };
    body = <>
      <PageHeader title={p.name} description={p.description} actions={<Space>{teamsButton(p.id)}{register}</Space>} />
      {section('repo', '代码仓', '这个 iCode Teams 项目还没有本机代码仓。')}
      {section('docs', '文档集', '还没有文档。设计文档在 iCode Teams 项目中添加，也可以登记本地文档目录。')}
    </>;
  } else {
    const team = levelSources(st, null);
    body = <>
      <PageHeader title="来源管理" description="项目、代码仓和设计文档来自 iCode Teams；还可以登记本地文档目录作为知识来源。" actions={<Space>{teamsButton(null, '在 iCode Teams 中管理项目')}{register}</Space>} />
      <Section title="项目" note={st.projects.length + ' 个，来自 iCode Teams'}>
        {st.projects.length ? <CardGrid>{st.projects.map(x => <ProjectCard key={x.id} st={st} p={x} onOpen={() => go('#/sources?project=' + encodeURIComponent(x.id))} />)}</CardGrid>
          : <EmptyState title="还没有项目">在 iCode Teams 中创建项目后，会出现在这里。</EmptyState>}
      </Section>
      <Section title="团队来源" note="用于团队级的知识任务">{team.length ? <CardGrid>{team.map(s => card(s, true))}</CardGrid>
        : <EmptyState>还没有团队级的来源。可以登记行内规范等全团队通用的本地文档目录。</EmptyState>}</Section>
    </>;
  }
  return <div className="page-stack">
    {body}
    {open && source(st, open) && <SourceDrawer id={open} onClose={() => setOpen(null)} />}
    {registering && <RegisterSource defaultProject={p?.id ?? null} onClose={() => setRegistering(false)} />}
  </div>;
}

function ProjectCard({ st, p, onOpen }: { st: TalentsState; p: Project; onOpen(): void }) {
  const list = levelSources(st, p.id);
  return <ItemCard icon={<SourceIcon type="project" />} title={p.name} subtitle={p.description} onClick={onOpen} actions={<Button type="link" size="small" onClick={onOpen}>查看</Button>}>
    <Fields rows={[['代码仓', names(list.filter(s => s.type === 'repo'))], ['文档集', names(list.filter(s => s.type === 'docs'))]]} />
  </ItemCard>;
}

// ---------- Details ----------
function projectField(st: TalentsState, s: Source): [string, ReactNode] {
  return ['所属', levelName(st, s.projectId ?? null)];
}
const teamsNote = (s: Source) => s.fromTeams && <p className="caption">来自 iCode Teams，在 Talents 中只读；增删或修改请在 iCode Teams 中进行。</p>;

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
      versions.length > 0 && ['版本记录', <><VersionList versions={versions} /><span className="caption">检查发现文件有变化时记录一个版本。</span></>],
      projectField(st, s)]} />
    {teamsNote(s)}
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
      <span className="spacer" /><Button onClick={() => { onClose(); go('#/tasks?new=1&source=' + encodeURIComponent(id)); }}>新建知识任务</Button></div>}>
    {s.type === 'repo'
      ? <div className="form-body">{s.desc && <p>{s.desc}</p>}<Fields rows={[['路径', <span className="path">{s.path}</span>], !!s.origin && ['远端', <span className="path">{s.origin}</span>], ['当前分支', s.branch],
          !!s.commit && ['最近提交', <><code>{s.commit.sha}</code> {s.commit.message}<div className="caption">{s.commit.time}</div></>], projectField(st, s)]} />{teamsNote(s)}</div>
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
      <Form.Item name="desc" label={<>说明 <span className="caption">可选</span></>}><Input.TextArea rows={2} placeholder="一句话说明这个来源的内容" /></Form.Item>
    </Form>
  </Modal>;
}

// ---------- Register a local document directory ----------
interface Sample { path: string; files: number; ext: string; from: NonNullable<Source['from']>; tree: { dir: string; files: string[] }[] }
const samples: Sample[] = [
  { path: '/Volumes/team-share/carddemo/meeting-notes', files: 46, ext: 'md 46', from: { kind: 'shared' }, tree: [{ dir: '', files: ['2026-10-21 需求评审.md', '2026-10-14 架构评审.md', '2026-10-09 返现方案周会.md'] }] },
  { path: '~/work/carddemo/requirements', files: 31, ext: 'md 18、docx 9、pdf 4', from: { kind: 'git', origin: 'git@code.bank.local:carddemo/carddemo-requirements.git', branch: 'main' }, tree: [{ dir: '2026Q3', files: ['分期还款需求说明.docx', '额度调整需求说明.md'] }, { dir: '2026Q4', files: ['营销活动二期需求.md', '账单分期改造.md'] }] },
];
function RegisterSource({ defaultProject, onClose }: { defaultProject: string | null; onClose(): void }) {
  const { state: st, update, toast } = useTalents();
  const [path, setPath] = useState(samples[0].path), [probing, setProbing] = useState(false), [probe, setProbe] = useState<Sample | null>(null);
  const [name, setName] = useState(''), [desc, setDesc] = useState('');
  const [level, setLevel] = useState<string | null>(defaultProject);
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
      from: p.from, lastCheck: now(), versions: [{ at: now(), initial: p.files }], desc: desc.trim(), projectId: level };
    update(d => { d.sources.push(src); });
    onClose(); toast('已登记“' + src.name + '”');
  };
  return <Drawer open width={520} title="登记本地文档来源" onClose={onClose}
    footer={<div className="drawer-foot"><span className="spacer" /><Button onClick={onClose}>取消</Button><Button type="primary" disabled={!probe} onClick={submit}>登记</Button></div>}>
    <div className="form-body">
      <p className="caption">代码仓和设计文档来自 iCode Teams 项目。这里登记 Talents 自己读取的本地或共享文档目录，例如行内规范、会议纪要。</p>
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
        <label className="field"><span className="label">说明 <span className="caption">可选</span></span><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话说明这个来源的内容" /></label>
        <div className="field"><span className="label"><span className="step">3</span>所属</span><Select value={level ?? ''} onChange={v => setLevel(v || null)} options={[{ value: '', label: '团队' }, ...st.projects.map(p => ({ value: p.id, label: p.name }))]} /></div>
      </>}
    </div>
  </Drawer>;
}
