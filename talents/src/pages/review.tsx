// 产物管理：一个层级（团队或项目）的产物列表（需要处理的在前，其余按能力分类分组，多的折叠），以及知识产物的审阅工作台（内容、与上次版本对比、提交 PR）。
import { useState } from 'react';
import { Button, Segmented, Space, Tag, Tooltip } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import type { Artifact, Basis, TalentsState } from '../types.ts';
import { artifact, basisOf, capability, changesSince, levelSources, source, type Changes } from '../demo/model.ts';
import { versionLabel, when } from '../demo/format.ts';
import * as K from '../demo/knowledge.ts';
import { isDiagnosis, pendingCount } from '../demo/suggestions.ts';
import { ArtifactStatus, CapIcon, CardGrid, EmptyState, Fields, FileMark, ItemCard, Section } from '../components/ui.tsx';
import { DiffView, FileContent, FileList, IndexSummary, linkTarget } from '../components/files.tsx';
import { SubmitDialog, SubmissionLink } from '../components/submit-pr.tsx';
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

/** Groups longer than this show their first cards and fold the rest. */
const FOLD = 6;
const sortTime = (a: Artifact) => a.draft?.created ?? a.published?.at ?? '';

export function LevelReview({ pid, toolbar }: { pid: string | null; toolbar: Toolbar }) {
  const { state: st, go } = useTalents();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const open = (a: Artifact) => go(levelHash(pid, 'review', { id: a.id }));
  // Needs the admin: a knowledge draft to review, or a diagnosis with suggestions to submit.
  const needsAction = (a: Artifact) => isDiagnosis(a) ? pendingCount(a) > 0 : !!a.draft;
  /** Cards say only what differs: a tag when something needs attention, the version and time in the footer. */
  const card = (a: Artifact, todo: boolean) => {
    const cap = capability(st, a.cap), diagnosis = isDiagnosis(a), n = diagnosis ? pendingCount(a) : 0, stale = !diagnosis && staleChanges(st, a);
    const docs = stale && source(st, a.sources[0])?.type === 'docs';
    const tag = todo ? (diagnosis ? <Tag color="warning">{n} 条建议待提交</Tag> : <ArtifactStatus a={a} />)
      : stale ? <Tooltip title={(docs ? versionLabel(stale.from) + ' → ' + versionLabel(stale.to) + '，' : '') + stale.text}><Tag color="warning">{docs ? '文档有变化' : '代码有变化'}</Tag></Tooltip> : null;
    const footer = (a.published && !a.draft ? 'v' + a.published.version + ' · ' : '') + when(sortTime(a));
    return <ItemCard key={a.id} icon={<CapIcon cap={cap} />} title={a.name} subtitle={todo ? cap.name : undefined} extra={tag} onClick={() => open(a)} caption={footer}
      actions={todo ? <Button size="small" type="primary" onClick={() => open(a)}>{diagnosis ? '查看建议' : '审阅'}</Button>
        : stale ? <Button size="small" onClick={() => go(reExtractHash(a))}>重新提取</Button> : undefined}>
      {a.desc && <p className="ui-note one-line" title={a.desc}>{a.desc}</p>}
    </ItemCard>;
  };
  const mine = st.artifacts.filter(a => a.projectId === pid).sort((a, b) => sortTime(a) < sortTime(b) ? 1 : -1);
  const todo = mine.filter(needsAction), rest = mine.filter(a => !needsAction(a));
  const groups = st.categories.map(cat => ({ cat, items: rest.filter(a => capability(st, a.cap)?.cat === cat.id) })).filter(g => g.items.length);
  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <>
    {toolbar()}
    {!mine.length && <EmptyState title="还没有产物">{levelSources(st, pid).length === 0 && <Button type="link" onClick={() => go(levelHash(pid, 'sources'))}>登记来源</Button>}</EmptyState>}
    {todo.length > 0 && <Section title={<span className="todo-title"><BellOutlined />需要处理</span>}><CardGrid>{todo.map(a => card(a, true))}</CardGrid></Section>}
    {groups.map(({ cat, items }) => {
      const all = expanded.has(cat.id), shown = all ? items : items.slice(0, FOLD);
      return <Section key={cat.id} title={cat.name} note={items.length}>
        <CardGrid>{shown.map(a => card(a, false))}</CardGrid>
        {items.length > FOLD && <Button type="link" className="fold-toggle" onClick={() => toggle(cat.id)}>{all ? '收起' : '展开全部 ' + items.length + ' 个'}</Button>}
      </Section>;
    })}
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
    <PageHeader title={a.name} description={cap.name} actions={<Space><ArtifactStatus a={a} />{(a.draft || (a.kind === 'files' && !a.submission)) && <Button type="primary" onClick={() => setPublishing(true)}>{K.isIndex(a) ? '启用远端索引' : '提交 PR'}</Button>}</Space>} />
    <div className={'wb-body' + (files.length ? '' : ' no-files')}>
      {files.length > 0 && <FileList current={file} onSelect={setFile} groups={K.fileGroups(a, files).map(g => ({ title: g.title, items: g.items.map(f => ({ key: f, indent: !!g.title, label: <>{K.fileLabel(f)}{mark(f)}</> })) }))} />}
      <section className="wb-main">
        {comparable && <div className="wb-toolbar">
          <Segmented value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'content', label: '内容' }, { value: 'diff', label: '与上次版本（v' + a.published!.version + '）对比' }]} />
        </div>}
        <div className="wb-view" key={file + tab} onClick={e => { const target = file && linkTarget(e, file); if (target && a.files?.includes(target)) setFile(target); }}>{main}</div>
      </section>
      <aside className="wb-side"><div className="side-body">
        {!a.draft ? <PublishedSide st={st} a={a} /> : <>
          <h3>{a.published ? '新版本待审阅' : '待审阅'}</h3>
          <Fields rows={[['生成于', when(a.draft.created)], basisRow(st, a, a.draft.basis), !!a.published && ['上次版本', 'v' + a.published.version + '，生成于 ' + when(a.published.at)]]} />
        </>}
      </div></aside>
    </div>
    {publishing && <SubmitDialog a={a} onClose={() => setPublishing(false)} />}
  </div>;
}

function PublishedSide({ st, a }: { st: TalentsState; a: Artifact }) {
  const { go } = useTalents();
  const p = a.published!, stale = staleChanges(st, a);
  return <><h3>{K.isIndex(a) ? '远端索引' : a.submission ? 'PR 已创建' : '已有版本'}</h3>
    <Fields rows={[[ '版本', 'v' + p.version], ['生成于', p.at], basisRow(st, a, p.basis), ['更新说明', p.note]]} />
    {a.submission && <SubmissionLink submission={a.submission} />}
    {stale && <><StaleNote st={st} a={a} c={stale} /><div className="actions"><Button onClick={() => go(reExtractHash(a))}>重新提取</Button></div></>}
  </>;
}
