// 产物审阅：一个层级（团队或项目）的待审阅 / 已发布列表，以及整页的审阅工作台（内容、对比、对话修订、手动编辑、发布）。
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Radio, Segmented, Select, Space } from 'antd';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import type { Artifact, Basis, TalentsState } from '../types.ts';
import { artifact, basisOf, capability, changesSince, levelName, source, task, type Changes } from '../demo/model.ts';
import { hashId, now, versionLabel, when } from '../demo/format.ts';
import * as K from '../demo/knowledge.ts';
import { ArtifactStatus, CapIcon, CardGrid, EmptyState, Fields, FileMark, ItemCard, Section } from '../components/ui.tsx';
import { DiffView, FileContent, FileList, IndexSummary, linkTarget } from '../components/files.tsx';
import type { Toolbar } from './level.tsx';

// ---------- List ----------
/** Published knowledge whose source changed after it was built; the capability must be able to update. */
function staleChanges(st: TalentsState, a: Artifact) {
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
    const cap = capability(st, a.cap), st_ = K.status(a), stale = staleChanges(st, a);
    const whenText = st_ === 'published' ? (a.published!.auto ? '自动发布于 ' : '发布于 ') + when(a.published!.at) : '生成于 ' + when(a.draft!.created);
    return <ItemCard key={a.id} icon={<CapIcon cap={cap} />} title={a.name} subtitle={cap.name} extra={<ArtifactStatus a={a} />} onClick={() => open(a)}
      caption={whenText} actions={<>{stale && <Button size="small" onClick={() => go(reExtractHash(a))}>重新提取</Button>}
        <Button size="small" type={st_ === 'published' ? 'default' : 'primary'} onClick={() => open(a)}>{st_ === 'published' ? '查看' : '审阅'}</Button></>}>
      <p className="ui-note">{a.desc}</p>{stale && <StaleNote st={st} a={a} c={stale} />}
    </ItemCard>;
  };
  const mine = st.artifacts.filter(a => a.projectId === pid), pending = mine.filter(a => a.draft), done = mine.filter(a => !a.draft);
  return <>
    {toolbar()}
    <Section title="待审阅" note={pending.length + ' 个'}>{pending.length ? <CardGrid>{pending.map(card)}</CardGrid> : <EmptyState>没有需要审阅的产物</EmptyState>}</Section>
    {done.length > 0 && <Section title="已发布" note={done.length + ' 个'}><CardGrid>{done.map(card)}</CardGrid></Section>}
  </>;
}

// ---------- Workbench ----------
const CHAT_SCRIPTS = [
  { file: /业务规则目录/, match: /BR-CASH-02|期间|边界|包含|不含/,
    prompt: 'BR-CASH-02 的期间边界不对，请对照 cashback-contract.md 改成开始含、结束不含',
    edit: (text: string) => text.split('\n').map(l => l.startsWith('| BR-CASH-02 |')
      ? l.replace(/2026-11-01 00:00:00 \+08:00 至 2027-02-01 00:00:00 \+08:00（两端均包含）/, '2026-11-01 00:00:00 +08:00（含）至 2027-02-01 00:00:00 +08:00（不含）') : l).join('\n'),
    summary: '修正 BR-CASH-02 的期间边界',
    reply: '已对照 cashback-contract.md 修正 BR-CASH-02：消费期间改为 2026-11-01 00:00（含）至 2027-02-01 00:00（不含），与 Campaign.isActiveAt() 的 [startAt, endAt) 判定一致。其他规则没有改动。' },
  { file: /改进建议/, match: /判定链|第 ?3 ?条|绝对|确认/,
    prompt: '第 3 条规则太绝对，改成“沿用参考实现的判定链前，须逐条对照新需求并经人确认”',
    edit: (text: string) => text.replace(/^3\.\s+\*\*[^*]+\*\*/m, '3. **沿用参考实现的判定链前，须逐条对照新需求并经人确认。**'),
    summary: '放宽第 3 条经验规则',
    reply: '已改写第 3 条规则：允许沿用参考实现的资格判定链，但要求先逐条对照新需求，并经人确认。' },
];
const scriptsFor = (file: string) => CHAT_SCRIPTS.filter(s => s.file.test(file));
const isMd = (key: string) => /\.md$/.test(key);
interface Message { who: 'me' | 'icode' | 'busy'; text: string }

