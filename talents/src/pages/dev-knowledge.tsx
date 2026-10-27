// 开发者端 · 项目知识：所选项目已发布的知识，以及在每个项目中都可用的团队知识；一键应用、更新。
import { useEffect, useState, type ReactNode } from 'react';
import { App, Button, Checkbox, Collapse, Dropdown, Modal, Radio, Segmented, Space, Tag } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import type { Artifact, Scope, TalentsState } from '../types.ts';
import { artifact, capability, project } from '../demo/model.ts';
import { now } from '../demo/format.ts';
import * as K from '../demo/knowledge.ts';
import { CapIcon, CardGrid, EmptyState, Fields, ItemCard, Section } from '../components/ui.tsx';
import { ArtifactPreview, ChangeList } from '../components/files.tsx';

/** Published knowledge of the project, and team-level knowledge, which every project uses. */
const visible = (st: TalentsState, pid: string) => st.artifacts.filter(a => a.published && (a.projectId === pid || a.projectId === null));
function applyState(st: TalentsState, a: Artifact) {
  const ap = st.dev.applied[a.id];
  if (!ap) return 'none';
  // Indexes are queried online, so an applied index always serves the latest version.
  if (K.isIndex(a)) return 'applied';
  return ap.version < a.published!.version ? 'update' : 'applied';
}

export function DevKnowledge() {
  const { state: st, route, go, update, toast, focusProject } = useTalents();
  const { modal } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null), [changes, setChanges] = useState<string | null>(null), [scoping, setScoping] = useState<string | null>(null);
  // ?project= (e.g. from a Teams link) picks the project; otherwise keep the last one shown.
  const [shown, setShown] = useState<string | null>(null);
  const pid = [route.params.project, shown, focusProject, st.projects[0]?.id].find(id => project(st, id)) ?? null;
  useEffect(() => { if (pid) setShown(pid); }, [pid]);
  if (!pid) return <div className="page-stack"><PageHeader title="项目知识" /><EmptyState title="还没有加入项目">在 iCode Teams 中加入项目后，这里会显示团队发布的知识。</EmptyState></div>;

  const list = visible(st, pid);
  const pending = list.filter(a => applyState(st, a) === 'none').length, updates = list.filter(a => applyState(st, a) === 'update').length;
  const later = (key: string, ms: number, work: () => void) => { setBusy(key); setTimeout(() => { work(); setBusy(null); }, ms); };
  const apply = (id: string) => later(id, 600, () => {
    const scope = update(d => { const a = artifact(d, id)!; d.dev.applied[id] = { version: a.published!.version, scope: K.defaultScope(d, a), at: now() }; return d.dev.applied[id].scope; });
    toast('已应用，范围：' + K.scopeText(st, scope));
  });
  const upgrade = (id: string) => later(id, 600, () => { update(d => { d.dev.applied[id].version = artifact(d, id)!.published!.version; }); toast('已更新到最新版本'); });
  const applyAll = () => later('apply-all', 800, () => {
    const n = update(d => visible(d, pid).filter(a => applyState(d, a) === 'none').map(a => { d.dev.applied[a.id] = { version: a.published!.version, scope: K.defaultScope(d, a), at: now() }; }).length);
    toast('已应用 ' + n + ' 项知识');
  });
  const updateAll = () => later('update-all', 800, () => {
    const n = update(d => visible(d, pid).filter(a => applyState(d, a) === 'update').map(a => { d.dev.applied[a.id].version = a.published!.version; }).length);
    toast('已更新 ' + n + ' 项知识');
  });
  const revoke = (a: Artifact) => modal.confirm({
    title: '撤销应用？', content: '撤销后，本机 iCode 不再使用「' + a.name + '」。', okText: '撤销', okButtonProps: { danger: true }, cancelText: '取消',
    onOk: () => { update(d => { delete d.dev.applied[a.id]; }); toast('已撤销'); },
  });

  const card = (a: Artifact) => {
    const state = applyState(st, a), ap = st.dev.applied[a.id], cap = capability(st, a.cap);
    return <ItemCard key={a.id} icon={<CapIcon cap={cap} />} title={a.name}
      extra={state === 'none' ? <Tag>未应用</Tag> : state === 'update' ? <Tag color="warning">有更新</Tag> : <Tag color="success">已应用</Tag>}
      caption={ap && <>范围：{K.scopeText(st, ap.scope)} <a onClick={() => setChanges(a.id)}>查看改动</a></>}
      actions={<>
        <Button size="small" type="link" onClick={() => setPreview(a.id)}>预览</Button>
        {state === 'none' && <Button size="small" type="primary" loading={busy === a.id} onClick={() => apply(a.id)}>应用</Button>}
        {state === 'update' && <Button size="small" type="primary" loading={busy === a.id} onClick={() => upgrade(a.id)}>更新</Button>}
        {ap && <Dropdown trigger={['click']} menu={{ items: [{ key: 'scope', label: '修改范围', onClick: () => setScoping(a.id) }, { key: 'revoke', label: '撤销应用', onClick: () => revoke(a) }] }}>
          <Button size="small" type="text" aria-label="更多" icon={<EllipsisOutlined />} /></Dropdown>}
      </>}>
      <p className="ui-note">{a.desc}</p>
      {a.published!.agents && <Fields rows={[['适用', K.audienceText(st, a.published!.agents)]]} />}
      {state === 'update' && <div className="update-note"><span className="caption">更新说明</span>{a.published!.note}</div>}
    </ItemCard>;
  };
  const team = list.filter(a => a.projectId === null), own = list.filter(a => a.projectId === pid);
  const sections = [
    team.length > 0 && <Section key="team" title="团队知识" note="全团队通用，在每个项目中都可用"><CardGrid>{team.map(card)}</CardGrid></Section>,
    ...st.categories.map(cat => {
      const items = own.filter(a => capability(st, a.cap).cat === cat.id);
      return items.length > 0 && <Section key={cat.id} title={cat.name} note={cat.desc}><CardGrid>{items.map(card)}</CardGrid></Section>;
    }),
  ].filter(Boolean);
  const previewed = artifact(st, preview), changed = artifact(st, changes), scoped = artifact(st, scoping);
  return <div className="page-stack">
    <PageHeader title="项目知识" description="管理员已发布的项目知识和团队知识。应用后，本机的 iCode 就能用上。" actions={<Space>
      {updates > 0 && <Button loading={busy === 'update-all'} onClick={updateAll}>全部更新（{updates}）</Button>}
      {pending > 0 && <Button type="primary" loading={busy === 'apply-all'} onClick={applyAll}>全部应用（{pending}）</Button>}
    </Space>} />
    <Segmented aria-label="项目" className="self-start" value={pid} onChange={v => go('#/knowledge?project=' + encodeURIComponent(v as string))} options={st.projects.map(p => ({ value: p.id, label: p.name }))} />
    {sections.length ? sections : <EmptyState>这个项目还没有发布的知识</EmptyState>}
    {previewed && <ArtifactPreview st={st} a={previewed} onClose={() => setPreview(null)} />}
    {changed && st.dev.applied[changed.id] && <Modal open footer={null} width={760} onCancel={() => setChanges(null)} title={<div><div className="caption">{changed.name}</div>应用到本机 iCode 的改动</div>}>
      <div className="form-body"><div className="apply-summary">{K.sentence(st, changed, st.dev.applied[changed.id].scope)}</div>
        <ChangeList changes={K.changes(st, changed, st.dev.applied[changed.id].scope)} /></div>
    </Modal>}
    {scoped && st.dev.applied[scoped.id] && <ScopeDialog a={scoped} onClose={() => setScoping(null)} />}
  </div>;
}

