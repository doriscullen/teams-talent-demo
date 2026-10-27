// 产物管理：一个层级（团队或项目）的待审阅、轨迹诊断和已发布列表，以及知识产物的审阅工作台（内容、与线上版本对比、发布）。
import { useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Radio, Segmented, Space } from 'antd';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import type { Artifact, Basis, TalentsState } from '../types.ts';
import { artifact, basisOf, capability, changesSince, levelName, levelSources, source, type Changes } from '../demo/model.ts';
import { now, versionLabel, when } from '../demo/format.ts';
import * as K from '../demo/knowledge.ts';
import { isDiagnosis, pendingCount } from '../demo/suggestions.ts';
import { ArtifactStatus, CapIcon, CardGrid, EmptyState, Fields, FileMark, ItemCard, Section } from '../components/ui.tsx';
import { DiffView, FileContent, FileList, IndexSummary, linkTarget } from '../components/files.tsx';
import type { Toolbar } from './level.tsx';

// ---------- List ----------
/** Published knowledge whose source changed after it was built; the capability must be able to update. */
function staleChanges(st: TalentsState, a: Artifact) {
  // The demo graph is a committed snapshot shown independently of workspace changes.
  if (a.id === 'a-cg-java') return null;
  if (a.draft || !capability(st, a.cap).update) return null;
  const c = changesSince(source(st, a.sources[0]), basisOf(a));
  return c && c.count ? c : null;
}
function StaleNote({ st, a, c }: { st: TalentsState; a: Artifact; c: Changes }) {
  const docs = source(st, a.sources[0])?.type === 'docs';
  return <div className="update-note"><b>{docs ? '提取后文档有变化' : '构建后代码有变化'}</b><span className="caption">{(docs ? versionLabel(c.from) + ' → ' + versionLabel(c.to) + '，' : '') + c.text}</span></div>;
}
function basisRow(st: TalentsState, a: Artifact, basis: Basis | null | undefined): [string, string] | null {
  const src = source(st, a.sources[0]);
  if (!basis || !src) return null;
  return ['基于', src.name + '，' + (basis.version ? versionLabel(basis.version) : '提交 ' + basis.commit)];
}

// Re-extract opens the task form prefilled from the task that built this artifact; it does not start a run.
const reExtractHash = (a: Artifact) => levelHash(a.projectId, 'tasks', { new: '1', from: a.id });

export function LevelReview({ pid, toolbar }: { pid: string | null; toolbar: Toolbar }) {
  const { state: st, go } = useTalents();
  const open = (a: Artifact) => go(levelHash(pid, 'review', { id: a.id }));
  const card = (a: Artifact) => {
    if (isDiagnosis(a)) return diagnosisCard(a);
    const cap = capability(st, a.cap), st_ = K.status(a), stale = staleChanges(st, a);
    const whenText = st_ === 'published' ? (a.published!.auto ? '自动发布于 ' : '发布于 ') + when(a.published!.at) : '生成于 ' + when(a.draft!.created);
    return <ItemCard key={a.id} icon={<CapIcon cap={cap} />} title={a.name} subtitle={cap.name} extra={<ArtifactStatus a={a} />} onClick={() => open(a)}
      caption={whenText} actions={<>{stale && <Button size="small" onClick={() => go(reExtractHash(a))}>重新提取</Button>}
        <Button size="small" type={st_ === 'published' ? 'default' : 'primary'} onClick={() => open(a)}>{st_ === 'published' ? '查看' : '审阅'}</Button></>}>
      <p className="ui-note">{a.desc}</p>{stale && <StaleNote st={st} a={a} c={stale} />}
    </ItemCard>;
  };
  // A diagnosis is not reviewed and published: its card tells how many suggestions wait to be applied.
  const diagnosisCard = (a: Artifact) => {
    const n = pendingCount(a);
    return <ItemCard key={a.id} icon={<CapIcon cap={capability(st, a.cap)} />} title={a.name} subtitle={capability(st, a.cap).name} extra={<ArtifactStatus a={a} />} onClick={() => open(a)}
      caption={'诊断于 ' + when(a.draft?.created)} actions={<Button size="small" type={n ? 'primary' : 'default'} onClick={() => open(a)}>{n ? '查看建议' : '查看'}</Button>}>
      <p className="ui-note">{a.desc}</p>
      {n > 0 && <div className="update-note"><b>{n} 条优化建议待应用</b><span className="caption">应用后写入项目 Skill 或 AGENTS.md 规则</span></div>}
    </ItemCard>;
  };
  const mine = st.artifacts.filter(a => a.projectId === pid), knowledge = mine.filter(a => !isDiagnosis(a)), diagnoses = mine.filter(isDiagnosis);
  const pending = knowledge.filter(a => a.draft), done = knowledge.filter(a => !a.draft);
  return <>
    {toolbar()}
    <Section title="待审阅" note={pending.length + ' 个'}>{pending.length ? <CardGrid>{pending.map(card)}</CardGrid> : mine.length === 0 && levelSources(st, pid).length === 0
      ? <EmptyState title="还没有产物">先登记来源，再创建知识任务生成产物。<Button type="link" onClick={() => go(levelHash(pid, 'sources'))}>登记来源</Button></EmptyState>
      : <EmptyState>没有需要审阅的产物</EmptyState>}</Section>
    {diagnoses.length > 0 && <Section title="轨迹诊断" note={diagnoses.length + ' 个'}><CardGrid>{diagnoses.map(card)}</CardGrid></Section>}
    {done.length > 0 && <Section title="已发布" note={done.length + ' 个'}><CardGrid>{done.map(card)}</CardGrid></Section>}
  </>;
}

