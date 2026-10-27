// Artifact files: markdown, the trajectory report, PR records, diffs, the file list and the read-only preview.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Modal, Tag } from 'antd';
import { marked } from 'marked';
import type { Artifact, TalentsState } from '../types.ts';
import { content, skillTree } from '../content.ts';
import { capability } from '../demo/model.ts';
import * as K from '../demo/knowledge.ts';
import { Fields } from './ui.tsx';
import { CodeGraphView } from './codegraph.tsx';

/** Markdown with its front matter shown as fields and the added lines of ```diff blocks highlighted. */
export function Markdown({ text }: { text: string }) {
  let body = text, front: [string, string][] = [];
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    front = m[1].split(/\r?\n/).filter(l => /^\w[\w-]*:/.test(l)).map(l => {
      const i = l.indexOf(':');
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    });
  }
  const html = marked.parse(body, { async: false }).replace(/<code class="language-diff">([\s\S]*?)<\/code>/g, (_, code: string) =>
    '<code class="language-diff">' + code.split('\n').map(l => /^\+/.test(l) ? '<span class="diff-add">' + l + '</span>' : l).join('\n') + '</code>');
  return <>{front.length > 0 && <div className="frontmatter"><Fields rows={front} /></div>}<div dangerouslySetInnerHTML={{ __html: html }} /></>;
}

function PrRecord({ text }: { text: string }) {
  let pr: { number: number; title: string; mergedAt?: string; author?: string; url?: string; body?: string };
  try { pr = JSON.parse(text); } catch { return <pre className="plain">{text}</pre>; }
  return <article className="markdown"><h1>PR #{pr.number} {pr.title}</h1>
    <Fields rows={[['状态', '已合并' + (pr.mergedAt ? '，' + String(pr.mergedAt).replace('T', ' ').slice(0, 16) : '')], !!pr.author && ['作者', pr.author], ['链接', <span className="path">{pr.url ?? ''}</span>]]} />
    <Markdown text={pr.body ?? ''} />
    <p className="caption">diff 未随产物保存，需要时用 <code>git show</code> 或打开 PR 链接查看。</p></article>;
}

/** Mining metadata of a diff-mode spec (miner/<spec>/meta.json): scenario, repository, engine and snippets. */
function MinerMeta({ text }: { text: string }) {
  let meta: {
    name?: string; description?: string; scenario?: string; mode?: string;
    repository?: { path?: string; branch?: string; commit?: string };
    snippets?: { archived?: string; size?: number }[];
    engine?: { id?: string; version?: string }; executionId?: string; createdAt?: string;
  };
  try { meta = JSON.parse(text); } catch { return <pre className="plain">{text}</pre>; }
  const rows: [string, ReactNode][] = [['模式', meta.mode === 'diff' ? '代码片段挖掘（diff）' : (meta.mode ?? '—')]];
  if (meta.scenario) rows.push(['场景', meta.scenario]);
  if (meta.repository) rows.push(['代码仓', <span className="path">{meta.repository.path}{meta.repository.branch ? ' · ' + meta.repository.branch : ''}</span>]);
  if (meta.repository?.commit) rows.push(['提交', <span className="path">{String(meta.repository.commit).slice(0, 12)}</span>]);
  if (meta.engine) rows.push(['引擎', (meta.engine.id ?? '') + (meta.engine.version ? ' v' + meta.engine.version : '')]);
  if (meta.executionId) rows.push(['执行 ID', <span className="path">{meta.executionId}</span>]);
  if (meta.createdAt) rows.push(['归档时间', String(meta.createdAt).replace('T', ' ').slice(0, 16)]);
  return <article className="markdown"><h1>{meta.name ?? '挖掘元数据'}</h1>
    {meta.description && <p>{meta.description}</p>}
    <Fields rows={rows} />
    {(meta.snippets ?? []).length > 0 && <>
      <h2>输入代码片段</h2>
      <ul className="file-lines">{meta.snippets!.map((s, i) => <li key={i}><span className="path">{s.archived ?? ''}</span>{s.size ? <span className="caption"> · {s.size.toLocaleString()} 字节</span> : null}</li>)}</ul>
      <p className="caption">片段为从历史实现按路径提取的 Git diff，保留原始变更；分析时结合代码仓上下文总结范式。</p>
    </>}
  </article>;
}

export function FileContent({ st, a, file, text }: { st: TalentsState; a: Artifact; file: string; text: string | null }) {
  // A report renders itself with scripts; one too large to bundle is served by the Talents service.
  if (/\.html$/.test(file)) return <iframe title="预览" sandbox="allow-scripts" {...(text == null ? { src: '/api/content?key=' + encodeURIComponent(file) } : { srcDoc: text })} />;
  if (text == null) return <div className="index-summary"><p className="ui-note">内容暂不可预览。</p></div>;
  if (/\/input\/prs\/\d+\/metadata\.json$/.test(file)) return <PrRecord text={text} />;
  if (/\/meta\.json$/.test(file)) return <MinerMeta text={text} />;
  if (/\.md$/.test(file)) return <article className="markdown"><Markdown text={text} /></article>;
  return <pre className="plain">{text}</pre>;
}