export function Workbench({ id }: { id: string }) {
  const { state: st, update, toast } = useTalents();
  const a = artifact(st, id);
  const which: K.Which = a?.draft ? 'current' : 'published';
  const [file, setFile] = useState(() => a && !K.isIndex(a) ? (K.files(a, which).find(f => !/index\.md$/.test(f)) ?? a.files?.[0] ?? null) : null);
  const [tab, setTab] = useState<'content' | 'diff'>('content');
  const [base, setBase] = useState<'published' | 'original'>(a?.published && a.draft ? 'published' : 'original');
  const [side, setSide] = useState<'chat' | 'edit'>('chat');
  const [chat, setChat] = useState<Message[]>([]), [say, setSay] = useState(''), [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const chatBox = useRef<HTMLDivElement>(null);
  useEffect(() => { chatBox.current?.scrollTo(0, chatBox.current.scrollHeight); }, [chat]);
  if (!a) return <EmptyState>找不到这个产物。<a href="#/projects">返回项目</a></EmptyState>;
  const cap = capability(st, a.cap), files = K.isIndex(a) ? [] : K.files(a, which);

  const baseText = (key: string) => base === 'published' && !K.files(a, 'published').includes(key) ? null : K.text(a, base, key);
  const mark = (key: string) => {
    if (!a.draft || !isMd(key)) return null;
    const before = baseText(key);
    if (before == null) return <FileMark kind="new" />;
    return before !== K.text(a, 'current', key) ? <FileMark kind="mod" /> : null;
  };
  const send = (text: string) => {
    text = text.trim();
    if (!text || busy || !file) return;
    setChat(c => [...c, { who: 'me', text }, { who: 'busy', text: 'iCode 正在修改…' }]); setSay(''); setBusy(true);
    setTimeout(() => {
      const key = file, script = scriptsFor(key).find(s => s.match.test(text));
      const before = K.text(a, 'current', key) ?? '';
      let after: string | null = null, reply: string, summary: string | undefined;
      if (!isMd(key)) reply = '这个文件是报告，不直接修改。可以切换到“改进建议”或其他文档后再提修改要求。';
      else if (script) { after = script.edit(before); reply = script.reply; summary = script.summary; }
      else {
        const lines = before.split('\n'), at = lines.findIndex(l => /^#\s/.test(l));
        lines.splice(at + 1, 0, '', '> 审阅修订：' + text);
        after = lines.join('\n');
        reply = '已按要求修改「' + K.fileLabel(key) + '」，在开头补充了说明。可以在“对比”中查看改动。';
      }
      if (after != null && after !== before) {
        update(d => { artifact(d, id)!.draft!.revisions.push({ kind: 'chat', file: key, text: after!, prompt: text, summary: summary ?? '按审阅意见修订「' + K.fileLabel(key) + '」', at: now() }); });
        setTab('diff');
        if (!a.published) setBase('original');
      }
      setChat(c => [...c.filter(m => m.who !== 'busy'), { who: 'icode', text: reply }]); setBusy(false);
    }, 1600);
  };

  let main;
  if (K.isIndex(a)) main = <IndexSummary a={a} />;
  else if (!file) main = null;
  else if (tab === 'diff' && a.draft) main = isMd(file) ? <div className="diff-wrap"><DiffView before={baseText(file)} after={K.text(a, 'current', file)} /></div>
    : <div className="index-summary"><p className="ui-note">这个文件不支持对比，请切换到“内容”查看。</p></div>;
  else main = <FileContent st={st} a={a} file={file} text={K.text(a, which, file)} />;

  return <div className="wb">
    <PageHeader title={a.name} description={cap.name} actions={<Space><ArtifactStatus a={a} />{a.draft && <Button type="primary" onClick={() => setPublishing(true)}>发布</Button>}</Space>} />
    <div className={'wb-body' + (files.length ? '' : ' no-files')}>
      {files.length > 0 && <FileList current={file} onSelect={setFile} groups={K.fileGroups(a, files).map(g => ({ title: g.title, items: g.items.map(f => ({ key: f, indent: !!g.title, label: <>{K.fileLabel(f)}{mark(f)}</> })) }))} />}
      <section className="wb-main">
        {a.draft && !K.isIndex(a) && <div className="wb-toolbar">
          <Segmented value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'content', label: '内容' }, { value: 'diff', label: '对比' }]} />
          {tab === 'diff' && <Select value={base} onChange={setBase} popupMatchSelectWidth={false} options={[...(a.published ? [{ value: 'published' as const, label: '与线上版本（v' + a.published.version + '）对比' }] : []), { value: 'original' as const, label: '与原始产物对比' }]} />}
        </div>}
        <div className="wb-view" key={file + tab} onClick={e => { const target = file && linkTarget(e, file); if (target && a.files?.includes(target)) setFile(target); }}>{main}</div>
      </section>
      <aside className="wb-side"><div className="side-body">
        {!a.draft ? <PublishedSide st={st} a={a} /> : K.isIndex(a)
          ? <>{basisRow(st, a, a.draft.basis) && <Fields rows={[basisRow(st, a, a.draft.basis)]} />}<p className="ui-note">索引类产物不需要修订，确认后直接发布。发布后，之后的每次更新都会自动发布，不再需要审阅。</p></>
          : <>
            <Segmented block value={side} onChange={v => setSide(v as typeof side)} options={[{ value: 'chat', label: '和 iCode 对话' }, { value: 'edit', label: '手动编辑' }]} />
            {side === 'chat' ? <>
              <p className="caption">接着挖掘时的 iCode 会话继续，会话 <code>{hashId(task(st, a.draft.task)?.id ?? a.id)}</code></p>
              <div className="chat" ref={chatBox}>
                <div className="msg icode">告诉我哪里需要修改，我会直接修改产物，修改结果可以在“对比”中查看。</div>
                {chat.map((m, i) => <div key={i} className={'msg ' + (m.who === 'busy' ? 'icode busy' : m.who)}>{m.text}</div>)}
              </div>
              {file && scriptsFor(file).length > 0 && <div className="ai-examples">{scriptsFor(file).map(s => <Button key={s.prompt} size="small" onClick={() => send(s.prompt)}>{s.prompt}</Button>)}</div>}
              <div className="chat-input"><Input.TextArea rows={2} value={say} onChange={e => setSay(e.target.value)} placeholder="说明需要修改的地方"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(say); } }} />
                <Button type="primary" loading={busy} onClick={() => send(say)}>发送</Button></div>
            </> : file && isMd(file) ? <ManualEdit key={file + a.draft.revisions.length} text={K.text(a, 'current', file) ?? ''} label={K.fileLabel(file)} onSave={text => {
              if (text === K.text(a, 'current', file)) { toast('内容没有变化'); return; }
              update(d => { artifact(d, id)!.draft!.revisions.push({ kind: 'manual', file, text, at: now() }); });
              setTab('diff'); toast('已保存修订 ' + (a.draft!.revisions.length + 1));
            }} /> : <p className="ui-note">这个文件不能手动编辑，可以通过对话修订。</p>}
            <div className="history"><div className="caption">修订记录</div><ol>
              <li><b>原始产物</b><span className="caption">{when(a.draft.created)}</span></li>
              {a.draft.revisions.map((r, i) => <li key={i}><b>修订 {i + 1}（{r.kind === 'chat' ? '对话' : '手动'}）</b><span className="caption">{K.fileLabel(r.file)}</span></li>)}
            </ol></div>
          </>}
      </div></aside>
    </div>
    {publishing && <PublishDialog a={a} onClose={() => setPublishing(false)} />}
  </div>;
}

function ManualEdit({ text, label, onSave }: { text: string; label: string; onSave(text: string): void }) {
  const [value, setValue] = useState(text);
  return <><p className="caption">正在编辑：{label}</p><Input.TextArea className="editor-area" value={value} onChange={e => setValue(e.target.value)} autoSize={{ minRows: 14, maxRows: 30 }} />
    <div className="actions end"><Button type="primary" onClick={() => onSave(value)}>保存修订</Button></div></>;
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