// ---------- Workbench ----------
// The artifact is shown as it was produced; a new version of published knowledge can be compared with the
// version online. The admin publishes it as it is (there is no revising in this first version).
const isMd = (key: string) => /\.md$/.test(key);

export function Workbench({ id }: { id: string }) {
  const { state: st } = useTalents();
  const a = artifact(st, id);
  const which: K.Which = a?.draft ? 'current' : 'published';
  const [file, setFile] = useState(() => a && !K.isIndex(a) ? (K.files(a, which).find(f => !/index\.md$/.test(f)) ?? a.files?.[0] ?? null) : null);
  const [tab, setTab] = useState<'content' | 'diff'>('content');
  const [publishing, setPublishing] = useState(false);
  if (!a) return <EmptyState>找不到这个产物。<a href="#/projects">返回项目</a></EmptyState>;
  const cap = capability(st, a.cap), files = K.isIndex(a) ? [] : K.files(a, which);
  // Only a new version of published knowledge has something to compare with.
  const comparable = !!a.draft && !!a.published && !K.isIndex(a);
  const online = (key: string) => K.files(a, 'published').includes(key) ? K.text(a, 'published', key) : null;
  const mark = (key: string) => {
    if (!comparable || !isMd(key)) return null;
    const before = online(key);
    if (before == null) return <FileMark kind="new" />;
    return before !== K.text(a, 'current', key) ? <FileMark kind="mod" /> : null;
  };

  let main;
  if (K.isIndex(a)) main = <IndexSummary a={a} />;
  else if (!file) main = null;
  else if (tab === 'diff' && comparable) main = isMd(file) ? <div className="diff-wrap"><DiffView before={online(file)} after={K.text(a, 'current', file)} /></div>
    : <div className="index-summary"><p className="ui-note">这个文件不支持对比，请切换到“内容”查看。</p></div>;
  else main = <FileContent st={st} a={a} file={file} text={K.text(a, which, file)} />;

  return <div className="wb">
    <PageHeader title={a.name} description={cap.name} actions={<Space><ArtifactStatus a={a} />{a.draft && <Button type="primary" onClick={() => setPublishing(true)}>发布</Button>}</Space>} />
    <div className={'wb-body' + (files.length ? '' : ' no-files')}>
      {files.length > 0 && <FileList current={file} onSelect={setFile} groups={K.fileGroups(a, files).map(g => ({ title: g.title, items: g.items.map(f => ({ key: f, indent: !!g.title, label: <>{K.fileLabel(f)}{mark(f)}</> })) }))} />}
      <section className="wb-main">
        {comparable && <div className="wb-toolbar">
          <Segmented value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'content', label: '内容' }, { value: 'diff', label: '与线上版本（v' + a.published!.version + '）对比' }]} />
        </div>}
        <div className="wb-view" key={file + tab} onClick={e => { const target = file && linkTarget(e, file); if (target && a.files?.includes(target)) setFile(target); }}>{main}</div>
      </section>
      <aside className="wb-side"><div className="side-body">
        {!a.draft ? <PublishedSide st={st} a={a} /> : <>
          <h3>{a.published ? '新版本待审阅' : '待审阅'}</h3>
          <Fields rows={[['生成于', when(a.draft.created)], basisRow(st, a, a.draft.basis), !!a.published && ['线上版本', 'v' + a.published.version + '，发布于 ' + when(a.published.at)]]} />
          <p className="ui-note">{K.isIndex(a) ? '索引确认后直接发布。发布后，之后的每次更新都会自动发布，不再需要审阅。'
            : '确认内容后发布，开发者就能在“项目知识”中看到并应用。' + (a.published ? '可以切换到“对比”查看与线上版本的差异。' : '')}</p>
        </>}
      </div></aside>
    </div>
    {publishing && <PublishDialog a={a} onClose={() => setPublishing(false)} />}
  </div>;
}

