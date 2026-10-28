// 产物管理：一个层级（团队或项目）的待审阅、轨迹诊断和已有产物列表，以及知识产物的审阅工作台（内容、与上次版本对比、提交 PR）。
import { useState } from 'react';
import { Button, Segmented, Space } from 'antd';
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

export function LevelReview({ pid, toolbar }: { pid: string | null; toolbar: Toolbar }) {
  const { state: st, go } = useTalents();
  const open = (a: Artifact) => go(levelHash(pid, 'review', { id: a.id }));
  const card = (a: Artifact) => {
    if (isDiagnosis(a)) return diagnosisCard(a);
    const cap = capability(st, a.cap), st_ = K.status(a), stale = staleChanges(st, a);
    const whenText = st_ === 'published' ? (K.isIndex(a) ? '索引更新于 ' : a.submission ? '提交于 ' : '生成于 ') + when(a.published!.at) : '生成于 ' + when(a.draft!.created);
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
      {n > 0 && <div className="update-note"><b>{n} 条优化建议待提交</b><span className="caption">提交对项目 Skill 或 AGENTS.md 的改进 PR</span></div>}
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
    {done.length > 0 && <Section title="已有产物" note={done.length + ' 个'}><CardGrid>{done.map(card)}</CardGrid></Section>}
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
          <p className="ui-note">{K.isIndex(a) ? '索引保留在远端，配置 MCP 后可在线查询。'
            : '确认内容后自动创建 PR，由开发者审阅并合入代码仓。' + (a.published ? '可以切换到“对比”查看与上次版本的差异。' : '')}</p>
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
    <p className="caption">{K.isIndex(a) ? '索引位于远端，可通过 MCP 查询。' : '知识变更通过 PR 提交到代码仓，审阅和合入在代码托管平台完成。'}</p>
    {stale ? <><StaleNote st={st} a={a} c={stale} /><div className="actions"><Button onClick={() => go(reExtractHash(a))}>重新提取</Button></div></>
      : <p className="caption">{K.isIndex(a) ? '对应的知识任务运行后会更新远端索引。' : '重新运行对应的知识任务后，新版本会出现在“待审阅”。'}</p>}
  </>;
}