export function IndexSummary({ a }: { a: Artifact }) {
  if (a.id === 'a-cg-java') return <CodeGraphView />;
  return <div className="index-summary"><div className="stat-row">{(a.stats ?? []).map(([label, value]) => <div className="stat" key={label}><b>{value}</b><span>{label}</span></div>)}</div>
    <p>{a.desc}</p><p className="ui-note">索引通过在线查询使用，不需要打开阅读。</p></div>;
}

export function DiffView({ before, after }: { before: string | null; after: string | null }) {
  const ops = K.diffLines(before, after);
  const add = ops.filter(o => o[0] === '+').length, del = ops.filter(o => o[0] === '-').length;
  if (!add && !del) return <div className="diff-empty">没有差异</div>;
  // Changed lines with three lines of context around them; longer unchanged runs fold into ⋯.
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - 3), k + 4).some(o => o[0] !== ' '));
  const rows: ReactNode[] = [];
  ops.forEach((o, k) => {
    if (!keep[k]) { if (keep[k - 1] !== false) rows.push(<div className="diff-gap" key={k}>⋯</div>); return; }
    rows.push(<div className={'diff-line ' + (o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : 'ctx')} key={k}><span className="sign">{o[0] === ' ' ? '' : o[0]}</span><span>{o[1] || ' '}</span></div>);
  });
  return <><div className="diff-summary"><span className="add">+{add}</span> <span className="del">−{del}</span> 行</div><div className="diff">{rows}</div></>;
}

export interface FileGroup { title: string; items: { key: string; label: ReactNode; indent?: boolean }[] }
export function FileList({ groups, current, onSelect }: { groups: FileGroup[]; current: string | null; onSelect(key: string): void }) {
  return <nav className="file-list" aria-label="文件">{groups.map((g, i) => <div key={i}>
    {g.title && <div className="file-group">{g.title}</div>}
    {g.items.map(it => <button key={it.key} className={'file-item' + (it.indent ? ' indent' : '')} aria-current={it.key === current ? 'true' : undefined} onClick={() => onSelect(it.key)}>{it.label}</button>)}
  </div>)}</nav>;
}
/** Relative links inside markdown open another file of the list. */
export function linkTarget(event: MouseEvent, current: string): string | null {
  const link = (event.target as HTMLElement).closest('.markdown a[href]');
  if (!link) return null;
  const href = decodeURIComponent(link.getAttribute('href')!).replace(/^<|>$/g, '').replace(/^\.\//, '');
  if (/^https?:/.test(href)) return null;
  event.preventDefault();
  return current.replace(/[^/]*$/, '') + href;
}

/** Read-only preview of an artifact version: its files and the Skills that come with it. */
export function ArtifactPreview({ st, a, which = 'published', onClose }: { st: TalentsState; a: Artifact; which?: K.Which; onClose(): void }) {
  const list = K.files(a, which);
  const [file, setFile] = useState(() => list.find(f => !/index\.md$/.test(f)) ?? list[0]);
  const cap = capability(st, a.cap);
  const title = <div><div className="caption">{cap.name}</div>{a.name}</div>;
  if (K.isIndex(a)) return <Modal open title={title} footer={null} onCancel={onClose} width={a.id === 'a-cg-java' ? 1280 : 640} destroyOnHidden><IndexSummary a={a} /></Modal>;
  const groups: FileGroup[] = K.fileGroups(a, list).map((g, i) => ({ title: g.title || (i ? '' : '内容'), items: g.items.map(f => ({ key: f, label: K.fileLabel(f), indent: !!g.title && a.folder === 'miner' })) }));
  (a.skills ?? []).forEach(name => groups.push({ title: '配套 Skill：' + name, items: skillTree(name).map(f => ({ key: 'skills/' + name + '/' + f, label: f, indent: f.includes('/') })) }));
  const keys = groups.flatMap(g => g.items.map(it => it.key));
  const text = /^skills\//.test(file) ? content(file) : K.text(a, which, file);
  return <Modal open title={title} footer={null} onCancel={onClose} width={1120} className="preview-modal">
    <div className="preview-body">
      <FileList groups={groups} current={file} onSelect={setFile} />
      <div className="preview-content" key={file} onClick={e => { const target = linkTarget(e, file); if (target && keys.includes(target)) setFile(target); }}>
        <FileContent st={st} a={a} file={file} text={text} />
      </div>
    </div>
  </Modal>;
}

/** What applying writes on the developer's machine, file by file; added lines are highlighted. */
export function ChangeList({ changes }: { changes: K.FileChange[] }) {
  return <div className="change-list">{changes.map(f => <div className="change" key={f.path}>
    <div className="change-head"><Tag color={f.verb === '新增' ? 'success' : 'processing'}>{f.verb}</Tag><span className="path">{f.path}</span></div>
    <pre>{f.lines.map((l, i) => <span key={i} className={/^\+/.test(l) ? 'add' : undefined}>{l}{'\n'}</span>)}</pre>
  </div>)}</div>;
}