function PublishedSide({ st, a }: { st: TalentsState; a: Artifact }) {
  const { go } = useTalents();
  const p = a.published!, stale = staleChanges(st, a);
  return <><h3>已发布</h3>
    <Fields rows={[['版本', 'v' + p.version], ['发布于', p.at], ['发布到', levelName(st, a.projectId)], basisRow(st, a, p.basis), ['交付方式', K.deliveryLabel[p.delivery]],
      ['适用智能体', K.audienceText(st, p.agents)], ['更新说明', p.note]]} />
    {stale ? <><StaleNote st={st} a={a} c={stale} /><div className="actions"><Button onClick={() => go(reExtractHash(a))}>重新提取</Button></div></>
      : <p className="caption">{K.isIndex(a) ? '对应的知识任务运行后会自动发布新版本。' : '重新运行对应的知识任务后，新版本会出现在“待审阅”。'}</p>}
  </>;
}

/** Update note for re-extracted business knowledge: what changed in the documents since the published version. */
function docNote(st: TalentsState, a: Artifact) {
  const c = changesSince(source(st, a.sources[0]), a.published?.basis);
  return c && c.count ? '根据文档变化更新：' + c.text : '更新业务知识';
}
interface PublishValues { delivery: 'local' | 'cloud'; audience: 'all' | 'some'; agents?: string[]; note: string }
function PublishDialog({ a, onClose }: { a: Artifact; onClose(): void }) {
  const { state: st, update, toast } = useTalents();
  const [busy, setBusy] = useState(false);
  const index = K.isIndex(a), draft = a.draft!;
  const notes = [...new Set(draft.revisions.map(r => r.summary ?? '修订「' + K.fileLabel(r.file) + '」'))];
  const published = a.published;
  const defNote = published ? (a.folder === 'miner' && (a.specs ?? []).length > (published.specs ?? []).length
    ? '新增范式「' + (a.specs ?? []).filter(n => !(published.specs ?? []).includes(n)).join('」「') + '」'
    : a.cap === 'doc-extract' ? docNote(st, a) + (notes.length ? '；' + notes.join('；') : '') : '更新内容') : '首次发布';
  const where = levelName(st, a.projectId);
  // Agents: as last published; indexes are queried by the Code Agent unless the admin says otherwise.
  const agents = published ? published.agents : index ? ['Code'] : undefined;
  const [form] = Form.useForm<PublishValues>();
  const audience = Form.useWatch('audience', form);
  const submit = (v: PublishValues) => {
    setBusy(true);
    setTimeout(() => {
      const version = update(d => {
        const x = artifact(d, a.id)!, revs = x.draft!.revisions;
        const over: Record<string, { text: string }> = {};
        (x.files ?? []).forEach(key => { if (revs.some(r => r.file === key)) over[key] = { text: K.text(x, 'current', key) ?? '' }; });
        x.published = { version: (x.published?.version ?? 0) + 1, at: now(), note: v.note.trim() || '更新内容', delivery: v.delivery,
          ...(v.audience === 'some' ? { agents: st.agents.map(g => g.id).filter(id => v.agents!.includes(id)) } : {}), files: (x.files ?? []).slice(), specs: x.specs?.slice(), over, basis: x.draft!.basis ?? null };
        x.draft = null;
        return x.published.version;
      });
      onClose(); toast('已发布 v' + version + ' 到' + where);
    }, 800);
  };
  return <Modal open title={<div><div className="caption">{a.name}</div>发布到{where}</div>} okText="发布" cancelText="取消" confirmLoading={busy} onOk={() => form.submit()} onCancel={onClose}>
    <p className="caption">{a.projectId ? '项目成员可以在开发者端看到并应用。' : '团队知识在每个项目中都可用，所有成员都可以在开发者端看到并应用。'}</p>
    <Form form={form} layout="vertical" onFinish={submit} initialValues={{ delivery: published ? published.delivery : index ? 'cloud' : 'local', audience: agents ? 'some' : 'all', agents: agents ?? [], note: defNote }}>
      <Form.Item name="delivery" label="交付方式">
        <Radio.Group className="option-list">
          <Radio value="local" disabled={index}><b>同步到本地</b><span className="caption">{index ? '索引需要在线查询，不能同步到本地' : '适合小而常用的知识，开发者本机保存一份'}</span></Radio>
          <Radio value="cloud"><b>云端查询</b><span className="caption">适合大而常变的知识，开发者的 iCode 在线查询</span></Radio>
        </Radio.Group>
      </Form.Item>
      <Form.Item name="audience" label="适用智能体" extra={audience === 'some' ? undefined : '开发者一键应用时，默认应用到这些智能体。'}>
        <Radio.Group options={[{ value: 'all', label: '全部智能体' }, { value: 'some', label: '指定智能体' }]} />
      </Form.Item>
      {audience === 'some' && <Form.Item name="agents" extra="开发者一键应用时，默认应用到这些智能体。" rules={[{ required: true, message: '请至少选择一个智能体' }]}>
        <Checkbox.Group options={st.agents.map(g => ({ value: g.id, label: g.name }))} />
      </Form.Item>}
      <Form.Item name="note" label="更新说明" extra="开发者更新时会看到这段说明。"><Input.TextArea rows={2} /></Form.Item>
    </Form>
  </Modal>;
}
