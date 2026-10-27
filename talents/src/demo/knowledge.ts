// Knowledge artifacts: versions (published / original draft / current revision), file contents and diff.
import type { Artifact } from '../types.ts';
import { content } from '../content.ts';
import { RULES_FILE, rulesAt, rulesMarkdown } from './suggestions.ts';

export type Which = 'published' | 'original' | 'current';
export const isIndex = (a: Artifact) => a.kind === 'index';
export function status(a: Artifact) {
  if (a.published && a.draft) return 'update';
  if (a.published) return 'published';
  return 'draft';
}

// ---------- Files and versions ----------
export const files = (a: Artifact, which: Which) => which === 'published' && a.published ? (a.published.files ?? a.files ?? []) : (a.files ?? []);
export const specsOf = (a: Artifact, which: Which) => which === 'published' && a.published ? (a.published.specs ?? a.specs) : a.specs;
export function minerIndex(specs: string[] = []) {
  const text = content('miner/index.md') ?? '';
  const rows: Record<string, string> = {};
  text.split(/\r?\n/).forEach(l => { const m = /^\|\s*\[([^\]]+)\]/.exec(l); if (m) rows[m[1]] = l; });
  const head = text.split(/\r?\n/).filter(l => /^#|^>/.test(l)).join('\n');
  return head + '\n\n| 名称 | 描述 | 首次归档时间 |\n| --- | --- | --- |\n' + specs.map(n => rows[n] ?? '| [' + n + '](<./' + n + '/summary.md>) | — | — |').join('\n') + '\n';
}
function baseText(a: Artifact, which: Which, key: string) {
  if (key === 'miner/index.md') return minerIndex(specsOf(a, which));
  if (key === RULES_FILE) return rulesMarkdown(rulesAt(a, which === 'published' ? a.published?.version : undefined));
  const over = which === 'published' ? a.published?.over?.[key] : undefined;
  if (over) return typeof over === 'string' ? content(over) : over.text;
  return content(key);
}
/** which: 'published' | 'original' (as the capability produced it) | 'current' (after revisions) */
export function text(a: Artifact, which: Which, key: string) {
  if (which === 'current' && a.draft) {
    for (let i = a.draft.revisions.length - 1; i >= 0; i--) if (a.draft.revisions[i].file === key) return a.draft.revisions[i].text;
  }
  return baseText(a, which === 'published' ? 'published' : 'original', key);
}
export function fileLabel(key: string) {
  if (key === RULES_FILE) return 'AGENTS.md 规则';
  const parts = key.split('/');
  const name = parts.pop()!;
  if (name === 'summary.md') return '范式总结';
  if (name === 'analyzer.md') return '代码分析报告';
  if (name === 'metadata.json') return 'PR #' + parts.pop();
  if (name === 'meta.json') return parts[1] ? parts[1] + '：挖掘元数据' : '挖掘元数据';
  if (name === 'index.md') return parts[0] === 'miner' ? '范式索引' : '索引';
  return name.replace(/\.(md|html)$/, '');
}
/** Miner artifacts list files per spec: 范式总结, 代码分析报告, then PR records (PR mode) or mining metadata (diff mode). */
export function fileGroups(a: Artifact, list: string[]) {
  if (a.folder !== 'miner') return [{ title: '', items: list }];
  const groups: { title: string; items: string[] }[] = [{ title: '', items: list.filter(f => f === 'miner/index.md') }], by: Record<string, { title: string; items: string[] }> = {};
  list.forEach(f => {
    const m = /^miner\/([^/]+)\//.exec(f);
    if (!m) return;
    if (!by[m[1]]) { by[m[1]] = { title: m[1], items: [] }; groups.push(by[m[1]]); }
    by[m[1]].items.push(f);
  });
  return groups;
}

// ---------- Diff ----------
export type DiffOp = [' ' | '+' | '-', string];
export function diffLines(oldText: string | null, newText: string | null): DiffOp[] {
  const a = oldText ? oldText.split(/\r?\n/) : [], b = (newText ?? '').split(/\r?\n/);
  const n = a.length, m = b.length;
  const dp: Int32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}