function ScopeDialog({ a, onClose }: { a: Artifact; onClose(): void }) {
  const { state: st, update, toast } = useTalents();
  const current = st.dev.applied[a.id].scope;
  const [kind, setKind] = useState<Scope['kind']>(current.kind);
  const [repos, setRepos] = useState(current.kind === 'repo' ? current.repos : K.localRepos(st, a).map(r => r.repo!));
  const [agents, setAgents] = useState(current.kind === 'agent' ? current.agents : a.published?.agents ?? ['Code']);
  const [dir, setDir] = useState<'chrys' | 'agents'>(current.kind === 'global' ? current.dir : 'chrys');
  const reasons = K.scopeOptions(st, a);
  const scope: Scope = kind === 'repo' ? { kind, repos } : kind === 'global' ? { kind, dir } : { kind, agents };
  const valid = kind === 'repo' ? repos.length > 0 : kind === 'agent' ? agents.length > 0 : true;
  const option = (id: Scope['kind'], title: string, desc: string, extra: ReactNode) =>
    <Radio value={id} disabled={!!reasons[id]}><b>{title}</b><span className="caption">{reasons[id] || desc}</span>{kind === id && !reasons[id] && <div className="sub-options" onClick={e => e.stopPropagation()}>{extra}</div>}</Radio>;
  return <Modal open title={<div><div className="caption">{a.name}</div>修改范围</div>} okText="保存" cancelText="取消" okButtonProps={{ disabled: !valid }} onCancel={onClose}
    onOk={() => { update(d => { d.dev.applied[a.id].scope = scope; }); onClose(); toast('范围：' + K.scopeText(st, scope)); }}>
    <div className="form-body">
      <Radio.Group className="option-list" value={kind} onChange={e => setKind(e.target.value)}>
        {option('repo', '本项目代码仓', '在本机的这些代码仓中工作时生效',
          <Checkbox.Group value={repos} onChange={v => setRepos(v as string[])} options={K.localRepos(st, a).map(l => ({ value: l.repo!, label: <>{l.name} <span className="caption">{l.path}</span></> }))} />)}
        {option('global', '所有智能体', '在任何目录中工作时都生效',
          <Radio.Group value={dir} onChange={e => setDir(e.target.value)} options={[{ value: 'chrys', label: 'iCode 用户目录' }, { value: 'agents', label: '与其他工具共享的目录' }]} />)}
        {option('agent', '指定智能体', '只对所选智能体生效',
          <Checkbox.Group value={agents} onChange={v => setAgents(v as string[])} options={st.agents.map(g => ({ value: g.id, label: g.name }))} />)}
      </Radio.Group>
      {valid ? <>
        <div className="apply-summary">{K.sentence(st, a, scope)}</div>
        {kind === 'repo' && K.kind(a) !== 'mcp' && <p className="caption">需在 iCode 设置中开启“加载项目 Skills”。</p>}
        <Collapse size="small" items={[{ key: 'c', label: '查看具体改动', children: <ChangeList changes={K.changes(st, a, scope)} /> }]} />
      </> : <p className="hint">请至少选择一项。</p>}
    </div>
  </Modal>;
}
